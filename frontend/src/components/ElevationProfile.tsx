import { useRef, useMemo, memo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea,
} from "recharts";
import type { GpxTrackPoint, SplitGpxProfile, UnitSystem } from "../types";

interface Props {
  gpxTrack: GpxTrackPoint[];
  /**
   * Flat list of all split profiles, in course order. Used to draw split
   * boundary lines and to determine which km positions are clickable.
   * An empty array means no splits yet — the full track is still shown.
   */
  gpxProfiles: SplitGpxProfile[];
  unitSystem: UnitSystem;
  /** Called with raw-km position while user hovers, null on mouse-leave. */
  onHoverKm?: (km: number | null) => void;
  /**
   * Called only when the clicked km falls within a defined split's range.
   * Clicks on uncovered gaps (not part of any split) do not fire this.
   */
  onClickKm?: (km: number) => void;
  /**
   * Per-segment colour ranges. Each entry shades startKm→endKm with the
   * segment's legend colour. Track portions not covered by any entry use
   * the default neutral style.
   */
  segmentColors?: { startKm: number; endKm: number; color: string }[];
  /**
   * Controlled zoom range [startKm, endKm]. When set the chart shows only that
   * slice. Managed by the parent so the parent can show/hide a reset button.
   */
  zoomRange?: [number, number] | null;
  /** Called when the user clicks a split to zoom in. */
  onZoomChange?: (range: [number, number] | null) => void;
}

/** Max chart points after downsampling (keeps paint fast). */
const MAX_PTS = 300;

interface ChartPoint {
  /** Raw km from track start — used as XAxis dataKey so label = raw km. */
  dist: number;
  /** Elevation in raw metres — formatters convert to display units. */
  ele: number;
  /** Grade in % between this point and the next (forward diff, backward at last). */
  grade: number;
}

function sliceAndDecimate(
  track: GpxTrackPoint[],
  startKm: number,
  endKm: number,
  maxPts: number,
): ChartPoint[] {
  const slice = track.filter(
    (p) => p.cumDist >= startKm - 0.001 && p.cumDist <= endKm + 0.001,
  );
  if (slice.length === 0) return [];

  const step = Math.max(1, Math.floor(slice.length / maxPts));
  const raw: { dist: number; ele: number }[] = [];
  for (let i = 0; i < slice.length; i += step) {
    raw.push({ dist: slice[i].cumDist, ele: slice[i].ele });
  }
  const last = slice[slice.length - 1];
  if (raw[raw.length - 1]?.dist !== last.cumDist) {
    raw.push({ dist: last.cumDist, ele: last.ele });
  }

  // Grade: forward difference except at the last point (backward diff).
  // Guard against a single-point raw array (e.g. after form reset with
  // distance = 0) where raw[i-1] would be undefined.
  return raw.map((pt, i) => {
    if (raw.length < 2) return { dist: pt.dist, ele: pt.ele, grade: 0 };
    const a = i < raw.length - 1 ? raw[i] : raw[i - 1];
    const b = i < raw.length - 1 ? raw[i + 1] : raw[i];
    const dEle = b.ele - a.ele;
    const dDist = (b.dist - a.dist) * 1000; // km → m
    const grade = dDist > 0 ? Math.round((dEle / dDist) * 1000) / 10 : 0;
    return { dist: pt.dist, ele: pt.ele, grade };
  });
}

interface TooltipEntry {
  value: number;
  payload: ChartPoint;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: TooltipEntry[];
  /** Raw km (XAxis dataKey="dist") */
  label?: number;
  unitSystem: UnitSystem;
  /** Ref updated synchronously during render — used by onClick to get current position. */
  hoverKmRef?: { current: number | null };
}

function gradeColor(pct: number): string {
  if (pct > 8) return "#ef4444"; // hard climb — red
  if (pct > 4) return "#f97316"; // climb — orange
  if (pct > 0) return "#fbbf24"; // gentle rise — yellow
  if (pct < -8) return "#818cf8"; // hard descent — indigo
  if (pct < -4) return "#60a5fa"; // descent — blue
  if (pct < 0) return "#38bdf8"; // gentle descent — sky
  return "#475569"; // flat — slate
}

function CustomTooltip({
  active,
  payload,
  label,
  unitSystem,
  hoverKmRef,
}: CustomTooltipProps) {
  // recharts guarantees label is set here — update ref so onClick can read it.
  // Updating a ref during render is safe (no re-render triggered).
  if (hoverKmRef != null && active && label != null) {
    hoverKmRef.current = label;
  }
  if (!active || !payload?.length || label == null) return null;
  const { ele, grade } = payload[0].payload;
  const elevDisplay =
    unitSystem === "imperial"
      ? `${Math.round(ele * 3.28084).toLocaleString()} ft`
      : `${Math.round(ele).toLocaleString()} m`;
  const distDisplay =
    unitSystem === "imperial"
      ? `${(label / 1.60934).toFixed(1)} mi`
      : `${label.toFixed(1)} km`;
  return (
    <div className="elev-tooltip">
      <span className="elev-tooltip-dist">{distDisplay}</span>
      <span className="elev-tooltip-ele">{elevDisplay}</span>
      <span className="elev-tooltip-grade" style={{ color: gradeColor(grade) }}>
        {grade > 0 ? "+" : ""}
        {grade}%
      </span>
    </div>
  );
}

const ElevationProfile = memo(function ElevationProfile({
  gpxTrack,
  gpxProfiles,
  unitSystem,
  onHoverKm,
  onClickKm,
  segmentColors,
  zoomRange = null,
  onZoomChange,
}: Props) {
  // Track last hovered km so onClick can use it reliably (activePayload is often
  // empty at the moment of the click event in recharts).
  const lastHoverKm = useRef<number | null>(null);

  // Always render the full course — data range is independent of gpxProfiles.
  const fullEndKm = gpxTrack[gpxTrack.length - 1]?.cumDist ?? 0;
  const viewStart = zoomRange ? zoomRange[0] : 0;
  const viewEnd = zoomRange ? zoomRange[1] : fullEndKm;

  const data = useMemo(
    () => sliceAndDecimate(gpxTrack, viewStart, viewEnd, MAX_PTS),
    [gpxTrack, viewStart, viewEnd],
  );

  if (data.length < 2) return null;

  // Split boundary vertical lines — only those within the current view range.
  const splitLines = gpxProfiles
    .map((p) => p.endKm)
    .filter((km) => km > viewStart + 0.01 && km < viewEnd - 0.01);

  const elevValues = data.map((d) => d.ele);
  const minEle = Math.min(...elevValues);
  const maxEle = Math.max(...elevValues);
  const padding = Math.max((maxEle - minEle) * 0.12, 20);
  const yMin = Math.floor((minEle - padding) / 10) * 10;
  const yMax = Math.ceil((maxEle + padding) / 10) * 10;

  const toDisplayEle = (m: number) =>
    unitSystem === "imperial" ? Math.round(m * 3.28084) : Math.round(m);
  const toDisplayDist = (km: number) =>
    unitSystem === "imperial" ? km / 1.60934 : km;

  const eleUnit = unitSystem === "imperial" ? "ft" : "m";
  const distUnit = unitSystem === "imperial" ? "mi" : "km";

  return (
    <div
      className="elev-profile-container"
      style={onClickKm ? { cursor: "pointer" } : undefined}
      title={
        zoomRange
          ? "Viewing zoomed split — click the ↺ button to return to full course"
          : onClickKm
            ? "Click a split section to zoom in on it"
            : undefined
      }
    >
      <ResponsiveContainer width="100%" height={150}>
        <AreaChart
          data={data}
          margin={{ top: 6, right: 8, left: 2, bottom: 6 }}
          onMouseMove={(state) => {
            // Also drive onHoverKm (map marker) from here as a best-effort;
            // the ref itself is updated more reliably inside CustomTooltip.render.
            const s = state as unknown as {
              activePayload?: TooltipEntry[];
              activeLabel?: number;
            };
            const km =
              s?.activePayload?.[0]?.payload?.dist ??
              (typeof s?.activeLabel === "number" ? s.activeLabel : undefined);
            if (km != null) {
              lastHoverKm.current = km;
              onHoverKm?.(km);
            }
          }}
          onMouseLeave={() => {
            // Do NOT clear lastHoverKm here — onMouseLeave fires before onClick
            // in recharts, so clearing it would always make onClick see null.
            // lastHoverKm is only used for click; the map marker is cleared below.
            onHoverKm?.(null);
          }}
          onClick={() => {
            if (lastHoverKm.current != null) {
              const km = lastHoverKm.current;
              // Find the split that was clicked.
              const hit = gpxProfiles.find(
                (p) => km >= p.startKm - 0.01 && km <= p.endKm + 0.01,
              );
              if (hit) {
                onZoomChange?.([hit.startKm, hit.endKm]);
                // Also notify the parent (map zoom) when a handler is provided.
                onClickKm?.(km);
              }
            }
          }}
        >
          <defs>
            {/* Neutral base gradient — used for the full elevation fill.
                 When segment colours are present this becomes a subtle backing;
                 when there are no segments it acts as the primary fill. */}
            <linearGradient id="elevGradBase" x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="5%"
                stopColor="#94a3b8"
                stopOpacity={segmentColors?.length ? 0.18 : 0.45}
              />
              <stop offset="95%" stopColor="#94a3b8" stopOpacity={0.04} />
            </linearGradient>
            {/* Per-segment gradient defs — referenced by ReferenceArea below */}
            {segmentColors?.map(({ color }, i) => (
              <linearGradient
                key={i}
                id={`elevSegGrad${i}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="5%" stopColor={color} stopOpacity={0.55} />
                <stop offset="95%" stopColor={color} stopOpacity={0.07} />
              </linearGradient>
            ))}
          </defs>
          <XAxis
            dataKey="dist"
            type="number"
            domain={["dataMin", (v: number) => v + 0.0001]}
            tick={{ fontSize: 9, fill: "#64748b" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `${toDisplayDist(v).toFixed(1)} ${distUnit}`}
            interval="preserveStartEnd"
            minTickGap={40}
          />
          <YAxis
            domain={[yMin, yMax]}
            tick={{ fontSize: 9, fill: "#64748b" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `${toDisplayEle(v)} ${eleUnit}`}
            width={unitSystem === "imperial" ? 46 : 38}
          />
          <Tooltip
            content={
              <CustomTooltip unitSystem={unitSystem} hoverKmRef={lastHoverKm} />
            }
            cursor={{
              stroke: "#4361ee",
              strokeWidth: 1,
              strokeDasharray: "3 3",
            }}
          />
          {/* Per-segment colour overlays — map over the original array so the
               gradient index i always matches the def id `elevSegGrad${i}`,
               even when the view is zoomed and only a subset are visible. */}
          {segmentColors?.map(({ startKm, endKm }, i) =>
            endKm > viewStart && startKm < viewEnd ? (
              <ReferenceArea
                key={`sc-${startKm}`}
                x1={Math.max(startKm, viewStart)}
                x2={Math.min(endKm, viewEnd)}
                fill={`url(#elevSegGrad${i})`}
                fillOpacity={1}
                stroke="none"
                ifOverflow="visible"
              />
            ) : null,
          )}
          {splitLines.map((km) => (
            <ReferenceLine
              key={km}
              x={km}
              stroke="#94a3b8"
              strokeDasharray="3 3"
              strokeWidth={1}
              opacity={0.5}
            />
          ))}
          <Area
            type="monotone"
            dataKey="ele"
            stroke={segmentColors?.length ? "#64748b" : "#4361ee"}
            strokeWidth={1.5}
            fill="url(#elevGradBase)"
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}); // end memo

export default ElevationProfile;
