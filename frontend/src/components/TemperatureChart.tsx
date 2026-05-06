import { memo, useMemo, useState } from "react";
import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import type { HourlyWeatherPoint, UnitSystem } from "../types";
import { windDirectionLabel, weatherCodeIcon } from "../calculator/weather";

interface Props {
  hourlyWeather: HourlyWeatherPoint[];
  courseTz: string;
  unitSystem: UnitSystem;
  /**
   * ISO strings for segment boundary times. A vertical reference line is
   * drawn at each boundary so the user can correlate the chart to segments.
   */
  segmentBoundaryTimes?: string[];
  /** Called while hovering with the nearest hourly point, or null on leave. */
  onHoverPoint?: (pt: HourlyWeatherPoint | null) => void;
}

interface ChartPoint {
  ms: number;
  label: string;
  temp: number;
  feelsLike: number;
  /** Wind speed in display units (km/h or mph), capped at 100 for the shared axis. */
  windSpeed: number;
  /** Wind gusts in display units, capped the same way. */
  windGusts: number;
  /** Precipitation probability 0–100, or null if unavailable. */
  precip: number | null;
  raw: HourlyWeatherPoint;
}

function toDisplayTemp(celsius: number, unitSystem: UnitSystem): number {
  return unitSystem === "imperial"
    ? Math.round((celsius * 9) / 5 + 32)
    : Math.round(celsius * 10) / 10;
}

function toSpeedDisplay(kmh: number, unitSystem: UnitSystem): number {
  return unitSystem === "imperial"
    ? Math.round(kmh / 1.60934)
    : Math.round(kmh);
}

function formatHourLabel(isoUtc: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: tz,
    }).format(new Date(isoUtc));
  } catch {
    return isoUtc.slice(11, 16);
  }
}

interface CustomTooltipProps {
  active?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any[];
  unitSystem: UnitSystem;
  courseTz: string;
}

function CustomTooltip({
  active,
  payload,
  unitSystem,
  courseTz,
}: CustomTooltipProps) {
  if (!active || !payload?.length) return null;
  const point: ChartPoint = payload[0].payload;
  const w = point.raw.weather;
  const tempUnit = unitSystem === "imperial" ? "°F" : "°C";
  const speedUnit = unitSystem === "imperial" ? "mph" : "km/h";
  const feelsLike = toDisplayTemp(w.apparentTemperature, unitSystem);
  const temp = toDisplayTemp(w.temperature, unitSystem);
  const timeLabel = formatHourLabel(point.raw.timeIso, courseTz);
  const icon = weatherCodeIcon(w.weatherCode, w.isDay);

  return (
    <div className="temp-chart-tooltip">
      <div className="temp-chart-tooltip-time">
        {icon} {timeLabel}
      </div>
      <div className="temp-chart-tooltip-row">
        <span className="temp-chart-tooltip-label">Temp</span>
        <span>
          {temp}
          {tempUnit} · feels {feelsLike}
          {tempUnit}
        </span>
      </div>
      <div className="temp-chart-tooltip-row">
        <span className="temp-chart-tooltip-label">Wind</span>
        <span>
          <span
            style={{
              display: "inline-block",
              transform: `rotate(${(w.windDirection + 180) % 360}deg)`,
              lineHeight: 1,
            }}
          >
            ↑
          </span>{" "}
          {toSpeedDisplay(w.windSpeed, unitSystem)} {speedUnit}{" "}
          {windDirectionLabel(w.windDirection)}
          {w.windGusts > w.windSpeed
            ? ` (gusts ${toSpeedDisplay(w.windGusts, unitSystem)} ${speedUnit})`
            : ""}
        </span>
      </div>
      {w.precipitationProbabilityAvailable &&
        w.precipitationProbability > 0 && (
          <div className="temp-chart-tooltip-row">
            <span className="temp-chart-tooltip-label">Precip</span>
            <span>
              {Math.round(w.precipitationProbability)}%
              {w.precipitation > 0 ? ` / ${w.precipitation.toFixed(1)} mm` : ""}
            </span>
          </div>
        )}
    </div>
  );
}

const TemperatureChart = memo(function TemperatureChart({
  hourlyWeather,
  courseTz,
  unitSystem,
  segmentBoundaryTimes = [],
  onHoverPoint,
}: Props) {
  const [showFeelsLike, setShowFeelsLike] = useState(false);
  const [showWind, setShowWind] = useState(false);
  const [showPrecip, setShowPrecip] = useState(false);

  const tempUnit = unitSystem === "imperial" ? "°F" : "°C";
  const speedUnit = unitSystem === "imperial" ? "mph" : "km/h";

  const data = useMemo<ChartPoint[]>(
    () =>
      hourlyWeather.map((pt) => ({
        ms: new Date(pt.timeIso).getTime(),
        label: formatHourLabel(pt.timeIso, courseTz),
        temp: toDisplayTemp(pt.weather.temperature, unitSystem),
        feelsLike: toDisplayTemp(pt.weather.apparentTemperature, unitSystem),
        windSpeed: Math.min(
          toSpeedDisplay(pt.weather.windSpeed, unitSystem),
          unitSystem === "imperial" ? 62 : 100,
        ),
        windGusts: Math.min(
          toSpeedDisplay(pt.weather.windGusts, unitSystem),
          unitSystem === "imperial" ? 62 : 100,
        ),
        precip: pt.weather.precipitationProbabilityAvailable
          ? pt.weather.precipitationProbability
          : null,
        raw: pt,
      })),
    [hourlyWeather, courseTz, unitSystem],
  );

  if (data.length < 2) return null;

  // Left axis domain: cover temp + feelsLike when toggled
  const leftVals = [
    ...data.map((d) => d.temp),
    ...(showFeelsLike ? data.map((d) => d.feelsLike) : []),
  ];
  const minTemp = Math.min(...leftVals);
  const maxTemp = Math.max(...leftVals);
  const pad = Math.max((maxTemp - minTemp) * 0.15, 2);
  const yMin = Math.floor(minTemp - pad);
  const yMax = Math.ceil(maxTemp + pad);

  // Right axis: shared 0–100 scale for precip % and wind speed (km/h or mph ≤ 100)
  const showSecondary = showWind || showPrecip;
  // Label the right axis with the active series units
  const rightAxisLabel =
    showWind && showPrecip ? `${speedUnit} / %` : showWind ? speedUnit : "%";

  // Segment boundary reference lines
  const boundaryMs = segmentBoundaryTimes
    .map((t) => new Date(t).getTime())
    .filter((ms) => ms > data[0].ms && ms < data[data.length - 1].ms);

  // X-axis ticks
  const totalHours = data.length;
  const tickInterval =
    totalHours <= 24 ? 2 : totalHours <= 72 ? 6 : totalHours <= 168 ? 12 : 24;
  const xTicks = data.filter((_, i) => i % tickInterval === 0).map((d) => d.ms);

  // Whether precip data is actually present
  const hasPrecip = data.some((d) => d.precip !== null);

  return (
    <div className="temp-chart-container">
      <div className="temp-chart-header">
        <span className="temp-chart-title">
          <i className="fa-solid fa-temperature-half" /> Temperature
        </span>
        <div className="temp-chart-toggles">
          <button
            type="button"
            className={`temp-chart-toggle-btn${showFeelsLike ? " temp-chart-toggle-btn--active" : ""}`}
            style={{ "--toggle-color": "#fb923c" } as React.CSSProperties}
            onClick={() => setShowFeelsLike((v) => !v)}
          >
            <span className="temp-chart-toggle-swatch temp-chart-toggle-swatch--line" />
            Feels like
          </button>
          <button
            type="button"
            className={`temp-chart-toggle-btn${showWind ? " temp-chart-toggle-btn--active" : ""}`}
            style={{ "--toggle-color": "#34d399" } as React.CSSProperties}
            onClick={() => setShowWind((v) => !v)}
          >
            <span className="temp-chart-toggle-swatch temp-chart-toggle-swatch--line" />
            Wind
          </button>
          {hasPrecip && (
            <button
              type="button"
              className={`temp-chart-toggle-btn${showPrecip ? " temp-chart-toggle-btn--active" : ""}`}
              style={{ "--toggle-color": "#7dd3fc" } as React.CSSProperties}
              onClick={() => setShowPrecip((v) => !v)}
            >
              <span className="temp-chart-toggle-swatch temp-chart-toggle-swatch--area" />
              Precip
            </button>
          )}
        </div>
      </div>

      {/* Legend row — shown when at least one overlay is active */}
      {(showFeelsLike || showWind || (showPrecip && hasPrecip)) && (
        <div className="temp-chart-legend-row">
          <span className="temp-chart-legend-item" style={{ color: "#60a5fa" }}>
            <span
              className="temp-chart-legend-line"
              style={{ background: "#60a5fa" }}
            />
            Temp ({tempUnit})
          </span>
          {showFeelsLike && (
            <span
              className="temp-chart-legend-item"
              style={{ color: "#fb923c" }}
            >
              <span
                className="temp-chart-legend-line temp-chart-legend-line--dashed"
                style={{ borderColor: "#fb923c" }}
              />
              Feels like ({tempUnit})
            </span>
          )}
          {showWind && (
            <>
              <span
                className="temp-chart-legend-item"
                style={{ color: "#34d399" }}
              >
                <span
                  className="temp-chart-legend-line"
                  style={{ background: "#34d399" }}
                />
                Wind ({speedUnit})
              </span>
              <span
                className="temp-chart-legend-item"
                style={{ color: "#a7f3d0" }}
              >
                <span
                  className="temp-chart-legend-line temp-chart-legend-line--dashed"
                  style={{ borderColor: "#a7f3d0" }}
                />
                Gusts ({speedUnit})
              </span>
            </>
          )}
          {showPrecip && hasPrecip && (
            <span
              className="temp-chart-legend-item"
              style={{ color: "#7dd3fc" }}
            >
              <span
                className="temp-chart-legend-area"
                style={{ background: "#7dd3fc" }}
              />
              Precip (%)
            </span>
          )}
        </div>
      )}

      <ResponsiveContainer width="100%" height={160}>
        <ComposedChart
          data={data}
          margin={{ top: 6, right: showSecondary ? 44 : 8, left: 2, bottom: 6 }}
          onMouseMove={(state) => {
            if (!onHoverPoint) return;
            const idx = (state as unknown as { activeTooltipIndex?: number })
              .activeTooltipIndex;
            if (idx != null && idx >= 0 && idx < data.length) {
              onHoverPoint(data[idx].raw);
            }
          }}
          onMouseLeave={() => onHoverPoint?.(null)}
        >
          {boundaryMs.map((ms) => (
            <ReferenceLine
              key={ms}
              x={ms}
              stroke="#475569"
              strokeDasharray="4 3"
              strokeWidth={1}
              yAxisId="temp"
            />
          ))}

          <XAxis
            dataKey="ms"
            type="number"
            domain={["dataMin", "dataMax"]}
            scale="time"
            ticks={xTicks}
            tickFormatter={(ms: number) =>
              formatHourLabel(new Date(ms).toISOString(), courseTz)
            }
            tick={{ fill: "#94a3b8", fontSize: 10 }}
            axisLine={{ stroke: "#334155" }}
            tickLine={{ stroke: "#334155" }}
          />

          {/* Left axis — temperature */}
          <YAxis
            yAxisId="temp"
            orientation="left"
            domain={[yMin, yMax]}
            tick={{ fill: "#94a3b8", fontSize: 10 }}
            axisLine={{ stroke: "#334155" }}
            tickLine={{ stroke: "#334155" }}
            width={36}
            tickFormatter={(v: number) => `${v}${tempUnit}`}
          />

          {/* Right axis — wind / precip (shared 0–100 scale) */}
          {showSecondary && (
            <YAxis
              yAxisId="right"
              orientation="right"
              domain={[0, 100]}
              tick={{ fill: "#94a3b8", fontSize: 10 }}
              axisLine={{ stroke: "#334155" }}
              tickLine={{ stroke: "#334155" }}
              width={44}
              tickFormatter={(v: number) =>
                showWind && !showPrecip ? `${v}` : `${v}%`
              }
              label={{
                value: rightAxisLabel,
                angle: 90,
                position: "insideRight",
                offset: 10,
                style: { fill: "#64748b", fontSize: 9 },
              }}
            />
          )}

          <Tooltip
            content={
              <CustomTooltip unitSystem={unitSystem} courseTz={courseTz} />
            }
            isAnimationActive={false}
          />

          {/* Precip area — render first (behind lines) */}
          {showPrecip && hasPrecip && (
            <Area
              yAxisId="right"
              type="monotone"
              dataKey="precip"
              fill="#1e3a5f"
              stroke="#7dd3fc"
              strokeWidth={1}
              fillOpacity={0.45}
              dot={false}
              activeDot={false}
              isAnimationActive={false}
              connectNulls={false}
            />
          )}

          {/* Wind speed + gusts lines */}
          {showWind && (
            <>
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="windGusts"
                stroke="#a7f3d0"
                strokeWidth={1.5}
                strokeDasharray="5 3"
                dot={false}
                activeDot={{ r: 3, fill: "#a7f3d0", stroke: "#1e293b" }}
                isAnimationActive={false}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="windSpeed"
                stroke="#34d399"
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 3, fill: "#34d399", stroke: "#1e293b" }}
                isAnimationActive={false}
              />
            </>
          )}

          {/* Feels-like line (dashed, same axis as temp) */}
          {showFeelsLike && (
            <Line
              yAxisId="temp"
              type="monotone"
              dataKey="feelsLike"
              stroke="#fb923c"
              strokeWidth={1.5}
              strokeDasharray="5 3"
              dot={false}
              activeDot={{ r: 3, fill: "#fb923c", stroke: "#1e293b" }}
              isAnimationActive={false}
            />
          )}

          {/* Temperature line — always on top */}
          <Line
            yAxisId="temp"
            type="monotone"
            dataKey="temp"
            stroke="#60a5fa"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: "#93c5fd", stroke: "#1e293b" }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
});

export default TemperatureChart;
