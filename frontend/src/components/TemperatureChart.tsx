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
import type { SunriseSunsetEntry } from "../calculator/weather";

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
  /** Sunrise and sunset events within the course window. */
  sunriseSunset?: SunriseSunsetEntry[];
  /**
   * When set, restrict the chart`s visible time range to this [minMs, maxMs] window.
   * Managed by the parent so the parent can show/hide a reset button.
   */
  zoomDomain?: [number, number] | null;
  /** Label shown in the zoom badge, e.g. "split view" or "segment view". */
  zoomLabel?: string;
}

interface ChartPoint {
  ms: number;
  temp: number;
  feelsLike: number;
  /** Wind speed in display units (km/h or mph). */
  windSpeed: number;
  /** Wind gusts in display units. */
  windGusts: number;
  /** Precipitation probability 0-100, or null if unavailable. */
  precip: number | null;
  /** Rain in mm (15-min accumulated). */
  rain: number;
  /** Cloud cover 0-100. */
  cloudCover: number;
  /** Relative humidity 0-100. */
  humidity: number;
  raw: HourlyWeatherPoint;
}

// Unit helpers

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

// Formatting helpers

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

function formatTooltipTime(isoUtc: string, tz: string): string {
  try {
    const d = new Date(isoUtc);
    const weekday = new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      timeZone: tz,
    }).format(d);
    const date = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      timeZone: tz,
    }).format(d);
    const time = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: tz,
    })
      .format(d)
      .replace(":00", "")
      .replace(" AM", "a")
      .replace(" PM", "p");
    return `${weekday} ${date}, ${time}`;
  } catch {
    return isoUtc.slice(0, 16).replace("T", " ");
  }
}

function getMidnightBoundaries(
  data: ChartPoint[],
  tz: string,
): Array<{ ms: number; label: string }> {
  if (data.length < 2) return [];
  const dateFmt = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: tz,
  });
  const labelFmt = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: tz,
  });
  const boundaries: Array<{ ms: number; label: string }> = [];
  let prevDate = dateFmt.format(new Date(data[0].ms));
  for (let i = 1; i < data.length; i++) {
    const currDate = dateFmt.format(new Date(data[i].ms));
    if (currDate !== prevDate) {
      boundaries.push({
        ms: data[i].ms,
        label: labelFmt.format(new Date(data[i].ms)),
      });
      prevDate = currDate;
    }
  }
  return boundaries;
}

function getTzAbbr(tz: string): string {
  try {
    return (
      new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        timeZoneName: "short",
      })
        .formatToParts(new Date())
        .find((p) => p.type === "timeZoneName")?.value ?? ""
    );
  } catch {
    return "";
  }
}

// Shared recharts axis appearance

const AXIS_STYLE = {
  tick: { fill: "#94a3b8", fontSize: 10 },
  axisLine: { stroke: "#334155" },
  tickLine: { stroke: "#334155" },
} as const;

// Reference-line renderers

function renderDayBounds(
  boundaries: Array<{ ms: number; label: string }>,
  xMin: number,
  xMax: number,
  yAxisId: string,
  showLabel: boolean,
) {
  return boundaries
    .filter(({ ms }) => ms > xMin && ms < xMax)
    .map(({ ms, label }) => (
      <ReferenceLine
        key={`day-${ms}`}
        x={ms}
        stroke="#334155"
        strokeWidth={1.5}
        yAxisId={yAxisId}
        label={
          showLabel
            ? {
                value: label,
                position: "insideTopRight",
                fill: "#475569",
                fontSize: 9,
                dy: 2,
              }
            : undefined
        }
      />
    ));
}

function renderSegBounds(
  segTimes: string[],
  xMin: number,
  xMax: number,
  yAxisId: string,
) {
  return segTimes
    .map((t) => new Date(t).getTime())
    .filter((ms) => ms > xMin && ms < xMax)
    .map((ms) => (
      <ReferenceLine
        key={ms}
        x={ms}
        stroke="#475569"
        strokeDasharray="4 3"
        strokeWidth={1}
        yAxisId={yAxisId}
      />
    ));
}

function renderSunLines(
  events: SunriseSunsetEntry[],
  xMin: number,
  xMax: number,
  yAxisId: string,
) {
  return events
    .filter((e) => e.ms > xMin && e.ms < xMax)
    .map((e) => (
      <ReferenceLine
        key={`${e.type}-${e.ms}`}
        x={e.ms}
        stroke={e.type === "sunrise" ? "#fbbf24" : "#f97316"}
        strokeWidth={1}
        strokeDasharray="3 3"
        yAxisId={yAxisId}
        label={{
          value: e.type === "sunrise" ? "sun" : "dusk",
          position: "insideTopLeft",
          fill: e.type === "sunrise" ? "#fbbf24" : "#f97316",
          fontSize: 10,
          dy: 2,
        }}
      />
    ));
}

// Shared XAxis builder

interface SharedXAxisProps {
  xDomainMin: number;
  xDomainMax: number;
  xTicks: number[];
  courseTz: string;
  isBottom: boolean;
  tzAbbr: string;
}

function buildXAxis({
  xDomainMin,
  xDomainMax,
  xTicks,
  courseTz,
  isBottom,
  tzAbbr,
}: SharedXAxisProps) {
  if (!isBottom) {
    return (
      <XAxis
        dataKey="ms"
        type="number"
        domain={[xDomainMin, xDomainMax]}
        scale="time"
        tick={false}
        axisLine={{ stroke: "#334155" }}
        tickLine={false}
        height={4}
      />
    );
  }
  return (
    <XAxis
      dataKey="ms"
      type="number"
      domain={[xDomainMin, xDomainMax]}
      scale="time"
      ticks={xTicks}
      tickFormatter={(ms: number) =>
        formatHourLabel(new Date(ms).toISOString(), courseTz)
      }
      {...AXIS_STYLE}
      label={
        tzAbbr
          ? {
              value: tzAbbr,
              position: "insideBottomRight",
              offset: -4,
              style: { fill: "#64748b", fontSize: 9, fontStyle: "italic" },
            }
          : undefined
      }
    />
  );
}

// Single combined tooltip shown on the first visible chart (others share syncId for cursor line)

interface CombinedTooltipProps {
  active?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any[];
  courseTz: string;
  unitSystem: UnitSystem;
  showTempChart: boolean;
  showFeelsLike: boolean;
  showWindChart: boolean;
  showGusts: boolean;
  showPrecipChart: boolean;
  showPrecipProb: boolean;
  hasPrecip: boolean;
  showCoverChart: boolean;
  showHumidity: boolean;
}

function CombinedTooltip({
  active,
  payload,
  courseTz,
  unitSystem,
  showTempChart,
  showFeelsLike,
  showWindChart,
  showGusts,
  showPrecipChart,
  showPrecipProb,
  hasPrecip,
  showCoverChart,
  showHumidity,
}: CombinedTooltipProps) {
  if (!active || !payload?.length) return null;
  const pt: ChartPoint = payload[0].payload;
  const w = pt.raw.weather;
  const tempUnit = unitSystem === "imperial" ? "F" : "C";
  const speedUnit = unitSystem === "imperial" ? "mph" : "km/h";
  const icon = weatherCodeIcon(w.weatherCode, w.isDay);
  return (
    <div className="temp-chart-tooltip">
      <div className="temp-chart-tooltip-time">
        {icon} {formatTooltipTime(pt.raw.timeIso, courseTz)}
      </div>
      {showTempChart && (
        <>
          <div className="temp-chart-tooltip-row">
            <span className="temp-chart-tooltip-label">Temp</span>
            <span>
              {toDisplayTemp(w.temperature, unitSystem)}&deg;{tempUnit}
            </span>
          </div>
          {showFeelsLike && (
            <div className="temp-chart-tooltip-row">
              <span className="temp-chart-tooltip-label">Feels like</span>
              <span>
                {toDisplayTemp(w.apparentTemperature, unitSystem)}&deg;
                {tempUnit}
              </span>
            </div>
          )}
        </>
      )}
      {showWindChart && (
        <>
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
                <i className="fa-solid fa-arrow-up" />
              </span>{" "}
              {toSpeedDisplay(w.windSpeed, unitSystem)} {speedUnit}{" "}
              {windDirectionLabel(w.windDirection)}
            </span>
          </div>
          {showGusts && w.windGusts > w.windSpeed && (
            <div className="temp-chart-tooltip-row">
              <span className="temp-chart-tooltip-label">Gusts</span>
              <span>
                {toSpeedDisplay(w.windGusts, unitSystem)} {speedUnit}
              </span>
            </div>
          )}
        </>
      )}
      {showPrecipChart &&
        hasPrecip &&
        showPrecipProb &&
        w.precipitationProbabilityAvailable && (
          <div className="temp-chart-tooltip-row">
            <span className="temp-chart-tooltip-label">Prob</span>
            <span>{Math.round(w.precipitationProbability)}%</span>
          </div>
        )}
      {showPrecipChart && (
        <>
          <div className="temp-chart-tooltip-row">
            <span className="temp-chart-tooltip-label">Rain</span>
            <span>{w.rain.toFixed(2)} mm</span>
          </div>
          {w.precipitation > w.rain && w.precipitation > 0 && (
            <div className="temp-chart-tooltip-row">
              <span className="temp-chart-tooltip-label">Total</span>
              <span>{w.precipitation.toFixed(2)} mm</span>
            </div>
          )}
        </>
      )}
      {showCoverChart && (
        <div className="temp-chart-tooltip-row">
          <span className="temp-chart-tooltip-label">Cloud</span>
          <span>{Math.round(w.cloudCover)}%</span>
        </div>
      )}
      {showCoverChart && showHumidity && (
        <div className="temp-chart-tooltip-row">
          <span className="temp-chart-tooltip-label">Humidity</span>
          <span>{Math.round(w.humidity)}%</span>
        </div>
      )}
    </div>
  );
}

// Main component

const TemperatureChart = memo(function TemperatureChart({
  hourlyWeather,
  courseTz,
  unitSystem,
  segmentBoundaryTimes = [],
  onHoverPoint,
  sunriseSunset = [],
  zoomDomain,
}: Props) {
  // Chart-level visibility
  const [showTempChart, setShowTempChart] = useState(true);
  const [showWindChart, setShowWindChart] = useState(false);
  const [showPrecipChart, setShowPrecipChart] = useState(false);
  const [showCoverChart, setShowCoverChart] = useState(false);

  // Per-chart series toggles
  const [showFeelsLike, setShowFeelsLike] = useState(true);
  const [showGusts, setShowGusts] = useState(true);
  const [showPrecipProb, setShowPrecipProb] = useState(true);
  const [showHumidity, setShowHumidity] = useState(true);

  const tempUnit = unitSystem === "imperial" ? "F" : "C";
  const speedUnit = unitSystem === "imperial" ? "mph" : "km/h";

  // Data mapping
  const data = useMemo<ChartPoint[]>(
    () =>
      hourlyWeather.map((pt) => ({
        ms: new Date(pt.timeIso).getTime(),
        temp: toDisplayTemp(pt.weather.temperature, unitSystem),
        feelsLike: toDisplayTemp(pt.weather.apparentTemperature, unitSystem),
        windSpeed: toSpeedDisplay(pt.weather.windSpeed, unitSystem),
        windGusts: toSpeedDisplay(pt.weather.windGusts, unitSystem),
        precip: pt.weather.precipitationProbabilityAvailable
          ? pt.weather.precipitationProbability
          : null,
        rain: pt.weather.rain,
        cloudCover: pt.weather.cloudCover,
        humidity: pt.weather.humidity,
        raw: pt,
      })),
    [hourlyWeather, unitSystem],
  );

  if (data.length < 2) return null;

  const xDomainMin = zoomDomain?.[0] ?? data[0].ms;
  const xDomainMax = zoomDomain?.[1] ?? data[data.length - 1].ms;

  const visibleData = zoomDomain
    ? data.filter((d) => d.ms >= zoomDomain[0] && d.ms <= zoomDomain[1])
    : data;

  if (visibleData.length === 0) return null;

  // X-axis ticks
  const hoursOfData = visibleData.length / 4;
  const tickIntervalSlots =
    hoursOfData <= 24
      ? 8
      : hoursOfData <= 72
        ? 24
        : hoursOfData <= 168
          ? 48
          : 96;
  const xTicks = visibleData
    .filter((_, i) => i % tickIntervalSlots === 0)
    .map((d) => d.ms);

  const tzAbbr = getTzAbbr(courseTz);

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const midnightBoundaries = useMemo(
    () => getMidnightBoundaries(data, courseTz),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, courseTz],
  );

  // Data availability
  const hasPrecip = visibleData.some((d) => d.precip !== null);
  const hasRain = visibleData.some((d) => d.rain > 0);
  const precipAvailable = hasPrecip || hasRain;

  // Chart visibility with data guard on precip
  const chartVis = {
    temp: showTempChart,
    wind: showWindChart,
    precip: showPrecipChart && precipAvailable,
    cover: showCoverChart,
  };
  const visibleChartCount = Object.values(chartVis).filter(Boolean).length;
  const canHideChart = (isShown: boolean) => !isShown || visibleChartCount > 1;

  // Which chart is last (gets X-axis labels)
  const chartOrder = ["temp", "wind", "precip", "cover"] as const;
  const lastVisible =
    [...chartOrder].reverse().find((c) => chartVis[c]) ?? "temp";

  // Y-axis domains
  const tempVals = [
    ...visibleData.map((d) => d.temp),
    ...(showFeelsLike ? visibleData.map((d) => d.feelsLike) : []),
  ];
  const minTemp = Math.min(...tempVals);
  const maxTemp = Math.max(...tempVals);
  const tempPad = Math.max((maxTemp - minTemp) * 0.15, 2);
  const yTempMin = Math.floor(minTemp - tempPad);
  const yTempMax = Math.ceil(maxTemp + tempPad);

  const maxWind = Math.max(
    ...visibleData.map((d) =>
      showGusts ? Math.max(d.windSpeed, d.windGusts) : d.windSpeed,
    ),
  );
  const yWindMax = Math.max(Math.ceil(maxWind * 1.2), 1);

  const maxRain = hasRain ? Math.max(...visibleData.map((d) => d.rain)) : 0;
  const yRainMax = Math.max(Math.ceil(maxRain * 1.3), 1);

  // Shared margins: right=44 on all charts so plot areas align.
  // Charts with a right YAxis (precip) use the same 44px right margin;
  // the YAxis width=36 sits inside it leaving 8px of outer margin.
  const MARGIN_MID = { top: 6, right: 8, left: 2, bottom: 4 };
  const MARGIN_BOT = { top: 6, right: 8, left: 2, bottom: 16 };
  const getMargin = (chartId: string) =>
    lastVisible === chartId ? MARGIN_BOT : MARGIN_MID;

  // Shared hover handler
  const handleMouseMove = (state: unknown) => {
    if (!onHoverPoint) return;
    const idx = (state as { activeTooltipIndex?: number }).activeTooltipIndex;
    if (idx != null && idx >= 0 && idx < visibleData.length) {
      onHoverPoint(visibleData[idx].raw);
    }
  };
  const handleMouseLeave = () => onHoverPoint?.(null);

  const xAxisArgs = (chartId: string): SharedXAxisProps => ({
    xDomainMin,
    xDomainMax,
    xTicks,
    courseTz,
    isBottom: lastVisible === chartId,
    tzAbbr,
  });

  // The first visible chart gets the real combined tooltip; others get a cursor-only stub.
  const firstVisibleId =
    (["temp", "wind", "precip", "cover"] as const).find((c) => chartVis[c]) ??
    "temp";

  const tooltipFor = (chartId: string) =>
    firstVisibleId === chartId ? (
      <Tooltip
        content={
          <CombinedTooltip
            unitSystem={unitSystem}
            courseTz={courseTz}
            showTempChart={chartVis.temp}
            showFeelsLike={showFeelsLike}
            showWindChart={chartVis.wind}
            showGusts={showGusts}
            showPrecipChart={chartVis.precip}
            showPrecipProb={showPrecipProb}
            hasPrecip={hasPrecip}
            showCoverChart={chartVis.cover}
            showHumidity={showHumidity}
          />
        }
        isAnimationActive={false}
      />
    ) : (
      <Tooltip
        content={() => null}
        cursor={{ stroke: "#334155", strokeWidth: 1, strokeDasharray: "4 2" }}
        isAnimationActive={false}
      />
    );

  return (
    <div className="temp-chart-container">
      {/* Toggles row */}
      <div className="temp-chart-header">
        <div className="temp-chart-toggles">
          {(
            [
              {
                id: "temp" as const,
                label: "Temp",
                color: "#60a5fa",
                shown: showTempChart,
                set: setShowTempChart,
              },
              {
                id: "wind" as const,
                label: "Wind",
                color: "#34d399",
                shown: showWindChart,
                set: setShowWindChart,
              },
              {
                id: "cover" as const,
                label: "Cover",
                color: "#94a3b8",
                shown: showCoverChart,
                set: setShowCoverChart,
              },
            ] as const
          ).map(({ id, label, color, shown, set }) => {
            const locked = !canHideChart(shown);
            return (
              <button
                key={id}
                type="button"
                className={`temp-chart-toggle-btn${shown ? " temp-chart-toggle-btn--active" : ""}${locked ? " temp-chart-toggle-btn--locked" : ""}`}
                style={{ "--toggle-color": color } as React.CSSProperties}
                onClick={() => !locked && set((v) => !v)}
                title={
                  locked ? "At least one chart must be visible" : undefined
                }
              >
                {label}
              </button>
            );
          })}
          {precipAvailable && (
            <button
              type="button"
              className={`temp-chart-toggle-btn${chartVis.precip ? " temp-chart-toggle-btn--active" : ""}${!canHideChart(showPrecipChart) ? " temp-chart-toggle-btn--locked" : ""}`}
              style={{ "--toggle-color": "#38bdf8" } as React.CSSProperties}
              onClick={() =>
                canHideChart(showPrecipChart) && setShowPrecipChart((v) => !v)
              }
              title={
                !canHideChart(showPrecipChart)
                  ? "At least one chart must be visible"
                  : undefined
              }
            >
              Precip
            </button>
          )}
        </div>
      </div>

      {/* Temperature */}
      {chartVis.temp && (
        <div className="temp-chart-subrow">
          <div className="temp-chart-subrow-header">
            <span style={{ color: "#60a5fa" }}>
              <i className="fa-solid fa-temperature-half" /> Temperature (&deg;
              {tempUnit})
            </span>
            <button
              type="button"
              className={`temp-chart-toggle-btn temp-chart-toggle-btn--mini${showFeelsLike ? " temp-chart-toggle-btn--active" : ""}`}
              style={{ "--toggle-color": "#fb923c" } as React.CSSProperties}
              onClick={() => setShowFeelsLike((v) => !v)}
            >
              <span className="temp-chart-toggle-swatch temp-chart-toggle-swatch--line" />
              Feels like
            </button>
          </div>
          <ResponsiveContainer width="100%" height={120}>
            <ComposedChart
              data={visibleData}
              margin={getMargin("temp")}
              syncId="wx-forecast"
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
            >
              {renderSunLines(sunriseSunset, xDomainMin, xDomainMax, "temp")}
              {renderDayBounds(
                midnightBoundaries,
                xDomainMin,
                xDomainMax,
                "temp",
                true,
              )}
              {renderSegBounds(
                segmentBoundaryTimes,
                xDomainMin,
                xDomainMax,
                "temp",
              )}
              {buildXAxis(xAxisArgs("temp"))}
              <YAxis
                yAxisId="temp"
                orientation="left"
                domain={[yTempMin, yTempMax]}
                {...AXIS_STYLE}
                width={36}
                tickFormatter={(v: number) => `${v}`}
              />
              <YAxis yAxisId="right-pad" orientation="right" width={36} tick={false} axisLine={false} tickLine={false} />
              {tooltipFor("temp")}
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
      )}

      {/* Wind */}
      {chartVis.wind && (
        <div className="temp-chart-subrow">
          <div className="temp-chart-subrow-header">
            <span style={{ color: "#34d399" }}>
              <i className="fa-solid fa-wind" /> Wind ({speedUnit})
            </span>
            <button
              type="button"
              className={`temp-chart-toggle-btn temp-chart-toggle-btn--mini${showGusts ? " temp-chart-toggle-btn--active" : ""}`}
              style={{ "--toggle-color": "#a7f3d0" } as React.CSSProperties}
              onClick={() => setShowGusts((v) => !v)}
            >
              <span className="temp-chart-toggle-swatch temp-chart-toggle-swatch--line" />
              Gusts
            </button>
          </div>
          <ResponsiveContainer width="100%" height={100}>
            <ComposedChart
              data={visibleData}
              margin={getMargin("wind")}
              syncId="wx-forecast"
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
            >
              {renderDayBounds(
                midnightBoundaries,
                xDomainMin,
                xDomainMax,
                "wind",
                false,
              )}
              {renderSegBounds(
                segmentBoundaryTimes,
                xDomainMin,
                xDomainMax,
                "wind",
              )}
              {buildXAxis(xAxisArgs("wind"))}
              <YAxis
                yAxisId="wind"
                orientation="left"
                domain={[0, yWindMax]}
                {...AXIS_STYLE}
                width={36}
                tickFormatter={(v: number) => `${v}`}
              />
              <YAxis yAxisId="right-pad" orientation="right" width={36} tick={false} axisLine={false} tickLine={false} />
              {tooltipFor("wind")}
              {showGusts && (
                <Line
                  yAxisId="wind"
                  type="monotone"
                  dataKey="windGusts"
                  stroke="#a7f3d0"
                  strokeWidth={1.5}
                  strokeDasharray="5 3"
                  dot={false}
                  activeDot={{ r: 3, fill: "#a7f3d0", stroke: "#1e293b" }}
                  isAnimationActive={false}
                />
              )}
              <Line
                yAxisId="wind"
                type="monotone"
                dataKey="windSpeed"
                stroke="#34d399"
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 3, fill: "#34d399", stroke: "#1e293b" }}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Precipitation */}
      {chartVis.precip && (
        <div className="temp-chart-subrow">
          <div className="temp-chart-subrow-header">
            <span style={{ color: "#38bdf8" }}>
              <i className="fa-solid fa-cloud-rain" /> Precipitation
            </span>
            <div
              style={{ display: "flex", gap: "0.3rem", alignItems: "center" }}
            >
              {hasRain && (
                <span
                  className="temp-chart-subrow-legend-item"
                  style={{ color: "#38bdf8" }}
                >
                  <span
                    className="temp-chart-legend-area"
                    style={{ background: "#38bdf8" }}
                  />
                  Rain (mm)
                </span>
              )}
              {hasPrecip && (
                <button
                  type="button"
                  className={`temp-chart-toggle-btn temp-chart-toggle-btn--mini${showPrecipProb ? " temp-chart-toggle-btn--active" : ""}`}
                  style={{ "--toggle-color": "#7dd3fc" } as React.CSSProperties}
                  onClick={() => setShowPrecipProb((v) => !v)}
                >
                  <span className="temp-chart-toggle-swatch temp-chart-toggle-swatch--area" />
                  Prob %
                </button>
              )}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={100}>
            <ComposedChart
              data={visibleData}
              margin={getMargin("precip")}
              syncId="wx-forecast"
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
            >
              {renderDayBounds(
                midnightBoundaries,
                xDomainMin,
                xDomainMax,
                "rain",
                false,
              )}
              {renderSegBounds(
                segmentBoundaryTimes,
                xDomainMin,
                xDomainMax,
                "rain",
              )}
              {buildXAxis(xAxisArgs("precip"))}
              <YAxis
                yAxisId="rain"
                orientation="left"
                domain={[0, yRainMax]}
                {...AXIS_STYLE}
                width={36}
                tickFormatter={(v: number) => `${v}mm`}
              />
              <YAxis
                yAxisId="pct"
                orientation="right"
                domain={[0, 100]}
                width={36}
                tick={hasPrecip && showPrecipProb ? { fill: "#94a3b8", fontSize: 10 } : false}
                axisLine={hasPrecip && showPrecipProb ? { stroke: "#334155" } : false}
                tickLine={hasPrecip && showPrecipProb ? { stroke: "#334155" } : false}
                tickFormatter={(v: number) => `${v}%`}
              />
              {tooltipFor("precip")}
              {hasPrecip && showPrecipProb && (
                <Area
                  yAxisId="pct"
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
              <Area
                yAxisId="rain"
                type="monotone"
                dataKey="rain"
                fill="#0c4a6e"
                stroke="#38bdf8"
                strokeWidth={1.5}
                fillOpacity={0.6}
                dot={false}
                activeDot={false}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Cloud cover & humidity */}
      {chartVis.cover && (
        <div className="temp-chart-subrow">
          <div className="temp-chart-subrow-header">
            <span style={{ color: "#94a3b8" }}>
              <i className="fa-solid fa-cloud" /> Cloud &amp; Humidity (%)
            </span>
            <button
              type="button"
              className={`temp-chart-toggle-btn temp-chart-toggle-btn--mini${showHumidity ? " temp-chart-toggle-btn--active" : ""}`}
              style={{ "--toggle-color": "#67e8f9" } as React.CSSProperties}
              onClick={() => setShowHumidity((v) => !v)}
            >
              <span className="temp-chart-toggle-swatch temp-chart-toggle-swatch--line" />
              Humidity
            </button>
          </div>
          <ResponsiveContainer width="100%" height={100}>
            <ComposedChart
              data={visibleData}
              margin={getMargin("cover")}
              syncId="wx-forecast"
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
            >
              {renderDayBounds(
                midnightBoundaries,
                xDomainMin,
                xDomainMax,
                "cover",
                false,
              )}
              {renderSegBounds(
                segmentBoundaryTimes,
                xDomainMin,
                xDomainMax,
                "cover",
              )}
              {buildXAxis(xAxisArgs("cover"))}
              <YAxis
                yAxisId="cover"
                orientation="left"
                domain={[0, 100]}
                {...AXIS_STYLE}
                width={36}
                tickFormatter={(v: number) => `${v}%`}
              />
              <YAxis yAxisId="right-pad" orientation="right" width={36} tick={false} axisLine={false} tickLine={false} />
              {tooltipFor("cover")}
              <Area
                yAxisId="cover"
                type="monotone"
                dataKey="cloudCover"
                fill="#1e293b"
                stroke="#94a3b8"
                strokeWidth={1}
                fillOpacity={0.4}
                dot={false}
                activeDot={false}
                isAnimationActive={false}
              />
              {showHumidity && (
                <Line
                  yAxisId="cover"
                  type="monotone"
                  dataKey="humidity"
                  stroke="#67e8f9"
                  strokeWidth={1.5}
                  dot={false}
                  activeDot={{ r: 3, fill: "#67e8f9", stroke: "#1e293b" }}
                  isAnimationActive={false}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
});

export default TemperatureChart;
