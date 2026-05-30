import { useState, useEffect, useRef, lazy, Suspense, useMemo } from "react";
import tzlookup from "tz-lookup";
import type {
  SplitForm,
  SubSplitMode,
  UnitSystem,
  SplitGpxProfile,
  GpxTrackPoint,
  SplitDetail,
  SubSplitDetail,
  Mode,
} from "../types";
import { speedLabel, distanceLabel, formatHours } from "../utils";
import {
  interpolateLatLon,
  findNearestTrackPoint,
} from "../calculator/gpxParser";
import { DEFAULT_INTERMEDIATE_REST_STOP } from "../defaults";
import {
  buildDetailedNearDetail,
  checkArrivalVsHoursDetailed,
  dayIndexInTimezone,
  formatArrivalTimeWithTz,
  hoursLabelForEntry,
  timezoneAbbreviationAt,
} from "../timeMath";
import { SteepBadge } from "./GradeTooltip";

interface EtaInfo {
  status: "open" | "near-open" | "near-close" | "closed";
  statusWord: string; // e.g. "Open", "Near open", "Near close", "Closed"
  hoursLabel: string; // e.g. "6:00 AM - 10:00 PM" or "24 hours" or "Closed"
  nearDetail: string | null; // e.g. "5 min before opening" or "10 min after closing"
  arrivalTime: string; // e.g. "1:31 PM EDT"
  timezone?: string;
}

import TimeInput from "./TimeInput";
import RestStopFormComponent from "./RestStopForm";
import TimezoneSelect from "./TimezoneSelect";
import { FieldError } from "./FieldError";
import NumberInput from "./NumberInput";
import ConfirmModal from "./ConfirmModal";
import MapErrorBoundary from "./MapErrorBoundary";
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
  /** Course calculation mode (distance vs target_distance). */
  mode: Mode;
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
  mode,
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
    value.differentTimezone;
  const [showOptional, setShowOptional] = useState(hasOptionalValues);
  const [showSubSplits, setShowSubSplits] = useState(
    value.sub_split_override ?? false,
  );
  const [showResultSubSplits, setShowResultSubSplits] = useState(false);
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
          gradeBuckets: {
            b2: 0,
            b4: 0,
            b6: 0,
            b8: 0,
            b10: 0,
            b12: 0,
            b14: 0,
            b16: 0,
            b18: 0,
            b18plus: 0,
            bn2: 0,
            bn4: 0,
            bn6: 0,
            bn8: 0,
            bn10: 0,
            bn12: 0,
            bn14: 0,
            bn16: 0,
            bn18: 0,
            bn18plus: 0,
          },
          minGradePct: 0,
          maxGradePct: 0,
          surface: "unknown",
          startLat: gpxTrack[0].lat,
          startLon: gpxTrack[0].lon,
          endLat: gpxTrack[gpxTrack.length - 1].lat,
          endLon: gpxTrack[gpxTrack.length - 1].lon,
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
      timezone: tz,
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

  const KM_PER_MI = 1.60934;
  // Threshold: the intermediate stop feature requires > 20 mi (32.187 km) between endpoints
  const INTERMEDIATE_MIN_KM = 32.187;

  // Split distance in km from GPX profile (or approximated from user input)
  const splitDistKm = useMemo(() => {
    if (displayProfile) return displayProfile.endKm - displayProfile.startKm;
    const d = parseFloat(value.distance);
    if (isNaN(d)) return 0;
    return unitSystem === "imperial" ? d * KM_PER_MI : d;
  }, [displayProfile, value.distance, unitSystem]);

  // Whether the intermediate stop feature is available for this split
  const intermediateAvailable = splitDistKm >= INTERMEDIATE_MIN_KM;

  // Auto-populate distance when the intermediate stop is first enabled
  const intermediateStop =
    value.intermediate_stop ?? DEFAULT_INTERMEDIATE_REST_STOP;

  // If the split gets shortened below the intermediate-stop threshold,
  // hide/disable any previously-set intermediate stop so map/popup UI stays consistent.
  useEffect(() => {
    if (intermediateAvailable) return;
    if (!intermediateStop.enabled) return;
    update({
      intermediate_stop: {
        ...intermediateStop,
        enabled: false,
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intermediateAvailable, intermediateStop.enabled]);

  // Compute the midpoint distance string in the appropriate mode/units
  const computeIntermediateMidpoint = (): string => {
    if (mode === "target_distance") {
      // cumulative midpoint: (startUserDist + endUserDist) / 2
      const endUser = cumulativeDist ?? 0;
      const startUser = endUser - (splitDistUser ?? 0);
      const mid = (startUser + endUser) / 2;
      return mid.toFixed(2);
    } else {
      // relative midpoint: splitDistUser / 2
      const mid =
        (splitDistUser ??
          splitDistKm / (unitSystem === "imperial" ? KM_PER_MI : 1)) / 2;
      return mid.toFixed(2);
    }
  };

  // km position along the GPX track for the intermediate stop
  const intermediateKm = useMemo(() => {
    if (!intermediateStop.enabled || !intermediateStop.distance.trim())
      return null;
    const d = parseFloat(intermediateStop.distance);
    if (isNaN(d)) return null;
    const dKm = d * (unitSystem === "imperial" ? KM_PER_MI : 1);
    if (mode === "target_distance") {
      return dKm; // cumulative km from track start
    } else {
      return (displayProfile?.startKm ?? 0) + dKm; // relative from split start
    }
  }, [
    intermediateStop.enabled,
    intermediateStop.distance,
    mode,
    unitSystem,
    displayProfile?.startKm,
  ]);

  // Distance from split start to the intermediate stop, in user units.
  // Snaps via findNearestTrackPoint when lat/lon are present (stop may be off-route),
  // otherwise falls back to intermediateKm (derived from the distance field).
  const intermediateDistFromStart = useMemo(() => {
    if (!intermediateStop.enabled) return null;
    let cumKm: number | null = null;
    if (
      intermediateStop.lat != null &&
      intermediateStop.lon != null &&
      gpxTrack &&
      gpxTrack.length > 0 &&
      displayProfile
    ) {
      const snapped = findNearestTrackPoint(
        gpxTrack,
        intermediateStop.lat,
        intermediateStop.lon,
        displayProfile.startKm,
        displayProfile.endKm,
      );
      if (snapped) cumKm = snapped.cumDist - displayProfile.startKm;
    } else if (intermediateKm != null) {
      cumKm = intermediateKm - (displayProfile?.startKm ?? 0);
    }
    if (cumKm == null) return null;
    return unitSystem === "imperial" ? cumKm / KM_PER_MI : cumKm;
  }, [
    intermediateStop.enabled,
    intermediateStop.lat,
    intermediateStop.lon,
    intermediateKm,
    gpxTrack,
    displayProfile,
    unitSystem,
  ]);

  const intermediateEtaIso = (() => {
    if (!splitResult || !value.intermediate_stop?.enabled) return null;

    const startMs = Date.parse(splitResult.start_time);
    const endMs = Date.parse(splitResult.end_time);
    if (
      !Number.isFinite(startMs) ||
      !Number.isFinite(endMs) ||
      endMs < startMs
    ) {
      return null;
    }

    let ratio: number | null = null;

    // Prefer GPX-profile interpolation because it is correct in both
    // relative-distance and target-distance split modes.
    if (intermediateKm != null && displayProfile) {
      const denomKm = displayProfile.endKm - displayProfile.startKm;
      if (Number.isFinite(denomKm) && denomKm > 0) {
        ratio = (intermediateKm - displayProfile.startKm) / denomKm;
      }
    }

    // Fallback to form-entered distance. In target-distance mode this value
    // is cumulative from route start, so convert it to split-relative first.
    if (ratio == null) {
      const rawStopDist = parseFloat(value.intermediate_stop.distance);
      let relStopDist = rawStopDist;

      if (Number.isFinite(rawStopDist) && mode === "target_distance") {
        const splitEndUser =
          cumulativeDist != null ? cumulativeDist : parseFloat(value.distance);
        const splitLenUserNum = Number(splitDistUser);
        if (
          Number.isFinite(splitEndUser) &&
          Number.isFinite(splitLenUserNum)
        ) {
          const splitStartUser = splitEndUser - splitLenUserNum;
          relStopDist = rawStopDist - splitStartUser;
        }
      }

      const denom = splitDistUser ?? parseFloat(value.distance);

      if (
        Number.isFinite(relStopDist) &&
        Number.isFinite(denom) &&
        denom > 0
      ) {
        ratio = relStopDist / denom;
      }
    }

    if (ratio == null || !Number.isFinite(ratio)) return null;
    const clamped = Math.max(0, Math.min(1, ratio));
    const etaMs = startMs + (endMs - startMs) * clamped;
    return new Date(etaMs).toISOString();
  })();

  const intermediateStopTz = useMemo(() => {
    const fallbackTz = splitEndTz ?? courseTz;
    if (!intermediateStop.enabled) return fallbackTz;

    let lat: number | null = null;
    let lon: number | null = null;

    if (
      intermediateStop.lat != null &&
      intermediateStop.lon != null &&
      Number.isFinite(intermediateStop.lat) &&
      Number.isFinite(intermediateStop.lon)
    ) {
      if (
        gpxTrack &&
        gpxTrack.length > 0 &&
        displayProfile &&
        Number.isFinite(displayProfile.startKm) &&
        Number.isFinite(displayProfile.endKm)
      ) {
        const snapped = findNearestTrackPoint(
          gpxTrack,
          intermediateStop.lat,
          intermediateStop.lon,
          displayProfile.startKm,
          displayProfile.endKm,
        );
        if (snapped) {
          lat = snapped.lat;
          lon = snapped.lon;
        }
      }

      if (lat == null || lon == null) {
        lat = intermediateStop.lat;
        lon = intermediateStop.lon;
      }
    } else if (intermediateKm != null && gpxTrack && gpxTrack.length > 0) {
      const pt = interpolateLatLon(gpxTrack, intermediateKm);
      if (pt) {
        lat = pt.lat;
        lon = pt.lon;
      }
    }

    if (lat == null || lon == null) return fallbackTz;

    try {
      return tzlookup(lat, lon);
    } catch {
      return fallbackTz;
    }
  }, [
    splitEndTz,
    courseTz,
    intermediateStop.enabled,
    intermediateStop.lat,
    intermediateStop.lon,
    intermediateKm,
    gpxTrack,
    displayProfile,
  ]);

  const intermHoursInfo = (() => {
    const is = value.intermediate_stop;
    if (!is?.enabled || !splitResult || !intermediateEtaIso) return null;
    const tz = intermediateStopTz;
    const dayIdx = dayIndexInTimezone(intermediateEtaIso, tz);
    const entry = is.sameHoursEveryDay ? is.allDays : is.perDay[dayIdx];
    const status = checkArrivalVsHoursDetailed(
      intermediateEtaIso,
      entry,
      tz,
      etaMarginOpen,
      etaMarginClose,
    );
    if (!status) return null;
    const hoursLabel = hoursLabelForEntry(entry);
    const nearDetail =
      status === "near-open" || status === "near-close"
        ? buildDetailedNearDetail(status, intermediateEtaIso, entry, tz)
        : null;
    const statusWords: Record<string, string> = {
      open: "Open",
      "near-open": "Near open",
      "near-close": "Near close",
      closed: "Closed",
    };
    const arrivalTime = formatArrivalTimeWithTz(intermediateEtaIso, tz);
    return {
      status,
      statusWord: statusWords[status],
      hoursLabel,
      nearDetail,
      arrivalTime,
      timezone: tz,
    };
  })();

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
                      <SteepBadge
                        steepPct={gpxProfile.steepPct}
                        gradeBuckets={gpxProfile.gradeBuckets}
                        minGradePct={gpxProfile.minGradePct}
                        maxGradePct={gpxProfile.maxGradePct}
                      />
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
                            title={`${etaInfo.statusWord} (${etaInfo.nearDetail ? etaInfo.nearDetail : etaInfo.hoursLabel})${value.intermediate_stop?.enabled && intermHoursInfo ? ` | ${value.intermediate_stop.name || "Intermediate stop"}: ${intermHoursInfo.statusWord} (${intermHoursInfo.nearDetail ? intermHoursInfo.nearDetail : intermHoursInfo.hoursLabel})` : ""}`}
                          >
                            {value.rest_stop.enabled &&
                              (value.rest_stop.name?.trim() || "Rest stop")}
                            &mdash;
                            {etaInfo.status === "open" &&
                              (etaInfo.hoursLabel === "24 hours"
                                ? "24/7"
                                : "Open")}
                            {etaInfo.status === "near-open" && "Near open"}
                            {etaInfo.status === "near-close" && "Near close"}
                            {etaInfo.status === "closed" && "Closed"}
                          </span>
                        )}
                        {value.intermediate_stop?.enabled && (
                          <span
                            className={`intermediate-stop-asterisk${intermHoursInfo ? ` intermediate-stop-asterisk--${intermHoursInfo.status}` : ""}`}
                            title={`Intermediate stop${value.intermediate_stop.name ? `: ${value.intermediate_stop.name}` : ""}${intermHoursInfo ? ` | ${intermHoursInfo.statusWord} (${intermHoursInfo.nearDetail ? intermHoursInfo.nearDetail : intermHoursInfo.hoursLabel})` : ""}`}
                            aria-label="Intermediate stop set"
                          >
                            *
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
          {mapAvailable && (
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
          )}
          <div className="split-action-buttons">
            {onZoomToSplit && (
              <button
                type="button"
                className="split-action-btn zoom-to-map-btn"
                title="Zoom course map to this split"
                onClick={() => onZoomToSplit()}
              >
                <i className="fa-solid fa-route"></i>
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
                        update({
                          differentTimezone: true,
                          timezone: tz,
                          tzManuallySet: true,
                        })
                      }
                    />
                  </div>
                </div>
              )}

              {/* Sub-splits */}
              <button
                type="button"
                className="section-action-row"
                onClick={() => setShowSubSplits(!showSubSplits)}
              >
                <span className={`chevron${showSubSplits ? " open" : ""}`}>
                  ▶
                </span>
                Sub-splits
              </button>

              {showSubSplits && (
                <div className="optional-fields fields-grid">
                  <div className="field">
                    <label htmlFor={`${prefix}-ss-mode`}>Mode</label>
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

              {/* Intermediate rest stop — only available when split > 20 mi */}
              {intermediateAvailable && (
                <div className="rs-section">
                  <div
                    className={`rs-toggle-row${intermediateStop.enabled ? " open" : ""}`}
                  >
                    <div className="rs-header-name">
                      <span className="rs-toggle-label">
                        Intermediate Rest Stop
                      </span>
                      {intermediateDistFromStart != null && (
                        <span
                          className="rs-interm-dist"
                          title="Distance from split start to this stop (snapped to nearest track point)"
                        >
                          {` (~${intermediateDistFromStart.toLocaleString(
                            undefined,
                            {
                              minimumFractionDigits: 1,
                              maximumFractionDigits: 1,
                            },
                          )} ${dLabel})`}
                        </span>
                      )}
                    </div>
                    <label className="toggle-switch">
                      <input
                        id={`${prefix}-interm-enabled`}
                        type="checkbox"
                        checked={intermediateStop.enabled}
                        onChange={(e) => {
                          const enabled = e.target.checked;
                          const nextDistance =
                            enabled && !intermediateStop.distance.trim()
                              ? computeIntermediateMidpoint()
                              : intermediateStop.distance;

                          // Pre-populate the address with the track coordinate
                          // on first enable so the geocoder/lat-lon path is
                          // consistent from the start.
                          let nextAddress = intermediateStop.address;
                          if (
                            enabled &&
                            !intermediateStop.address.trim() &&
                            gpxTrack
                          ) {
                            const d = parseFloat(nextDistance);
                            if (!isNaN(d)) {
                              const dKm =
                                d * (unitSystem === "imperial" ? KM_PER_MI : 1);
                              const midKm =
                                mode === "target_distance"
                                  ? dKm
                                  : (displayProfile?.startKm ?? 0) + dKm;
                              const pt = interpolateLatLon(gpxTrack, midKm);
                              if (pt) {
                                nextAddress = `${pt.lat.toFixed(6)}, ${pt.lon.toFixed(6)}`;
                              }
                            }
                          }

                          update({
                            intermediate_stop: {
                              ...intermediateStop,
                              enabled,
                              distance: nextDistance,
                              address: nextAddress,
                            },
                          });
                        }}
                      />
                      <span className="toggle-track" />
                      <span className="toggle-thumb" />
                    </label>
                  </div>

                  {intermediateStop.enabled && (
                    <div className="rs-section-body">
                      {/* Rest stop form for the intermediate stop */}
                      <RestStopFormComponent
                        prefix={`${prefix}-interm-rs`}
                        hideToggle
                        value={{
                          enabled: true,
                          name: intermediateStop.name,
                          address: intermediateStop.address,
                          alt: intermediateStop.alt,
                          lat: intermediateStop.lat,
                          lon: intermediateStop.lon,
                          googlePlaceId: intermediateStop.googlePlaceId,
                          sameHoursEveryDay: intermediateStop.sameHoursEveryDay,
                          allDays: intermediateStop.allDays,
                          perDay: intermediateStop.perDay,
                        }}
                        etaInfo={
                          intermHoursInfo
                            ? {
                                ...intermHoursInfo,
                                arrivalTime: intermHoursInfo.arrivalTime,
                              }
                            : null
                        }
                        onChange={(rs) =>
                          update({
                            intermediate_stop: {
                              ...intermediateStop,
                              name: rs.name,
                              address: rs.address,
                              alt: rs.alt,
                              lat: rs.lat,
                              lon: rs.lon,
                              googlePlaceId: rs.googlePlaceId,
                              sameHoursEveryDay: rs.sameHoursEveryDay,
                              allDays: rs.allDays,
                              perDay: rs.perDay,
                            },
                          })
                        }
                      />
                    </div>
                  )}
                </div>
              )}

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
            <MapErrorBoundary
              resetKey={`${displayProfile?.endLat},${displayProfile?.endLon}`}
              boundaryName="split-endpoint-map"
            >
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
                showPlanningControls={true}
                restStop={value.rest_stop}
                onSelectStop={(patch) =>
                  update({ rest_stop: { ...value.rest_stop, ...patch } })
                }
                onAddressLoading={setAddressLoading}
                intermediateStop={value.intermediate_stop}
                intermediateKm={intermediateKm}
                onSelectIntermediateStop={(patch) =>
                  intermediateAvailable
                    ? update({
                        intermediate_stop: { ...intermediateStop, ...patch },
                      })
                    : undefined
                }
                onPolylineClick={(absoluteKm, lat, lon) => {
                  let formDist: number;
                  if (mode === "target_distance") {
                    formDist =
                      absoluteKm / (unitSystem === "imperial" ? KM_PER_MI : 1);
                  } else {
                    const relKm = absoluteKm - (displayProfile?.startKm ?? 0);
                    formDist =
                      relKm / (unitSystem === "imperial" ? KM_PER_MI : 1);
                  }
                  update({
                    intermediate_stop: {
                      ...intermediateStop,
                      enabled: true,
                      distance: formDist.toFixed(3),
                      address: `${lat.toFixed(6)}, ${lon.toFixed(6)}`,
                      lat: undefined,
                      lon: undefined,
                    },
                  });
                }}
              />
              </Suspense>
            </MapErrorBoundary>
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
              </dl>
              {(() => {
                const hasRest =
                  value.rest_stop.enabled &&
                  (value.rest_stop.name ||
                    value.rest_stop.address ||
                    value.rest_stop.alt ||
                    etaInfo);
                const hasInterm =
                  value.intermediate_stop?.enabled &&
                  (value.intermediate_stop.name ||
                    value.intermediate_stop.address ||
                    value.intermediate_stop.alt ||
                    intermHoursInfo);
                const stopCount = (hasRest ? 1 : 0) + (hasInterm ? 1 : 0);
                if (!stopCount) return null;
                return (
                  <div className="split-results-stops">
                    <div className="split-results-stops-header">
                      <i className="fa-solid fa-map-pin" aria-hidden="true" />
                      <span className="split-results-stops-label">Stops</span>
                      <span className="split-results-stops-count">
                        {stopCount} {stopCount === 1 ? "stop" : "stops"}
                      </span>
                    </div>

                    {hasRest && (
                      <div className="split-results-stop-row">
                        <div className="split-results-stop-icon split-results-stop-icon--rest">
                          <i
                            className="fa-solid fa-location-dot"
                            aria-hidden="true"
                          />
                        </div>
                        <div className="split-results-stop-body">
                          <span className="split-results-rs-badge">
                            Rest Stop
                          </span>
                          {(value.rest_stop.name || value.rest_stop.alt) && (
                            <div className="split-results-rs-name">
                              {value.rest_stop.alt ? (
                                <a
                                  href={value.rest_stop.alt}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  {value.rest_stop.name || value.rest_stop.alt}
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
                        </div>
                        {etaInfo && (
                          <div
                            className={`split-results-stop-hours split-results-stop-hours--${etaInfo.status}`}
                          >
                            <span className="split-results-stop-dot" />
                            <span>{etaInfo.hoursLabel}</span>
                            {etaInfo.nearDetail && (
                              <span className="split-results-stop-near">
                                {etaInfo.nearDetail}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {hasInterm && (
                      <div className="split-results-stop-row">
                        <div className="split-results-stop-icon split-results-stop-icon--interm">
                          <i
                            className="fa-solid fa-location-dot"
                            aria-hidden="true"
                          />
                        </div>
                        <div className="split-results-stop-body">
                          <span className="split-results-rs-badge split-results-rs-badge--interm">
                            Intermediate Stop
                          </span>
                          {(value.intermediate_stop.name ||
                            value.intermediate_stop.alt) && (
                            <div className="split-results-rs-name">
                              {value.intermediate_stop.alt ? (
                                <a
                                  href={value.intermediate_stop.alt}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  {value.intermediate_stop.name ||
                                    value.intermediate_stop.alt}
                                </a>
                              ) : (
                                value.intermediate_stop.name
                              )}
                            </div>
                          )}
                          {value.intermediate_stop.address && (
                            <div className="split-results-rs-address">
                              {value.intermediate_stop.address}
                            </div>
                          )}
                        </div>
                        {intermHoursInfo && (
                          <div
                            className={`split-results-stop-hours split-results-stop-hours--${intermHoursInfo.status}`}
                            title={
                              intermHoursInfo.timezone
                                ? `Resolved timezone: ${intermHoursInfo.timezone}`
                                : undefined
                            }
                          >
                            <span className="split-results-stop-dot" />
                            <span>{intermHoursInfo.hoursLabel}</span>
                            {intermHoursInfo.nearDetail && (
                              <span className="split-results-stop-near">
                                {intermHoursInfo.nearDetail}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}
              {!!value.notes?.trim() && (
                <div className="split-results-stops">
                  <div className="split-results-stops-header">
                    <i
                      className="fa-regular fa-note-sticky"
                      aria-hidden="true"
                    />
                    <span className="split-results-stops-label">
                      Split Notes
                    </span>
                  </div>
                  <div className="split-results-rs-notes">{value.notes}</div>
                </div>
              )}
              {splitResult.sub_splits.length > 0 && (
                <>
                  <button
                    type="button"
                    className="section-action-row"
                    onClick={() => setShowResultSubSplits((v) => !v)}
                  >
                    <span
                      className={`chevron${showResultSubSplits ? " open" : ""}`}
                    >
                      ▶
                    </span>
                    Sub-splits ({splitResult.sub_splits.length})
                  </button>
                  {showResultSubSplits && (
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
                  )}
                </>
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
