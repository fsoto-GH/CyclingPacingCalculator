import { useState, useEffect, useRef, lazy, Suspense } from "react";
import type {
  SplitForm,
  SubSplitMode,
  UnitSystem,
  SplitGpxProfile,
  GpxTrackPoint,
  SplitDetail,
  SubSplitDetail,
} from "../types";
import { speedLabel, distanceLabel, formatHours } from "../utils";
import {
  buildDetailedNearDetail,
  checkArrivalVsHoursDetailed,
  dayIndexInTimezone,
  formatArrivalTimeWithTz,
  hoursLabelForEntry,
  timezoneAbbreviationAt,
} from "../timeMath";

interface EtaInfo {
  status: "open" | "near-open" | "near-close" | "closed";
  statusWord: string; // e.g. "Open", "Near open", "Near close", "Closed"
  hoursLabel: string; // e.g. "6:00 AM – 10:00 PM" or "24 hours" or "Closed"
  nearDetail: string | null; // e.g. "5 min before opening" or "10 min after closing"
  arrivalTime: string; // e.g. "1:31 PM EDT"
}

import TimeInput from "./TimeInput";
import RestStopFormComponent from "./RestStopForm";
import TimezoneSelect from "./TimezoneSelect";
import { FieldError } from "./FieldError";
import NumberInput from "./NumberInput";
import ConfirmModal from "./ConfirmModal";
const SplitEndpointMap = lazy(() => import("./SplitEndpointMap"));

interface SplitFormProps {
  segIndex: number;
  splitIndex: number;
  value: SplitForm;
  onChange: (val: SplitForm) => void;
  unitSystem: UnitSystem;
  isLast?: boolean;
  /** True only for the final split of the final segment across the whole course */
  isLastOverall?: boolean;
  includeEndDownTime?: boolean;
  /** Calculated per-split distance in user units (differs from input in target_distance mode) */
  splitDistUser?: number | null;
  gpxProfile?: SplitGpxProfile | null;
  gpxTrack?: GpxTrackPoint[] | null;
  courseTz: string;
  gpxDistStatus?: "over" | "under-last" | null;
  nearbyCity?: string | null;
  nearbyCity_fetching?: boolean;
  /** Cumulative course distance at the END of this split, in user units */
  cumulativeDist?: number | null;
  /** Total GPX track length in user units */
  gpxTotalDist?: number | null;
  /**
   * Increment this number to programmatically expand this split and scroll
   * it into view (passed down from a CourseMap popup navigation).
   */
  expandSignal?: number;
  /** Increment to collapse this split (from collapse-all). */
  collapseSignal?: number;
  /** Increment to expand this split without scrolling (from expand-all). */
  expandAllSignal?: number;
  /** Calculated split result from the current course calculation, for inline display. */
  splitResult?: SplitDetail | null;
  /** Controlled by SegmentForm: when true, show inline split results panel. */
  showResults?: boolean;
  /** Segment color for the collapse icon (matches segment header). */
  segColor?: string;
  /** Course-level sub-split mode default; splits may override. */
  courseSplitMode: SubSplitMode;
  canShiftUp?: boolean;
  canShiftDown?: boolean;
  canMoveToPrevSeg?: boolean;
  canMoveToNextSeg?: boolean;
  canDelete?: boolean;
  onShiftUp?: () => void;
  onShiftDown?: () => void;
  onMoveToPrevSeg?: () => void;
  onMoveToNextSeg?: () => void;
  onDelete?: () => void;
  etaMarginOpen?: number;
  etaMarginClose?: number;
  onZoomToSplit?: () => void;
}

export default function SplitFormComponent({
  segIndex,
  splitIndex,
  value,
  onChange,
  unitSystem,
  isLast,
  isLastOverall,
  includeEndDownTime,
  splitDistUser,
  gpxProfile,
  gpxTrack,
  courseTz,
  gpxDistStatus,
  nearbyCity,
  nearbyCity_fetching,
  cumulativeDist,
  gpxTotalDist,
  expandSignal,
  collapseSignal,
  expandAllSignal,
  splitResult,
  showResults = false,
  segColor,
  courseSplitMode,
  canShiftUp,
  canShiftDown,
  canMoveToPrevSeg,
  canMoveToNextSeg,
  canDelete,
  onShiftUp,
  onShiftDown,
  onMoveToPrevSeg,
  onMoveToNextSeg,
  onDelete,
  etaMarginOpen = 15,
  etaMarginClose = 7,
  onZoomToSplit,
}: SplitFormProps) {
  const update = (patch: Partial<SplitForm>) =>
    onChange({ ...value, ...patch });
  const [addressLoading, setAddressLoading] = useState(false);

  // Auto-detect timezone from GPX endpoint. Runs whenever the detected tz,
  // course tz, or manual-override flag changes.
  // If the user has explicitly set a timezone (tzManuallySet), auto-detection
  // is suppressed so their choice is preserved even when distances change.
  // Selecting the course timezone in the picker clears tzManuallySet and
  // re-enables auto-detection.
  useEffect(() => {
    if (value.tzManuallySet) return; // user-controlled — hands off
    const detectedTz = gpxProfile?.endTimezone ?? null;
    if (detectedTz && detectedTz !== courseTz) {
      // Endpoint is in a different tz — enable the override
      if (!value.differentTimezone || value.timezone !== detectedTz) {
        onChange({ ...value, differentTimezone: true, timezone: detectedTz });
      }
    } else if (detectedTz === courseTz && value.differentTimezone) {
      // Endpoint is now back in the course tz — clear the auto-set override
      onChange({ ...value, differentTimezone: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gpxProfile?.endTimezone, courseTz, value.tzManuallySet]);

  const hasOptionalValues =
    !!value.moving_speed ||
    !!value.down_time ||
    !!value.adjustment_time ||
    value.differentTimezone ||
    !!value.sub_split_override;
  const [showOptional, setShowOptional] = useState(hasOptionalValues);
  const [collapsed, setCollapsed] = useState(true);
  const [confirmDeleteSplitOpen, setConfirmDeleteSplitOpen] = useState(false);
  const [jumpHighlight, setJumpHighlight] = useState(false);
  const [showForm, setShowForm] = useState(true);
  const [showMap, setShowMap] = useState(false);
  const prevCollapseSignalRef = useRef(collapseSignal);
  const prevExpandAllSignalRef = useRef(expandAllSignal);
  const jumpHighlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  // Expand + scroll when CourseMap popup navigates here.
  // lastFiredExpandRef guards against re-firing on remount (e.g. page change)
  // when mapNavTarget still holds a stale signal from a previous navigation.
  const lastFiredExpandRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!expandSignal || expandSignal === lastFiredExpandRef.current) return;
    lastFiredExpandRef.current = expandSignal;
    setCollapsed(false);
    setJumpHighlight(true);
    if (jumpHighlightTimerRef.current !== null) {
      clearTimeout(jumpHighlightTimerRef.current);
    }
    jumpHighlightTimerRef.current = setTimeout(() => {
      setJumpHighlight(false);
      jumpHighlightTimerRef.current = null;
    }, 2200);
    requestAnimationFrame(() => {
      splitFormRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
    return () => {
      lastFiredExpandRef.current = undefined;
    };
  }, [expandSignal]);

  useEffect(() => {
    return () => {
      if (jumpHighlightTimerRef.current !== null) {
        clearTimeout(jumpHighlightTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (collapseSignal === prevCollapseSignalRef.current) return;
    prevCollapseSignalRef.current = collapseSignal;
    if (!collapseSignal) return;
    setCollapsed(true);
  }, [collapseSignal]);

  useEffect(() => {
    if (expandAllSignal === prevExpandAllSignalRef.current) return;
    prevExpandAllSignalRef.current = expandAllSignal;
    if (!expandAllSignal) return;
    setCollapsed(false);
  }, [expandAllSignal]);

  const [formColWidth, setFormColWidth] = useState(350);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);
  const resizeHandleRef = useRef<HTMLDivElement | null>(null);
  const splitFormRef = useRef<HTMLDivElement | null>(null);
  // Seed from actual window width so mobile first-render is already stacked
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== "undefined" && window.innerWidth < 900,
  );

  // Track container width to auto-stack layout when narrow.
  useEffect(() => {
    const el = splitFormRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (document.fullscreenElement) return;
      setIsNarrow(entry.contentRect.width < 700);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Keep the last valid profile so the map stays mounted while distance is being edited
  const lastValidProfileRef = useRef<SplitGpxProfile | null>(null);
  if (gpxProfile != null) lastValidProfileRef.current = gpxProfile;

  // Display profile: current if valid, else last known, else track start
  const displayProfile: SplitGpxProfile | null =
    gpxProfile ??
    lastValidProfileRef.current ??
    (gpxTrack
      ? {
          elevGainM: 0,
          elevLossM: 0,
          avgGradePct: 0,
          steepPct: 0,
          surface: "unknown",
          endLat: gpxTrack[0].lat,
          endLon: gpxTrack[0].lon,
          endTimezone: "",
          startKm: 0,
          endKm: 0,
        }
      : null);

  const mapAvailable = !!gpxTrack && displayProfile != null;
  // Whether the endpoint coords reflect a real defined distance
  const endpointDefined = gpxProfile != null;

  // Hide map panel when map becomes unavailable
  useEffect(() => {
    if (!mapAvailable && showMap) {
      setShowMap(false);
      if (!showForm) setShowForm(true);
    }
  }, [mapAvailable, showMap, showForm]);

  // Mouse drag — attach to document so the handle doesn't need to be held
  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!isDragging.current) return;
      const delta = e.clientX - dragStartX.current;
      setFormColWidth(
        Math.min(539, Math.max(350, dragStartWidth.current + delta)),
      );
    }
    function onMouseUp() {
      isDragging.current = false;
      resizeHandleRef.current?.classList.remove("active");
    }
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, []);
  const sLabel = speedLabel(unitSystem);
  const dLabel = distanceLabel(unitSystem);
  const prefix = `seg${segIndex}-split${splitIndex}`;

  const elevUnit = unitSystem === "imperial" ? "ft" : "m";
  const toElevUnit = (m: number) =>
    (unitSystem === "imperial"
      ? Math.round(m * 3.28084)
      : Math.round(m)
    ).toLocaleString();

  const displayName = value.name?.trim() || null;
  const headerTitle = displayName ? displayName : `Split ${splitIndex + 1}`;
  const [isEditingName, setIsEditingName] = useState(false);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  // ETA and timezone derived values (used for results panel and rest-stop badge)
  const splitEndTz =
    splitResult?.end_timezone ||
    (value.differentTimezone && value.timezone ? value.timezone : null);
  const splitStartTz = splitResult?.start_timezone || null;

  const dateOpts: Intl.DateTimeFormatOptions = {
    weekday: "short",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  };

  function fmtInTz(iso: string, tz: string) {
    return new Date(iso).toLocaleString(undefined, {
      ...dateOpts,
      timeZone: tz,
      timeZoneName: "short",
    });
  }

  // ETA info for the rest-stop badge — computed from split result end time
  const etaInfo: EtaInfo | null = (() => {
    if (!splitResult || !value.rest_stop.enabled) return null;
    const rs = value.rest_stop;
    const tz = splitEndTz ?? courseTz;
    const dayIdx = dayIndexInTimezone(splitResult.end_time, tz);
    const entry = rs.sameHoursEveryDay ? rs.allDays : rs.perDay[dayIdx];
    const status = checkArrivalVsHoursDetailed(
      splitResult.end_time,
      entry,
      tz,
      etaMarginOpen,
      etaMarginClose,
    );
    if (!status) return null;

    const hoursLabel = hoursLabelForEntry(entry);
    const nearDetail =
      status === "near-open" || status === "near-close"
        ? buildDetailedNearDetail(status, splitResult.end_time, entry, tz)
        : null;

    const statusWords: Record<string, string> = {
      open: "Open",
      "near-open": "Near open",
      "near-close": "Near close",
      closed: "Closed",
    };

    const arrivalTime = formatArrivalTimeWithTz(splitResult.end_time, tz);

    return {
      status,
      statusWord: statusWords[status],
      hoursLabel,
      nearDetail,
      arrivalTime,
    };
  })();

  // Timezone badge — shown whenever a split timezone override is active,
  // OR when the GPX profile detects a different tz (before onChange fires).
  const effectiveTz =
    value.differentTimezone && value.timezone
      ? value.timezone
      : gpxProfile?.endTimezone && gpxProfile.endTimezone !== courseTz
        ? gpxProfile.endTimezone
        : null;
  const tzBadgeAbbr = effectiveTz
    ? timezoneAbbreviationAt(new Date().toISOString(), effectiveTz)
    : null;

  return (
    <div
      className={`split-form${jumpHighlight ? " split-form--jump-highlight" : ""}`}
      ref={splitFormRef}
    >
      <div
        className="split-header"
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((c) => !c)}
        onKeyDown={(e) => {
          if (
            (e.key === "Enter" || e.key === " ") &&
            e.target === e.currentTarget
          ) {
            e.preventDefault();
            setCollapsed((c) => !c);
          }
        }}
      >
        <span
          className="collapse-icon-sm"
          style={segColor ? { color: segColor } : undefined}
        >
          {collapsed ? (
            <i className="fas fa-chevron-right" />
          ) : (
            <i className="fas fa-chevron-down" />
          )}
        </span>
        <div className="planning-split-header-grid">
          <div className="split-header-left">
            <div className="split-header-title-row">
              {isEditingName ? (
                <input
                  ref={nameInputRef}
                  className="split-header-name-input"
                  type="text"
                  value={value.name ?? ""}
                  placeholder={`Split ${splitIndex + 1}`}
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
                  title="Click to rename"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsEditingName(true);
                    setTimeout(() => nameInputRef.current?.focus(), 0);
                  }}
                >
                  {headerTitle}
                  {gpxDistStatus === "over" && (
                    <span
                      className="gpx-dist-asterisk gpx-dist-asterisk--over"
                      title="Split distance exceeds GPX track total"
                    >
                      {" "}
                      *
                    </span>
                  )}
                  {gpxDistStatus === "under-last" && (
                    <span
                      className="gpx-dist-asterisk gpx-dist-asterisk--under"
                      title="Total distance has not reached GPX track total"
                    >
                      {" "}
                      *
                    </span>
                  )}
                </span>
              )}
            </div>
            {(gpxProfile || splitDistUser != null) && (
              <div className="split-header-meta">
                {splitDistUser != null && (
                  <span
                    className="split-header-meta-item split-header-meta-item--dist"
                    title="Split distance"
                  >
                    {splitDistUser.toLocaleString(undefined, {
                      minimumFractionDigits: 1,
                      maximumFractionDigits: 1,
                    })}{" "}
                    {dLabel}
                  </span>
                )}
                {gpxProfile && (
                  <>
                    <span
                      className="split-header-meta-item split-header-meta-item--gain"
                      title="Elevation gain"
                    >
                      <i className="fas fa-arrow-up" />{" "}
                      {toElevUnit(gpxProfile.elevGainM)}
                      {elevUnit}
                    </span>
                    <span
                      className="split-header-meta-item split-header-meta-item--loss"
                      title="Elevation loss"
                    >
                      <i className="fas fa-arrow-down" />{" "}
                      {toElevUnit(gpxProfile.elevLossM)}
                      {elevUnit}
                    </span>
                    <span
                      className="split-header-meta-item split-header-meta-item--grade"
                      title="Average grade"
                    >
                      {gpxProfile.avgGradePct.toFixed(1)}% avg
                    </span>
                    {gpxProfile.steepPct > 0 && (
                      <span
                        className="split-header-meta-item split-header-meta-item--steep"
                        title="% of distance with grade > 5%"
                      >
                        <i className="fa-solid fa-triangle-exclamation"></i>{" "}
                        {gpxProfile.steepPct}% steep
                      </span>
                    )}
                    {gpxProfile.surface !== "unknown" && (
                      <span
                        className="split-header-meta-item split-header-meta-item--surface"
                        title="Dominant surface"
                      >
                        {gpxProfile.surface}
                      </span>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
          {(tzBadgeAbbr ||
            (cumulativeDist != null && gpxTotalDist != null)) && (
            <div
              className="split-header-right"
              onClick={(e) => e.stopPropagation()}
            >
              {(() => {
                const hasDist = cumulativeDist != null && gpxTotalDist != null;
                const diff = hasDist ? cumulativeDist! - gpxTotalDist! : 0;
                const absDiff = Math.abs(diff);
                const sign =
                  diff > 0.05 ? "over" : diff < -0.05 ? "under" : "exact";
                const distColor = !hasDist
                  ? undefined
                  : sign === "exact"
                    ? "#4ade80"
                    : sign === "over"
                      ? "#f87171"
                      : isLastOverall
                        ? "#facc15"
                        : undefined;
                return (
                  <>
                    <div className="split-header-dist-row">
                      {tzBadgeAbbr && (
                        <span
                          className={`split-header-meta-item split-header-meta-item--tz${value.tzManuallySet ? " tz-manual" : ""}`}
                          title={`Split timezone: ${effectiveTz}${value.tzManuallySet ? " (manually set — auto-detection paused)" : " (auto-detected)"}`}
                        >
                          <i className="fa-solid fa-clock-rotate-left"></i>{" "}
                          {tzBadgeAbbr}
                          {value.tzManuallySet && " ✏️"}
                        </span>
                      )}
                      {hasDist && (
                        <span
                          className="split-header-dist"
                          style={{ color: distColor }}
                        >
                          {cumulativeDist!.toLocaleString(undefined, {
                            minimumFractionDigits: 1,
                            maximumFractionDigits: 1,
                          })}{" "}
                          {dLabel}
                        </span>
                      )}
                    </div>
                    {hasDist && (
                      <span className="split-header-city">
                        {etaInfo && (
                          <span
                            className={`eta-badge eta-${etaInfo.status}`}
                            title={`${etaInfo.statusWord} (${etaInfo.nearDetail ? etaInfo.nearDetail : etaInfo.hoursLabel})`}
                          >
                            {etaInfo.status === "open" &&
                              (etaInfo.hoursLabel === "24 hours"
                                ? "24/7"
                                : "Open")}
                            {etaInfo.status === "near-open" && "Near open"}
                            {etaInfo.status === "near-close" && "Near close"}
                            {etaInfo.status === "closed" && "Closed"}
                          </span>
                        )}
                        {nearbyCity_fetching && (
                          <span className="split-nearby-city--loading">
                            (finding nearest city…) ·{" "}
                          </span>
                        )}
                        {!nearbyCity_fetching &&
                          nearbyCity &&
                          `${nearbyCity} · `}
                        {sign === "exact"
                          ? "✓ matches GPX"
                          : sign === "under"
                            ? `${absDiff.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${dLabel} left`
                            : `${absDiff.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${dLabel} over`}
                      </span>
                    )}
                  </>
                );
              })()}
            </div>
          )}
        </div>
      </div>

      {!collapsed && (
        <div className="split-view-bar">
          <div className="split-layout-toggles">
            <button
              type="button"
              className={`split-layout-btn${showForm ? " active" : ""}`}
              onClick={() => {
                if (showForm && !showMap) return;
                setShowForm((v) => !v);
              }}
            >
              Form
            </button>
            <button
              type="button"
              className={`split-layout-btn${showMap ? " active" : ""}`}
              disabled={!mapAvailable}
              onClick={() => {
                if (!showForm && showMap) return;
                setShowMap((v) => !v);
              }}
            >
              Map
            </button>
          </div>
          <div className="split-action-buttons">
            {onZoomToSplit && (
              <button
                type="button"
                className="split-action-btn zoom-to-map-btn"
                title="Zoom course map to this split"
                onClick={() => onZoomToSplit()}
              >
                <i className="fa-regular fa-map"></i>
              </button>
            )}
            {(canMoveToNextSeg ||
              canShiftUp ||
              canShiftDown ||
              canMoveToNextSeg ||
              canDelete) && <span className="view-bar-separator" />}
            {canMoveToPrevSeg && (
              <button
                type="button"
                className="split-action-btn"
                title="Move to previous segment"
                onClick={() => onMoveToPrevSeg?.()}
              >
                <i className="fas fa-arrow-up" /> Prev Seg
              </button>
            )}
            {canShiftUp && (
              <button
                type="button"
                className="split-action-btn"
                title="Shift up"
                onClick={() => onShiftUp?.()}
              >
                <i className="fa-solid fa-arrow-up"></i>
              </button>
            )}
            {canShiftDown && (
              <button
                type="button"
                className="split-action-btn"
                title="Shift down"
                onClick={() => onShiftDown?.()}
              >
                {/* ↓ */}
                <i className="fa-solid fa-arrow-down"></i>
              </button>
            )}
            {canMoveToNextSeg && (
              <button
                type="button"
                className="split-action-btn"
                title="Move to next segment"
                onClick={() => onMoveToNextSeg?.()}
              >
                <i className="fas fa-arrow-down" /> Next Seg
              </button>
            )}
            {canDelete && (
              <button
                type="button"
                className="split-action-btn split-action-btn--delete"
                title="Delete this split"
                onClick={() => setConfirmDeleteSplitOpen(true)}
              >
                <i className="fa-solid fa-trash"></i>
              </button>
            )}
          </div>
        </div>
      )}

      {!collapsed &&
        (() => {
          // ── Shared form content (distance, overrides, sub-splits, rest stop) ──
          const formContent = (
            <div>
              {/* Row 1: Distance */}
              <div className="field">
                <label htmlFor={`${prefix}-distance`}>
                  Distance ({dLabel}) *
                </label>
                <NumberInput
                  id={`${prefix}-distance`}
                  step="0.25"
                  min="0"
                  value={value.distance}
                  onChange={(v) => update({ distance: v })}
                  placeholder="e.g. 50"
                />
                <FieldError fieldId={`${prefix}-distance`} />
              </div>

              {/* Action row: Overrides toggle */}
              <button
                type="button"
                className="section-action-row"
                onClick={() => setShowOptional(!showOptional)}
              >
                <span className={`chevron${showOptional ? " open" : ""}`}>
                  ▶
                </span>
                Overrides
              </button>

              {showOptional && (
                <div className="optional-fields fields-grid">
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

                  <TimeInput
                    id={`${prefix}-down-time`}
                    label="Down Time"
                    value={value.down_time}
                    onChange={(v) => update({ down_time: v })}
                    optional
                    disabled={isLast && !includeEndDownTime}
                    disabledTitle="Down time excluded on last split (see segment setting)"
                  />

                  <TimeInput
                    id={`${prefix}-adj-time`}
                    label="Adj. Time"
                    value={value.adjustment_time}
                    onChange={(v) => update({ adjustment_time: v })}
                    optional
                    allowNegative
                  />

                  {/* Sub-split override */}
                  <div className="field">
                    <label htmlFor={`${prefix}-ss-mode`}>Sub-Splits</label>
                    <select
                      id={`${prefix}-ss-mode`}
                      value={
                        value.sub_split_override ? value.sub_split_mode : ""
                      }
                      onChange={(e) => {
                        if (e.target.value === "") {
                          update({ sub_split_override: false });
                        } else {
                          update({
                            sub_split_override: true,
                            sub_split_mode: e.target.value as SubSplitMode,
                          });
                        }
                      }}
                    >
                      <option value="">
                        Inherits (
                        {courseSplitMode === "hour"
                          ? "Hourly"
                          : courseSplitMode === "even"
                            ? "Even"
                            : courseSplitMode === "fixed"
                              ? "Fixed Size"
                              : "Custom"}
                        )
                      </option>
                      <option value="hour">Hourly</option>
                      <option value="even">Even</option>
                      <option value="fixed">Fixed Size</option>
                      <option value="custom">Custom</option>
                    </select>
                  </div>

                  {value.sub_split_override &&
                    value.sub_split_mode === "even" && (
                      <div className="field">
                        <label htmlFor={`${prefix}-ss-count`}>Count *</label>
                        <NumberInput
                          id={`${prefix}-ss-count`}
                          min="1"
                          step="1"
                          value={value.sub_split_count}
                          onChange={(v) => update({ sub_split_count: v })}
                          placeholder="1"
                        />
                        <FieldError fieldId={`${prefix}-ss-count`} />
                      </div>
                    )}

                  {value.sub_split_override &&
                    value.sub_split_mode === "fixed" && (
                      <>
                        <div className="field">
                          <label htmlFor={`${prefix}-ss-distance`}>
                            Size ({dLabel}) *
                          </label>
                          <NumberInput
                            id={`${prefix}-ss-distance`}
                            step="any"
                            value={value.sub_split_distance}
                            onChange={(v) => update({ sub_split_distance: v })}
                            placeholder="e.g. 20"
                          />
                          <FieldError fieldId={`${prefix}-ss-distance`} />
                        </div>
                        <div className="field">
                          <label htmlFor={`${prefix}-ss-threshold`}>
                            Last Threshold ({dLabel}) *
                          </label>
                          <NumberInput
                            id={`${prefix}-ss-threshold`}
                            step="any"
                            value={value.last_sub_split_threshold}
                            onChange={(v) =>
                              update({ last_sub_split_threshold: v })
                            }
                            placeholder="e.g. 10"
                          />
                          <FieldError fieldId={`${prefix}-ss-threshold`} />
                        </div>
                      </>
                    )}

                  {value.sub_split_override &&
                    value.sub_split_mode === "custom" && (
                      <div className="field field--full-width">
                        <label htmlFor={`${prefix}-ss-distances`}>
                          Distances (comma-sep.) *
                        </label>
                        <input
                          id={`${prefix}-ss-distances`}
                          type="text"
                          value={value.sub_split_distances}
                          onChange={(e) =>
                            update({ sub_split_distances: e.target.value })
                          }
                          placeholder="e.g. 10, 20, 30"
                        />
                        <FieldError fieldId={`${prefix}-ss-distances`} />
                      </div>
                    )}

                  <div className="field field--full-width">
                    <label htmlFor={`${prefix}-tz`}>
                      Split Timezone
                      {value.tzManuallySet && (
                        <button
                          type="button"
                          className="tz-reset-btn"
                          title="Clear manual override — re-enable auto-detection from GPX"
                          onClick={() =>
                            update({
                              differentTimezone: false,
                              tzManuallySet: false,
                            })
                          }
                        >
                          ✕ Reset to auto
                        </button>
                      )}
                    </label>
                    <TimezoneSelect
                      id={`${prefix}-tz`}
                      value={
                        value.differentTimezone ? value.timezone : courseTz
                      }
                      onChange={(tz) =>
                        update(
                          tz === courseTz
                            ? { differentTimezone: false, tzManuallySet: false }
                            : {
                                differentTimezone: true,
                                timezone: tz,
                                tzManuallySet: true,
                              },
                        )
                      }
                    />
                  </div>
                </div>
              )}

              {/* Rest stop */}
              <RestStopFormComponent
                prefix={`${prefix}-rs`}
                value={value.rest_stop}
                onChange={(rs) => update({ rest_stop: rs })}
                addressLoading={addressLoading}
                etaInfo={etaInfo}
              />

              {/* Notes */}
              <div className="field split-notes-field">
                <label htmlFor={`${prefix}-notes`}>Notes</label>
                <textarea
                  id={`${prefix}-notes`}
                  className="split-notes-textarea"
                  rows={3}
                  placeholder="Optional rider notes for this split…"
                  value={value.notes ?? ""}
                  onChange={(e) => update({ notes: e.target.value })}
                />
              </div>
            </div>
          );

          // ── Map content (SplitEndpointMap) ──
          const mapContent = mapAvailable ? (
            <Suspense
              fallback={<div className="map-loading">Loading map…</div>}
            >
              <SplitEndpointMap
                gpxTrack={gpxTrack!}
                startKm={displayProfile!.startKm}
                endKm={displayProfile!.endKm}
                endLat={displayProfile!.endLat}
                endLon={displayProfile!.endLon}
                endpointDefined={endpointDefined}
                unitSystem={unitSystem}
                restStop={value.rest_stop}
                onSelectStop={(patch) =>
                  update({ rest_stop: { ...value.rest_stop, ...patch } })
                }
                onAddressLoading={setAddressLoading}
              />
            </Suspense>
          ) : null;

          // ── Results panel content ──

          const resultsContent = splitResult ? (
            <div className="split-results-panel">
              <dl className="split-results-grid">
                <div>
                  <dt title="Split start time">Start</dt>
                  <dd>
                    {fmtInTz(splitResult.start_time, splitStartTz ?? courseTz)}
                    {splitStartTz && splitStartTz !== courseTz && (
                      <span className="split-end-tz">
                        {" "}
                        {fmtInTz(splitResult.start_time, courseTz)}
                      </span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt title="Split end time (arrival at rest stop or next split)">
                    End
                  </dt>
                  <dd>
                    {fmtInTz(splitResult.end_time, splitEndTz ?? courseTz)}
                    {splitEndTz && splitEndTz !== courseTz && (
                      <span className="split-end-tz">
                        {" "}
                        {fmtInTz(splitResult.end_time, courseTz)}
                      </span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt title="Time spent actively riding or moving">Active</dt>
                  <dd
                    title={formatHours(splitResult.active_time_hours, "full")}
                  >
                    {formatHours(splitResult.active_time_hours)}
                  </dd>
                </div>
                <div>
                  <dt title="Time spent moving (excludes down time)">Moving</dt>
                  <dd
                    title={formatHours(splitResult.moving_time_hours, "full")}
                  >
                    {formatHours(splitResult.moving_time_hours)}
                  </dd>
                </div>
                <div>
                  <dt title="Time stopped or inactive">Down</dt>
                  <dd title={formatHours(splitResult.down_time_hours, "full")}>
                    {formatHours(splitResult.down_time_hours)}
                  </dd>
                </div>
                <div>
                  <dt title="Moving time + down time">Split Time</dt>
                  <dd
                    title={formatHours(
                      splitResult.moving_time_hours +
                        splitResult.down_time_hours,
                      "full",
                    )}
                  >
                    {formatHours(
                      splitResult.moving_time_hours +
                        splitResult.down_time_hours,
                    )}
                  </dd>
                </div>
                <div>
                  <dt title="Average moving speed across this split">Speed</dt>
                  <dd>
                    {splitResult.moving_speed.toFixed(2)} {sLabel}
                  </dd>
                </div>
                <div>
                  <dt title="Average pace across this split">Pace</dt>
                  <dd>
                    {splitResult.pace.toFixed(2)} {sLabel}
                  </dd>
                </div>
                {splitResult.adjustment_time_hours != null &&
                  splitResult.adjustment_time_hours !== 0 && (
                    <div>
                      <dt title="Manual time adjustment applied to this split">
                        Adj. Time
                      </dt>
                      <dd
                        title={formatHours(
                          splitResult.adjustment_time_hours,
                          "full",
                        )}
                      >
                        {formatHours(splitResult.adjustment_time_hours)}
                      </dd>
                    </div>
                  )}
                {etaInfo && (
                  <div style={{ gridColumn: "1 / -1" }}>
                    <dt title="These are the hours for the rest stop at the estimated time of arrival.">
                      Rest Stop Hours
                    </dt>
                    <dd>
                      <span>{etaInfo.hoursLabel}</span>
                      {etaInfo.nearDetail && (
                        <span className="split-results-near-detail">
                          {etaInfo.nearDetail}
                        </span>
                      )}
                    </dd>
                  </div>
                )}
              </dl>
              {value.rest_stop.enabled &&
                (value.rest_stop.name ||
                  value.rest_stop.address ||
                  value.rest_stop.alt ||
                  value.notes) && (
                  <div className="split-results-rs-info">
                    {value.rest_stop.name && (
                      <div className="split-results-rs-name">
                        {value.rest_stop.alt ? (
                          <a
                            href={value.rest_stop.alt}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {value.rest_stop.name}
                          </a>
                        ) : (
                          value.rest_stop.name
                        )}
                      </div>
                    )}
                    {value.rest_stop.address && (
                      <div className="split-results-rs-address">
                        {value.rest_stop.address}
                      </div>
                    )}
                    {!value.rest_stop.name && value.rest_stop.alt && (
                      <div className="split-results-rs-address">
                        <a
                          href={value.rest_stop.alt}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {value.rest_stop.alt}
                        </a>
                      </div>
                    )}
                    {value.notes && (
                      <div className="split-results-rs-notes">
                        {value.notes}
                      </div>
                    )}
                  </div>
                )}
              {splitResult.sub_splits.length > 0 && (
                <details className="split-sub-splits">
                  <summary>
                    Sub-splits ({splitResult.sub_splits.length})
                  </summary>
                  <table className="split-sub-splits-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Dist</th>
                        <th>Moving</th>
                        <th>Down</th>
                      </tr>
                    </thead>
                    <tbody>
                      {splitResult.sub_splits.map(
                        (ss: SubSplitDetail, i: number) => (
                          <tr key={i}>
                            <td>{i + 1}</td>
                            <td>
                              {ss.distance.toLocaleString(undefined, {
                                minimumFractionDigits: 1,
                                maximumFractionDigits: 1,
                              })}{" "}
                              {dLabel}
                            </td>
                            <td>{formatHours(ss.moving_time_hours)}</td>
                            <td>{formatHours(ss.down_time_hours)}</td>
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                </details>
              )}
            </div>
          ) : (
            <div className="split-results-panel split-results-panel--empty">
              <span>No results — calculate first</span>
            </div>
          );

          const hasFormOrMap = showForm || (showMap && mapAvailable);
          const formMapPane = hasFormOrMap
            ? (() => {
                if (isNarrow) {
                  return (
                    <div className="split-two-pane split-two-pane--stacked">
                      {showForm && (
                        <div className="split-form-col">{formContent}</div>
                      )}
                      {showMap && mapAvailable && (
                        <div className="split-map-col">{mapContent}</div>
                      )}
                    </div>
                  );
                }
                if (showForm && showMap && mapAvailable) {
                  return (
                    <div className="split-two-pane">
                      <div
                        className="split-form-col"
                        style={{ width: formColWidth }}
                      >
                        {formContent}
                      </div>
                      <div
                        ref={resizeHandleRef}
                        className="split-resize-handle"
                        onMouseDown={(e) => {
                          isDragging.current = true;
                          dragStartX.current = e.clientX;
                          dragStartWidth.current = formColWidth;
                          resizeHandleRef.current?.classList.add("active");
                          e.preventDefault();
                        }}
                      />
                      <div className="split-map-col">{mapContent}</div>
                    </div>
                  );
                }
                if (showMap && mapAvailable) {
                  return (
                    <div className="split-two-pane">
                      <div className="split-map-col--full">{mapContent}</div>
                    </div>
                  );
                }
                return <div className="split-body">{formContent}</div>;
              })()
            : null;

          if (!showResults) {
            return (
              formMapPane ?? <div className="split-body">{formContent}</div>
            );
          }

          return (
            <div className="split-stacked-layout">
              <div className="split-results-row">{resultsContent}</div>
              {formMapPane}
            </div>
          );
        })()}
      <ConfirmModal
        open={confirmDeleteSplitOpen}
        title="Delete Split"
        message={`Delete ${headerTitle}?`}
        confirmLabel="Delete Split"
        cancelLabel="Cancel"
        onCancel={() => setConfirmDeleteSplitOpen(false)}
        onConfirm={() => {
          setConfirmDeleteSplitOpen(false);
          onDelete?.();
        }}
      />
    </div>
  );
}
