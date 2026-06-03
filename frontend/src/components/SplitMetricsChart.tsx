import { memo } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  Bar,
  Line,
} from "recharts";
import type { UnitSystem } from "../types";

export interface SplitMetricPoint {
  splitNo: number;
  segIdx: number;
  splitIdx: number;
  segmentName: string;
  splitName: string;
  distance: number;
  elevGain: number | null;
  elevLoss: number | null;
  climbScore: number | null;
  technicalDescentScore: number | null;
  variabilityScore: number | null;
  difficulty: number | null;
}

interface Props {
  data: SplitMetricPoint[];
  unitSystem: UnitSystem;
  distanceLabel: string;
  hasGpxMetrics: boolean;
  onZoomToSplit?: (segIdx: number, splitIdx: number) => void;
}

function formatNumber(value: number, digits = 1): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

const SplitMetricsChart = memo(function SplitMetricsChart({
  data,
  unitSystem,
  distanceLabel,
  hasGpxMetrics,
  onZoomToSplit,
}: Props) {
  if (data.length === 0) return null;

  const colors = {
    axisText: "#64748b",
    axisLine: "#475569",
    grid: "#334155",
    primary: "#4361ee",
    elevGain: "#f97316",
    elevLoss: "#60a5fa",
  };

  const elevUnit = unitSystem === "imperial" ? "ft" : "m";
  const elevDivisor = unitSystem === "imperial" ? 100 : 30;
  const chartData = data.map((row) => ({
    ...row,
    elevGainScaled:
      row.elevGain == null ? null : Math.max(0, row.elevGain / elevDivisor),
    elevLossScaled:
      row.elevLoss == null ? null : Math.max(0, row.elevLoss / elevDivisor),
  }));

  function handleDotClick(row: SplitMetricPoint) {
    onZoomToSplit?.(row.segIdx, row.splitIdx);
  }

  return (
    <div className="split-metrics-chart">
      <ResponsiveContainer width="100%" height={230}>
        <ComposedChart
          data={chartData}
          margin={{ top: 12, right: 14, left: 10, bottom: 6 }}
        >
          <CartesianGrid stroke={colors.grid} strokeDasharray="3 4" />
          <XAxis
            dataKey="splitNo"
            tick={{ fill: colors.axisText, fontSize: 12 }}
            axisLine={{ stroke: colors.axisLine }}
            tickLine={{ stroke: colors.axisLine }}
            allowDecimals={false}
          />
          <YAxis
            yAxisId="left"
            tick={{ fill: colors.axisText, fontSize: 12 }}
            axisLine={{ stroke: colors.axisLine }}
            tickLine={{ stroke: colors.axisLine }}
          />
          {hasGpxMetrics && (
            <YAxis
              yAxisId="right"
              orientation="right"
              domain={[0, 100]}
              tick={{ fill: colors.primary, fontSize: 12 }}
              axisLine={{ stroke: colors.primary }}
              tickLine={{ stroke: colors.primary }}
            />
          )}
          <Tooltip
            isAnimationActive={false}
            content={({ active, payload, label }) => {
              if (!active || !payload || payload.length === 0) return null;
              const row = payload[0]?.payload as SplitMetricPoint | undefined;
              if (!row) return null;

              return (
                <div
                  style={{
                    background: "#111827",
                    border: "1px solid #1f2937",
                    borderRadius: "8px",
                    color: "#f3f4f6",
                    padding: "8px 10px",
                    minWidth: "220px",
                    fontSize: "12px",
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: "6px" }}>
                    {`Split ${label}: ${row.segmentName} > ${row.splitName}`}
                  </div>
                  <div>{`Distance: ${formatNumber(row.distance, 1)} ${distanceLabel}`}</div>
                  {hasGpxMetrics && (
                    <>
                      <div>{`Elev Gain: ${Math.round(row.elevGain ?? 0).toLocaleString()} ${elevUnit}`}</div>
                      <div>{`Elev Loss: ${Math.round(row.elevLoss ?? 0).toLocaleString()} ${elevUnit}`}</div>
                      <div>{`Difficulty: ${Math.round(row.difficulty ?? 0)}/100`}</div>
                      <div>{`Climb: ${Math.round(row.climbScore ?? 0)}/60`}</div>
                      <div>{`Technical Descent: ${Math.round(row.technicalDescentScore ?? 0)}/25`}</div>
                      <div>{`Variability: ${Math.round(row.variabilityScore ?? 0)}/15`}</div>
                    </>
                  )}
                </div>
              );
            }}
          />
          <Legend
            wrapperStyle={{ color: "#d1d5db", fontSize: "12px" }}
            formatter={(value) => {
              if (value === "Distance") return `Distance (${distanceLabel})`;
              if (value === "Elev Gain")
                return `Elev + (${elevUnit}/${elevDivisor})`;
              if (value === "Elev Loss")
                return `Elev - (${elevUnit}/${elevDivisor})`;
              return "Difficulty (0-100)";
            }}
          />

          <Bar
            yAxisId="left"
            dataKey="distance"
            name="Distance"
            fill={colors.primary}
            radius={[3, 3, 0, 0]}
            maxBarSize={18}
          />
          {hasGpxMetrics && (
            <Bar
              yAxisId="left"
              dataKey="elevGainScaled"
              stackId="elev"
              name="Elev Gain"
              fill={colors.elevGain}
              radius={[0, 0, 0, 0]}
              maxBarSize={14}
            />
          )}
          {hasGpxMetrics && (
            <Bar
              yAxisId="left"
              dataKey="elevLossScaled"
              stackId="elev"
              name="Elev Loss"
              fill={colors.elevLoss}
              fillOpacity={0.75}
              radius={[3, 3, 0, 0]}
              maxBarSize={14}
            />
          )}
          {hasGpxMetrics && (
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="difficulty"
              name="Difficulty"
              stroke={colors.primary}
              strokeWidth={2}
              dot={(props) => {
                const row = props.payload as SplitMetricPoint | undefined;
                if (
                  !row ||
                  props.cx == null ||
                  props.cy == null ||
                  props.value == null
                ) {
                  return null;
                }
                return (
                  <circle
                    cx={props.cx}
                    cy={props.cy}
                    r={3}
                    fill={colors.primary}
                    style={{
                      cursor: onZoomToSplit ? "pointer" : "default",
                    }}
                    onClick={() => handleDotClick(row)}
                  />
                );
              }}
              activeDot={(props) => {
                const row = props.payload as SplitMetricPoint | undefined;
                if (
                  !row ||
                  props.cx == null ||
                  props.cy == null ||
                  props.value == null
                ) {
                  return null;
                }
                return (
                  <circle
                    cx={props.cx}
                    cy={props.cy}
                    r={5}
                    fill={colors.primary}
                    stroke="#ffffff"
                    strokeWidth={1.5}
                    style={{
                      cursor: onZoomToSplit ? "pointer" : "default",
                    }}
                    onClick={() => handleDotClick(row)}
                  />
                );
              }}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
});

export default SplitMetricsChart;
