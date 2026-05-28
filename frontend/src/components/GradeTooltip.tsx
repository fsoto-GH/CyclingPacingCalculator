import { useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import type { GradeBuckets } from "../types";

interface SteepBadgeProps {
  steepPct: number;
  gradeBuckets: GradeBuckets;
  minGradePct: number;
  maxGradePct: number;
}

// ── Shared types and helpers ─────────────────────────────────────────────────
type BucketDef = {
  keys: readonly (keyof GradeBuckets)[];
  label: string;
  title: string;
};

const sumBuckets = (keys: readonly (keyof GradeBuckets)[], b: GradeBuckets) =>
  keys.reduce((s, k) => s + b[k], 0);

// ── Compact (4%-wide bars, 5 bars per side) ──────────────────────────────────
const COMPACT_DESCENT_DEFS: BucketDef[] = [
  { keys: ["bn18plus", "bn18"], label: "≤-16", title: "≤ -16% descent" },
  { keys: ["bn16", "bn14"], label: "-14", title: "(-16, -12%]" },
  { keys: ["bn12", "bn10"], label: "-10", title: "(-12, -8%]" },
  { keys: ["bn8", "bn6"], label: "-6", title: "(-8, -4%]" },
  { keys: ["bn4", "bn2"], label: "-2", title: "(-4, 0]" },
];

const COMPACT_ASCENT_DEFS: BucketDef[] = [
  { keys: ["b2", "b4"], label: "2", title: "(0, 4%]" },
  { keys: ["b6", "b8"], label: "6", title: "(4, 8%]" },
  { keys: ["b10", "b12"], label: "10", title: "(8, 12%]" },
  { keys: ["b14", "b16"], label: "14", title: "(12, 16%]" },
  { keys: ["b18", "b18plus"], label: "≥16", title: "≥ 16% ascent" },
];

// ── Granular (2%-wide bars, 10 bars per side) ─────────────────────────────────
const GRANULAR_DESCENT_DEFS: BucketDef[] = [
  { keys: ["bn18plus"], label: "≤-18", title: "≤ -18% grade" },
  ...Array.from({ length: 9 }, (_, i) => ({
    keys: [`bn${18 - i * 2}`] as (keyof GradeBuckets)[],
    label: `-${18 - i * 2}`,
    title: `(-${18 - i * 2}, -${16 - i * 2}%]`,
  })),
];

const GRANULAR_ASCENT_DEFS: BucketDef[] = [
  ...Array.from({ length: 9 }, (_, i) => ({
    keys: [`b${(i + 1) * 2}`] as (keyof GradeBuckets)[],
    label: `${(i + 1) * 2}`,
    title: `(${i * 2}, ${(i + 1) * 2}%]`,
  })),
  { keys: ["b18plus"], label: "≥18", title: "> 18% grade" },
];

// ── SteepBadge tooltip bucket defs (compact 4% ascent with verbose labels) ────
const TOOLTIP_BUCKET_DEFS: (BucketDef & { tooltipLabel: string })[] = [
  { ...COMPACT_ASCENT_DEFS[0], tooltipLabel: "0–4%" },
  { ...COMPACT_ASCENT_DEFS[1], tooltipLabel: "4–8%" },
  { ...COMPACT_ASCENT_DEFS[2], tooltipLabel: "8–12%" },
  { ...COMPACT_ASCENT_DEFS[3], tooltipLabel: "12–16%" },
  { ...COMPACT_ASCENT_DEFS[4], tooltipLabel: "≥16%" },
];

const CHART_H = 44; // px for the bar area

/** Column chart for grade bucket distribution (grade on X, % distance on Y).
 *  Descent buckets (blue, left) and ascent buckets (amber, right) share a
 *  common height scale so the two sides are visually comparable.
 *  Pass `granular` for 1%-interval bars (used in Projections view).
 */
export function GradeDistributionBar({
  gradeBuckets,
  granular = false,
}: {
  gradeBuckets: GradeBuckets;
  granular?: boolean;
}) {
  const descentDefs = granular ? GRANULAR_DESCENT_DEFS : COMPACT_DESCENT_DEFS;
  const ascentDefs = granular ? GRANULAR_ASCENT_DEFS : COMPACT_ASCENT_DEFS;
  const allDefs = [...descentDefs, ...ascentDefs];
  const getPct = (def: BucketDef) => sumBuckets(def.keys, gradeBuckets);
  const maxPct = Math.max(...allDefs.map(getPct), 1);

  const renderCol = (def: BucketDef, isDesc: boolean) => {
    const pct = getPct(def);
    const barH = Math.round((pct / maxPct) * CHART_H);
    const showLabel = granular ? pct >= 5 : pct > 0;
    return (
      <div key={def.keys[0]} className="grade-dist-col-wrap">
        {showLabel && <span className="grade-dist-col-pct">{pct}%</span>}
        <div
          className={`grade-dist-col-bar${isDesc ? " grade-dist-col-bar--desc" : ""}`}
          style={{ height: `${Math.max(barH, 1)}px` }}
        />
      </div>
    );
  };

  return (
    <div
      className={`grade-dist-bar${granular ? " grade-dist-bar--granular" : ""}`}
    >
      <div className="grade-dist-dir-header">
        <span>↓ Descent</span>
        <span>Ascent ↑</span>
      </div>
      <div className="grade-dist-cols">
        <div className="grade-dist-group grade-dist-group--desc">
          {descentDefs.map((def) => renderCol(def, true))}
        </div>
        <div className="grade-dist-group">
          {ascentDefs.map((def) => renderCol(def, false))}
        </div>
      </div>
      <div className="grade-dist-x-axis">
        <div className="grade-dist-x-group">
          {descentDefs.map((def) => (
            <span
              key={def.keys[0]}
              className="grade-dist-x-label"
              title={def.title}
            >
              {def.label}
            </span>
          ))}
        </div>
        <div className="grade-dist-x-group">
          {ascentDefs.map((def) => (
            <span
              key={def.keys[0]}
              className="grade-dist-x-label"
              title={def.title}
            >
              {def.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

const TIP_W = 200; // approximate panel width (matches CSS min-width)
const TIP_H = 220; // approximate panel height for flip-up detection

export function SteepBadge({
  steepPct,
  gradeBuckets,
  minGradePct,
  maxGradePct,
}: SteepBadgeProps) {
  const [pos, setPos] = useState<{
    x: number;
    y: number;
    above: boolean;
  } | null>(null);
  const spanRef = useRef<HTMLSpanElement>(null);

  const handleEnter = useCallback(() => {
    const rect = spanRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Clamp X so panel stays within viewport horizontally
    const cx = rect.left + rect.width / 2;
    const x = Math.min(
      Math.max(cx, 16 + TIP_W / 2),
      window.innerWidth - 16 - TIP_W / 2,
    );
    // Flip above badge if not enough room below
    const above = rect.bottom + TIP_H + 8 > window.innerHeight - 16;
    const y = above ? rect.top - TIP_H - 8 : rect.bottom + 8;
    setPos({ x, y, above });
  }, []);

  const handleLeave = useCallback(() => setPos(null), []);

  const maxBucketPct = Math.max(
    ...TOOLTIP_BUCKET_DEFS.map((d) => sumBuckets(d.keys, gradeBuckets)),
    1,
  );

  return (
    <>
      <span
        ref={spanRef}
        className="split-header-meta-item split-header-meta-item--steep"
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
      >
        <i className="fa-solid fa-triangle-exclamation" /> {steepPct}% steep
      </span>

      {pos !== null &&
        createPortal(
          <div
            className="grade-tooltip"
            style={{
              position: "fixed",
              left: pos.x,
              top: pos.y,
              transform: "translateX(-50%)",
              pointerEvents: "none",
              zIndex: 9999,
            }}
          >
            <div className="grade-tooltip-title">Grade Distribution</div>
            <div className="grade-tooltip-buckets">
              {TOOLTIP_BUCKET_DEFS.map(({ keys, tooltipLabel }) => {
                const pct = sumBuckets(keys, gradeBuckets);
                return (
                  <div key={keys[0]} className="grade-tooltip-row">
                    <span className="grade-tooltip-label">{tooltipLabel}</span>
                    <div className="grade-tooltip-bar-wrap">
                      <div
                        className="grade-tooltip-bar"
                        style={{ width: `${(pct / maxBucketPct) * 100}%` }}
                      />
                    </div>
                    <span className="grade-tooltip-pct">{pct}%</span>
                  </div>
                );
              })}
            </div>
            <div className="grade-tooltip-minmax">
              <span>
                <i className="fas fa-arrow-down" /> {minGradePct.toFixed(1)}%
              </span>
              <span className="grade-tooltip-sep">·</span>
              <span>
                <i className="fas fa-arrow-up" /> {maxGradePct.toFixed(1)}%
              </span>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
