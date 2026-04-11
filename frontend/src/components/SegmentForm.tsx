import { useState, useRef, useEffect } from "react";
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
import NumberInput from "./NumberInput";

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
  /** Cumulative course distance at the START of this segment (end of prev segment), in user units */
  segmentStartDist?: number | null;
  /** City label at the start of this segment (end of prev segment's last split) */
  segmentStartCity?: string | null;
  /**
   * Increment this number to programmatically expand this segment and scroll
   * it into view. Use with a paired splitExpandSignal to also open a split.
   */
  expandSignal?: number;
  /** Which split index should be expanded when expandSignal fires (-1 = none) */
  expandSplitIdx?: number;
  /** Increment to collapse this segment and all its splits. */
  collapseSignal?: number;
  /** Increment to expand this segment and all its splits without scrolling. */
  expandAllSignal?: number;
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
  segmentStartDist,
  segmentStartCity,
  expandSignal,
  expandSplitIdx = -1,
  collapseSignal,
  expandAllSignal,
}: SegmentFormProps) {
  const [collapsed, setCollapsed] = useState(true);
  // Increments whenever this segment becomes collapsed — used to collapse all child splits.
  const [splitCollapseSignal, setSplitCollapseSignal] = useState(0);
  const prevCollapsed = useRef(true);
  const segRootRef = useRef<HTMLDivElement | null>(null);
  const hasOptionalValues =
    !!value.down_time_ratio ||
    !!value.split_delta ||
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

  // When segment transitions to collapsed, cascade a collapse to all splits
  useEffect(() => {
    if (collapsed && !prevCollapsed.current) {
      setSplitCollapseSignal((s) => s + 1);
    }
    prevCollapsed.current = collapsed;
  }, [collapsed]);

  // Expand + scroll when CourseMap popup navigates here
  useEffect(() => {
    if (!expandSignal) return;
    setCollapsed(false);
    // Scroll after the DOM has expanded
    requestAnimationFrame(() => {
      segRootRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }, [expandSignal]);

  useEffect(() => {
    if (!collapseSignal) return;
    setCollapsed(true);
  }, [collapseSignal]);

  useEffect(() => {
    if (!expandAllSignal) return;
    setCollapsed(false);
  }, [expandAllSignal]);

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
    (unitSystem === "imperial"
      ? Math.round(m * 3.28084)
      : Math.round(m)
    ).toLocaleString();

  const lastSplitIdx = value.splits.length - 1;
  const segCumulativeDist = cumulativeDists?.[lastSplitIdx] ?? null;
  const segEndCity = cityLabels?.[lastSplitIdx] ?? null;
  const segEndCityFetching = cityFetching?.[lastSplitIdx] ?? false;

  // Ordered, adjacent-deduplicated TZ abbreviations across this segment's splits.
  // The effective TZ per split mirrors the logic in SplitForm's auto-detection useEffect
  // so that badges stay accurate even when the segment is collapsed (splits unmounted):
  //   - tzManuallySet → honour the stored differentTimezone / timezone fields as-is
  //   - otherwise     → derive from gpxProfile.endTimezone vs courseTz (same as the effect)
  // The leading entry is dropped when it matches the course TZ (not a "new" zone).
  const segTzSequence = (() => {
    const courseTzAbbr =
      new Intl.DateTimeFormat("en-US", {
        timeZone: courseTz,
        timeZoneName: "short",
      })
        .formatToParts(new Date())
        .find((p) => p.type === "timeZoneName")?.value ?? courseTz;

    const result: { tz: string; abbr: string }[] = [];
    let prevAbbr: string | null = null;

    value.splits.forEach((split, j) => {
      let tz: string;
      if (split.tzManuallySet) {
        // User explicitly set TZ — trust the stored flag.
        tz =
          split.differentTimezone && split.timezone ? split.timezone : courseTz;
      } else {
        // Auto-detected: mirror SplitForm's useEffect logic so the badge is
        // correct even before the effect has a chance to run on mount.
        const detectedTz = gpxProfiles?.[j]?.endTimezone ?? null;
        tz = detectedTz && detectedTz !== courseTz ? detectedTz : courseTz;
      }

      const abbr =
        new Intl.DateTimeFormat("en-US", {
          timeZone: tz,
          timeZoneName: "short",
        })
          .formatToParts(new Date())
          .find((p) => p.type === "timeZoneName")?.value ?? tz;

      if (abbr !== prevAbbr) {
        result.push({ tz, abbr });
        prevAbbr = abbr;
      }
    });

    // Drop the leading entry if it just reflects the course TZ.
    if (result.length > 0 && result[0].abbr === courseTzAbbr) {
      return result.slice(1);
    }
    return result;
  })();

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

  return (
    <div className="segment-form" ref={segRootRef}>
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
          </div>
          {aggGpx && (
            <div className="split-header-meta">
              {totalDist > 0 && (
                <span
                  className="split-header-meta-item split-header-meta-item--dist"
                  title="Segment distance"
                >
                  {totalDist.toLocaleString(undefined, {
                    minimumFractionDigits: 1,
                    maximumFractionDigits: 1,
                  })}{" "}
                  {dLabel}
                </span>
              )}
              <span
                className="split-header-meta-item split-header-meta-item--gain"
                title="Elevation gain"
              >
                ⬆ {toElevUnit(aggGpx.elevGainM)}
                {elevUnit}
              </span>
              <span
                className="split-header-meta-item split-header-meta-item--loss"
                title="Elevation loss"
              >
                ⬇ {toElevUnit(aggGpx.elevLossM)}
                {elevUnit}
              </span>
              <span
                className="split-header-meta-item split-header-meta-item--grade"
                title="Average grade"
              >
                {aggGpx.avgGradePct.toFixed(1)}% avg
              </span>
              {aggGpx.steepPct > 0 && (
                <span
                  className="split-header-meta-item split-header-meta-item--steep"
                  title="% of distance with grade > 5%"
                >
                  ⚠ {aggGpx.steepPct}% steep
                </span>
              )}
            </div>
          )}
        </div>
        {(segTzSequence.length > 0 || segCumulativeDist != null) && (
          <div
            className="split-header-right"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="split-header-dist-row">
              {segTzSequence.map(({ tz, abbr }, idx) => (
                <span
                  key={`${tz}-${idx}`}
                  className="split-header-meta-item split-header-meta-item--tz"
                  title={`Timezone: ${tz}`}
                >
                  🕐 {abbr}
                </span>
              ))}
              {segCumulativeDist != null && (
                <span className="split-header-dist">
                  {segCumulativeDist.toLocaleString(undefined, {
                    minimumFractionDigits: 1,
                    maximumFractionDigits: 1,
                  })}{" "}
                  {dLabel}
                </span>
              )}
            </div>
            {segCumulativeDist != null &&
              aggGpx &&
              (segEndCityFetching ||
                segEndCity ||
                segmentStartCity ||
                sleepHms) && (
                <span className="split-header-city">
                  {(() => {
                    const cityPart = segEndCityFetching ? (
                      <span className="split-nearby-city--loading">
                        (finding nearest city…)
                      </span>
                    ) : segmentStartCity && segEndCity ? (
                      `${segmentStartCity} — ${segEndCity}`
                    ) : (
                      (segEndCity ?? null)
                    );
                    const sleepPart = sleepHms ? `${sleepHms} 💤` : null;
                    if (segEndCityFetching) {
                      return sleepPart ? (
                        <>
                          {cityPart}
                          {" · "}
                          {sleepPart}
                        </>
                      ) : (
                        cityPart
                      );
                    }
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
              <label htmlFor={`${prefix}-split-count`}># of Splits</label>
              <NumberInput
                id={`${prefix}-split-count`}
                min="1"
                step="1"
                value={value.splitCount}
                onChange={(v) => handleSplitCountChange(v)}
                placeholder="1"
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
                <NumberInput
                  id={`${prefix}-dtr`}
                  step="0.05"
                  min="0"
                  max="1"
                  value={value.down_time_ratio}
                  onChange={(v) => update({ down_time_ratio: v })}
                  placeholder="Inherits"
                />
                <FieldError fieldId={`${prefix}-dtr`} />
              </div>

              <div className="field">
                <label
                  htmlFor={`${prefix}-split-delta`}
                  title="Per-split speed change; negative = decelerating"
                >
                  Speed Delta ({sLabel})
                </label>
                <NumberInput
                  id={`${prefix}-split-delta`}
                  step="any"
                  value={value.split_delta}
                  onChange={(v) => update({ split_delta: v })}
                  placeholder="Inherits"
                />
              </div>

              <div className="field">
                <label htmlFor={`${prefix}-moving-speed`}>
                  Speed ({sLabel})
                </label>
                <NumberInput
                  id={`${prefix}-moving-speed`}
                  step="any"
                  value={value.moving_speed}
                  onChange={(v) => update({ moving_speed: v })}
                  placeholder="Inherits"
                />
                <FieldError fieldId={`${prefix}-moving-speed`} />
              </div>

              <div className="field">
                <label htmlFor={`${prefix}-min-speed`}>
                  Min Speed ({sLabel})
                </label>
                <NumberInput
                  id={`${prefix}-min-speed`}
                  step="any"
                  value={value.min_moving_speed}
                  onChange={(v) => update({ min_moving_speed: v })}
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
                  const prev =
                    j === 0
                      ? (segmentStartDist ?? 0)
                      : (cumulativeDists?.[j - 1] ?? 0);
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
                expandSignal={expandSplitIdx === j ? expandSignal : undefined}
                collapseSignal={splitCollapseSignal || undefined}
                expandAllSignal={undefined}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
