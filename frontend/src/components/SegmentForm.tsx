import { useState, useRef } from "react";
import type {
  SegmentForm,
  SplitForm as SplitFormType,
  UnitSystem,
  Mode,
  SplitGpxProfile,
  GpxTrackPoint,
} from "../types";
import {
  speedLabel,
  distanceLabel,
  minutesToHms,
  SEGMENT_COLORS,
} from "../utils";
import { makeDefaultSplit } from "../defaults";
import TimeInput from "./TimeInput";
import SplitFormComponent from "./SplitForm";
import { FieldError } from "./FieldError";

interface SegmentFormProps {
  segIndex: number;
  value: SegmentForm;
  onChange: (val: SegmentForm) => void;
  unitSystem: UnitSystem;
  mode: Mode;
  gpxProfiles?: SplitGpxProfile[] | null;
  gpxTrack?: GpxTrackPoint[] | null;
  courseTz: string;
  splitStatuses?: ("over" | "under-last" | null)[];
  cityLabels?: (string | null)[];
  cityFetching?: boolean[];
  /** Whether this segment is the last segment in the course */
  isLastSeg?: boolean;
  /** Cumulative course distance at end of each split, in user units */
  cumulativeDists?: (number | null)[];
  /** Total GPX track length in user units */
  gpxTotalDist?: number | null;
  /** City label at the start of this segment (end of prev segment's last split) */
  segmentStartCity?: string | null;
}

export default function SegmentFormComponent({
  segIndex,
  value,
  onChange,
  unitSystem,
  mode,
  gpxProfiles,
  gpxTrack,
  courseTz,
  splitStatuses,
  cityLabels,
  cityFetching,
  isLastSeg,
  cumulativeDists,
  gpxTotalDist,
  segmentStartCity,
}: SegmentFormProps) {
  const [collapsed, setCollapsed] = useState(true);
  const hasOptionalValues =
    !!value.down_time_ratio ||
    !!value.split_decay ||
    !!value.moving_speed ||
    !!value.min_moving_speed;
  const [showOptional, setShowOptional] = useState(hasOptionalValues);
  const update = (patch: Partial<SegmentForm>) =>
    onChange({ ...value, ...patch });
  const sLabel = speedLabel(unitSystem);
  const dLabel = distanceLabel(unitSystem);
  const prefix = `seg${segIndex}`;
  const segColor = SEGMENT_COLORS[segIndex % SEGMENT_COLORS.length];
  const [isEditingName, setIsEditingName] = useState(false);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  const handleSplitCountChange = (raw: string) => {
    update({ splitCount: raw });
    const n = parseInt(raw, 10);
    if (!isNaN(n) && n > 0) {
      const curr = value.splits;
      if (n > curr.length) {
        const extra: SplitFormType[] = Array.from(
          { length: n - curr.length },
          makeDefaultSplit,
        );
        update({ splitCount: raw, splits: [...curr, ...extra] });
      } else if (n < curr.length) {
        update({ splitCount: raw, splits: curr.slice(0, n) });
      }
    }
  };

  const updateSplit = (i: number, split: SplitFormType) => {
    const next = [...value.splits];
    next[i] = split;
    update({ splits: next });
  };

  const totalDist = (() => {
    if (mode === "target_distance") {
      // In target distance mode, distances are markers; total is the last split's distance
      for (let i = value.splits.length - 1; i >= 0; i--) {
        const d = parseFloat(value.splits[i].distance);
        if (!isNaN(d) && d > 0) return d;
      }
      return 0;
    }
    return value.splits.reduce((sum, s) => {
      const d = parseFloat(s.distance);
      return sum + (isNaN(d) ? 0 : d);
    }, 0);
  })();

  const sleepHms = minutesToHms(value.sleep_time);
  const displayName = value.name?.trim() || null;
  const headerTitle = displayName || `Segment ${segIndex + 1}`;

  const elevUnit = unitSystem === "imperial" ? "ft" : "m";
  const toElevUnit = (m: number) =>
    (unitSystem === "imperial" ? Math.round(m * 3.28084) : Math.round(m)).toLocaleString();

  const lastSplitIdx = value.splits.length - 1;
  const segCumulativeDist = cumulativeDists?.[lastSplitIdx] ?? null;
  const segEndCity = cityLabels?.[lastSplitIdx] ?? null;
  const segEndCityFetching = cityFetching?.[lastSplitIdx] ?? false;

  // Aggregate GPX stats across all splits
  const validProfiles = (gpxProfiles ?? []).filter(
    (p): p is SplitGpxProfile => p != null,
  );
  const aggGpx =
    validProfiles.length > 0
      ? (() => {
          const elevGainM = validProfiles.reduce((s, p) => s + p.elevGainM, 0);
          const elevLossM = validProfiles.reduce((s, p) => s + p.elevLossM, 0);
          const totalDistKm =
            validProfiles[validProfiles.length - 1].endKm -
            validProfiles[0].startKm;
          const avgGradePct =
            totalDistKm > 0
              ? ((elevGainM - elevLossM) / (totalDistKm * 1000)) * 100
              : 0;
          const totalSteepKm = validProfiles.reduce((s, p) => {
            const splitDistKm = p.endKm - p.startKm;
            return s + (p.steepPct / 100) * splitDistKm;
          }, 0);
          const steepPct =
            totalDistKm > 0
              ? Math.round((totalSteepKm / totalDistKm) * 100)
              : 0;
          return {
            elevGainM: Math.round(elevGainM),
            elevLossM: Math.round(elevLossM),
            avgGradePct,
            steepPct,
          };
        })()
      : null;

  const collapsedSummaryParts = [
    `${value.splits.length} split${value.splits.length !== 1 ? "s" : ""}`,
    totalDist > 0 ? `${totalDist.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${dLabel}` : null,
    !aggGpx && sleepHms ? `💤 ${sleepHms}` : null,
  ].filter(Boolean) as string[];

  return (
    <div className="segment-form">
      <div className="segment-header" onClick={() => setCollapsed(!collapsed)}>
        <span className="collapse-icon" style={{ color: segColor }}>
          {collapsed ? "▶" : "▼"}
        </span>
        <div className="split-header-left">
          <div className="split-header-titlerow">
            {isEditingName ? (
              <input
                ref={nameInputRef}
                className="split-header-name-input"
                type="text"
                value={value.name ?? ""}
                placeholder={`Segment ${segIndex + 1}`}
                style={{ fontSize: "0.95rem" }}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => update({ name: e.target.value })}
                onBlur={() => setIsEditingName(false)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === "Escape") {
                    setIsEditingName(false);
                    e.preventDefault();
                  }
                }}
              />
            ) : (
              <span
                className="split-header-title split-header-title--editable"
                style={{ fontSize: "0.95rem" }}
                title="Click to rename"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsEditingName(true);
                  setTimeout(() => nameInputRef.current?.focus(), 0);
                }}
              >
                {headerTitle}
                {splitStatuses?.some((s) => s === "over") && (
                  <span className="gpx-dist-asterisk gpx-dist-asterisk--over">
                    {" "}
                    *
                  </span>
                )}
                {splitStatuses?.some((s) => s === "under-last") && (
                  <span className="gpx-dist-asterisk gpx-dist-asterisk--under">
                    {" "}
                    *
                  </span>
                )}
              </span>
            )}
            {collapsed && collapsedSummaryParts.length > 0 && (
              <span className="split-header-summary">
                {collapsedSummaryParts.join(" · ")}
              </span>
            )}
          </div>
          {aggGpx && (
            <div className="split-header-meta">
              {totalDist > 0 && (
                <span
                  className="split-header-meta-item"
                  title="Segment distance"
                >
                  {totalDist.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} {dLabel}
                </span>
              )}
              <span className="split-header-meta-item" title="Elevation gain">
                ⬆ {toElevUnit(aggGpx.elevGainM)}
                {elevUnit}
              </span>
              <span className="split-header-meta-item" title="Elevation loss">
                ⬇ {toElevUnit(aggGpx.elevLossM)}
                {elevUnit}
              </span>
              <span className="split-header-meta-item" title="Average grade">
                {aggGpx.avgGradePct.toFixed(1)}% avg
              </span>
              {aggGpx.steepPct > 0 && (
                <span
                  className="split-header-meta-item"
                  title="% of distance with grade > 5%"
                >
                  ⚠ {aggGpx.steepPct}% steep
                </span>
              )}
            </div>
          )}
        </div>
        {segCumulativeDist != null && (
          <div
            className="split-header-right"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="split-header-dist">
              {segCumulativeDist.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} {dLabel}
            </span>
            {aggGpx &&
              (segEndCityFetching ||
                segEndCity ||
                segmentStartCity ||
                sleepHms) && (
                <span className="split-header-city">
                  {(() => {
                    const cityPart = segEndCityFetching
                      ? "(finding nearest city…)"
                      : segmentStartCity && segEndCity
                        ? `${segmentStartCity} — ${segEndCity}`
                        : (segEndCity ?? null);
                    const sleepPart = sleepHms ? `${sleepHms} 💤` : null;
                    return [cityPart, sleepPart].filter(Boolean).join(" · ");
                  })()}
                </span>
              )}
          </div>
        )}
      </div>

      {!collapsed && (
        <div className="segment-body">
          <div className="fields-grid">
            <TimeInput
              id={`${prefix}-sleep-time`}
              label="Sleep Time"
              value={value.sleep_time}
              onChange={(v) => update({ sleep_time: v })}
            />

            <div className="field">
              <label htmlFor={`${prefix}-split-count`}>Split Count *</label>
              <input
                id={`${prefix}-split-count`}
                type="number"
                min="1"
                step="1"
                value={value.splitCount}
                onChange={(e) => handleSplitCountChange(e.target.value)}
              />
              <FieldError fieldId={`${prefix}-split-count`} />
            </div>

            <div className="field">
              <label
                htmlFor={`${prefix}-end-dt`}
                style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
              >
                <label className="toggle-switch">
                  <input
                    id={`${prefix}-end-dt`}
                    type="checkbox"
                    checked={value.include_end_down_time}
                    onChange={(e) =>
                      update({ include_end_down_time: e.target.checked })
                    }
                  />
                  <span className="toggle-track" />
                  <span className="toggle-thumb" />
                </label>
                Down Time on Last
              </label>
            </div>
          </div>

          <button
            type="button"
            className="optional-toggle"
            onClick={() => setShowOptional(!showOptional)}
          >
            <span className={`chevron${showOptional ? " open" : ""}`}>▶</span>
            Optional overrides
          </button>

          {showOptional && (
            <div className="optional-fields fields-grid">
              <div className="field">
                <label htmlFor={`${prefix}-dtr`}>Down Time Ratio</label>
                <input
                  id={`${prefix}-dtr`}
                  type="number"
                  step="0.05"
                  min="0"
                  max="1"
                  value={value.down_time_ratio}
                  onChange={(e) => update({ down_time_ratio: e.target.value })}
                  placeholder="Inherits"
                />
                <FieldError fieldId={`${prefix}-dtr`} />
              </div>

              <div className="field">
                <label htmlFor={`${prefix}-split-decay`}>
                  Split Decay ({sLabel})
                </label>
                <input
                  id={`${prefix}-split-decay`}
                  type="number"
                  step="any"
                  value={value.split_decay}
                  onChange={(e) => update({ split_decay: e.target.value })}
                  placeholder="Inherits"
                />
              </div>

              <div className="field">
                <label htmlFor={`${prefix}-moving-speed`}>
                  Speed ({sLabel})
                </label>
                <input
                  id={`${prefix}-moving-speed`}
                  type="number"
                  step="any"
                  value={value.moving_speed}
                  onChange={(e) => update({ moving_speed: e.target.value })}
                  placeholder="Inherits"
                />
                <FieldError fieldId={`${prefix}-moving-speed`} />
              </div>

              <div className="field">
                <label htmlFor={`${prefix}-min-speed`}>
                  Min Speed ({sLabel})
                </label>
                <input
                  id={`${prefix}-min-speed`}
                  type="number"
                  step="any"
                  value={value.min_moving_speed}
                  onChange={(e) => update({ min_moving_speed: e.target.value })}
                  placeholder="Inherits"
                />
                <FieldError fieldId={`${prefix}-min-speed`} />
              </div>
            </div>
          )}

          <div
            className="splits-container"
            style={{ borderLeftColor: `${segColor}33` }}
          >
            {value.splits.map((split, j) => (
              <SplitFormComponent
                key={j}
                segIndex={segIndex}
                splitIndex={j}
                value={split}
                onChange={(s) => updateSplit(j, s)}
                unitSystem={unitSystem}
                isLast={j === value.splits.length - 1}
                isLastOverall={isLastSeg && j === value.splits.length - 1}
                splitDistUser={(() => {
                  const cum = cumulativeDists?.[j] ?? null;
                  const prev = j === 0 ? 0 : (cumulativeDists?.[j - 1] ?? 0);
                  return cum != null
                    ? Math.round((cum - prev) * 10) / 10
                    : null;
                })()}
                includeEndDownTime={value.include_end_down_time}
                gpxProfile={gpxProfiles?.[j] ?? null}
                gpxTrack={gpxTrack ?? null}
                courseTz={courseTz}
                gpxDistStatus={splitStatuses?.[j] ?? null}
                nearbyCity={cityLabels?.[j] ?? null}
                nearbyCity_fetching={cityFetching?.[j] ?? false}
                cumulativeDist={cumulativeDists?.[j] ?? null}
                gpxTotalDist={gpxTotalDist ?? null}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
