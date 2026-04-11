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
  /** Ordered split profiles for this segment — used to get startKm/endKm boundaries */
  gpxProfiles: SplitGpxProfile[];
  unitSystem: UnitSystem;
  /** Called with raw-km position while user hovers, null on mouse-leave. */
  onHoverKm?: (km: number | null) => void;
  /** Called with raw-km position when user clicks a region. */
  onClickKm?: (km: number) => void;
  /**
   * Number of splits per segment, in order. When provided the alternating
   * background shade resets at each segment boundary (prevents two adjacent
   * splits from both getting the same shade when a segment has an odd split count).
   * Pass this in full-course view; omit in single-segment / single-split view.
   */
  splitCountsPerSegment?: number[];
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
  return raw.map((pt, i) => {
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
  splitCountsPerSegment,
}: Props) {
  // Track last hovered km so onClick can use it reliably (activePayload is often
  // empty at the moment of the click event in recharts).
  const lastHoverKm = useRef<number | null>(null);

  const segStartKm = gpxProfiles[0]?.startKm ?? 0;
  const segEndKm = gpxProfiles[gpxProfiles.length - 1]?.endKm ?? 0;

  // Memoize the expensive slice+decimate — only recomputes when the track or
  // active profile range changes, not on every hover state update.
  const data = useMemo(
    () => sliceAndDecimate(gpxTrack, segStartKm, segEndKm, MAX_PTS),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gpxTrack, segStartKm, segEndKm],
  );

  if (gpxProfiles.length === 0 || data.length < 2) return null;

  // Split boundary vertical lines — one per internal boundary.
  const splitLines = gpxProfiles.slice(0, -1).map((p) => p.endKm);

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
      title={onClickKm ? "Click a section to zoom to it" : undefined}
    >
      <ResponsiveContainer width="100%" height={130}>
        <AreaChart
          data={data}
          margin={{ top: 6, right: 8, left: 0, bottom: 0 }}
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
            if (onClickKm && lastHoverKm.current != null) {
              onClickKm(lastHoverKm.current);
            }
          }}
        >
          <defs>
            <linearGradient id="elevGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#4361ee" stopOpacity={0.45} />
              <stop offset="95%" stopColor="#4361ee" stopOpacity={0.04} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="dist"
            type="number"
            domain={["dataMin", "dataMax"]}
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
          {/* Alternating subtle background per split — visual hint that regions are clickable.
               Use per-segment-local index so the shade resets at segment boundaries. */}
          {gpxProfiles.length > 1 &&
            (() => {
              // Build a flat array of local-within-segment indices.
              let segIdx = 0;
              let countInSeg = 0;
              return gpxProfiles.map((p, i) => {
                if (splitCountsPerSegment) {
                  // Advance to the correct segment.
                  while (
                    segIdx < splitCountsPerSegment.length &&
                    countInSeg >= splitCountsPerSegment[segIdx]
                  ) {
                    segIdx++;
                    countInSeg = 0;
                  }
                }
                const localIdx = splitCountsPerSegment ? countInSeg++ : i;
                return localIdx % 2 === 0 ? null : (
                  <ReferenceArea
                    key={p.startKm}
                    x1={p.startKm}
                    x2={p.endKm}
                    fill="rgba(255,255,255,0.04)"
                    fillOpacity={1}
                    stroke="none"
                  />
                );
              });
            })()}
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
            stroke="#4361ee"
            strokeWidth={1.5}
            fill="url(#elevGrad)"
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}); // end memo

export default ElevationProfile;
