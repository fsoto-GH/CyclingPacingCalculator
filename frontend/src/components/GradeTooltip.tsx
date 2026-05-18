import { useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import type { GradeBuckets } from "../types";

interface SteepBadgeProps {
  steepPct: number;
  gradeBuckets: GradeBuckets;
  minGradePct: number;
  maxGradePct: number;
}

const BUCKET_DEFS: { key: keyof GradeBuckets; label: string }[] = [
  { key: "b0_3", label: "0–3%" },
  { key: "b3_6", label: "3–6%" },
  { key: "b6_9", label: "6–9%" },
  { key: "b9_12", label: "9–12%" },
  { key: "b12_15", label: "12–15%" },
  { key: "b15_18", label: "15–18%" },
  { key: "b18plus", label: ">18%" },
];

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
    ...BUCKET_DEFS.map((d) => gradeBuckets[d.key]),
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
              {BUCKET_DEFS.map(({ key, label }) => {
                const pct = gradeBuckets[key];
                return (
                  <div key={key} className="grade-tooltip-row">
                    <span className="grade-tooltip-label">{label}</span>
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
