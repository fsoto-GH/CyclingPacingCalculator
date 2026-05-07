import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useDeferredValue,
  lazy,
  Suspense,
} from "react";
import type {
  CourseForm as CourseFormState,
  SegmentForm as SegmentFormState,
  CourseDetail,
  GpxTrackPoint,
  SplitGpxProfile,
  SubSplitMode,
  UnitSystem,
} from "../types";
import { makeDefaultDayHours } from "../types";
import type { RestStopForm as RestStopFormType } from "../types";
import {
  nowLocalDatetime,
  speedLabel,
  distanceLabel,
  minutesToHms,
  formatHours,
  formatStartTimeHint,
} from "../utils";
import {
  formatIsoInTzShort,
  formatRawDualRatio,
  formatRawRatio,
  formatRatioPercent,
} from "../timeMath";
import { makeDefaultSplit } from "../defaults";
import { serializeCourse } from "../serialization";
import { calculateCourse } from "../api";
import { processCourse, CalcError } from "../calculator/courseProcessor";
import {
  parseGpx,
  computeAllProfiles,
  computeElevGainLoss,
  extractSurfaceFromXml,
  interpolateLatLon,
} from "../calculator/gpxParser";
import {
  computeHourlyCoursePoints,
  fetchHourlyCourseWeather,
  deriveWeatherPairsFromHourly,
  type SplitWeatherPair,
} from "../calculator/weather";
import type { HourlyWeatherPoint } from "../types";
import { useAppSettings } from "../AppSettingsContext";
import { PAID_APIS_ENABLED } from "../config";
import tzlookup from "tz-lookup";
import { getCachedGeocode, reverseGeocode } from "../calculator/geocode";
import { saveGpx, loadGpx, clearGpx } from "../gpxStore";
import SegmentFormComponent from "./SegmentForm";
import InsertZone from "./InsertZone";
const CourseMap = lazy(() => import("./CourseMap"));

/** Thin wrapper that defers the two props that change on every keystroke so
 *  the map renders at low priority and input fields stay responsive. */
function CourseMapDeferred(props: React.ComponentProps<typeof CourseMap>) {
  const deferredSplitBoundariesKm = useDeferredValue(props.splitBoundariesKm);
  const deferredFormSegments = useDeferredValue(props.formSegments);
  return (
    <CourseMap
      {...props}
      splitBoundariesKm={deferredSplitBoundariesKm}
      formSegments={deferredFormSegments}
    />
  );
}

const LegendModal = lazy(() => import("./LegendModal"));
const ExampleModal = lazy(() => import("./ExampleModal"));
const FindNearbyModal = lazy(() => import("./FindNearbyModal"));
const ConfirmModal = lazy(() => import("./ConfirmModal"));
const ProjectionsView = lazy(() => import("./ProjectionsView.tsx"));
const GpxSearchModal = lazy(() => import("./GpxSearchModal"));
const RacePlanModal = lazy(() => import("./RacePlanModal"));
import { EXAMPLES } from "../examples";
import TimezoneSelect, { browserTimezone } from "./TimezoneSelect";
import { FieldErrorContext, FieldError, AllErrorsContext } from "./FieldError";
import NumberInput from "./NumberInput";
import PaidApiToggle from "./PaidApiToggle";
import { getRwgpsToken } from "../rwgpsAuth";

function makeDefaultSegment(): SegmentFormState {
  return {
    name: "",
    sleep_time: "",
    include_end_down_time: false,
    down_time_ratio: "",
    split_delta: "",
    moving_speed: "",
    min_moving_speed: "",
    splitCount: "1",
    splits: [makeDefaultSplit()],
    nullified: false,
    fixed_elapsed_time: "",
  };
}

const STORAGE_KEY = "ultra-cycling-planner-form";

const INITIAL_FORM: CourseFormState = {
  name: "Course",
  unitSystem: "imperial",
  mode: "distance",
  timezone: browserTimezone,
  sub_split_mode: "hour",
  sub_split_count: "1",
  sub_split_distance: "",
  last_sub_split_threshold: "20",
  sub_split_distances: "",
  init_moving_speed: "",
  min_moving_speed: "",
  down_time_ratio: "0",
  split_delta: "0",
  start_time: nowLocalDatetime(),
  segmentCount: "1",
  segments: [makeDefaultSegment()],
};

/** Migrate a rest stop from the old text-based format to the new DayHoursEntry format. */
function migrateRestStop(rs: any): RestStopFormType {
  // Already new format
  if (rs.allDays && rs.perDay) return rs as RestStopFormType;

  const defaults = makeDefaultDayHours();
  const allDays =
    rs.fixedHours === "24h"
      ? { mode: "24h" as const, opens: "06:00", closes: "22:00" }
      : defaults;
  const perDay = Array.from({ length: 7 }, () => ({
    ...defaults,
  })) as RestStopFormType["perDay"];

  return {
    backup: rs.backup ?? false,
    enabled: rs.enabled ?? false,
    name: rs.name ?? "",
    address: rs.address ?? "",
    alt: rs.alt ?? "",
    sameHoursEveryDay: rs.sameHoursEveryDay ?? true,
    allDays,
    perDay,
  };
}

function loadSavedForm(): CourseFormState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return INITIAL_FORM;
    const parsed = JSON.parse(raw);

    // Ensure timezone exists (old forms lack it)
    if (!parsed.timezone) parsed.timezone = browserTimezone;

    // Migrate split_decay → split_delta (field rename)
    if (parsed.split_decay !== undefined && parsed.split_delta === undefined) {
      parsed.split_delta = parsed.split_decay;
      delete parsed.split_decay;
    }
    for (const seg of parsed.segments ?? []) {
      if (seg.split_decay !== undefined && seg.split_delta === undefined) {
        seg.split_delta = seg.split_decay;
        delete seg.split_decay;
      }
    }

    // Migrate split_delta sign inversion (positive used to mean slower; now positive = faster)
    // Detect pre-inversion data by checking for the absence of a sentinel key.
    if (!parsed.__splitDeltaInverted) {
      const v = parseFloat(parsed.split_delta);
      if (!isNaN(v) && v !== 0) parsed.split_delta = String(-v);
      for (const seg of parsed.segments ?? []) {
        const sv = parseFloat(seg.split_delta);
        if (!isNaN(sv) && sv !== 0) seg.split_delta = String(-sv);
      }
      parsed.__splitDeltaInverted = true;
    }

    // Migrate empty down_time_ratio / split_delta to "0" (was previously required to be non-empty)
    if (!parsed.down_time_ratio?.trim()) parsed.down_time_ratio = "0";
    if (!parsed.split_delta?.trim()) parsed.split_delta = "0";

    // Migrate: add course-level sub_split_mode if missing (old forms had it per-split only)
    if (!parsed.sub_split_mode) parsed.sub_split_mode = "hour";
    if (!parsed.sub_split_count) parsed.sub_split_count = "1";
    if (parsed.sub_split_distance === undefined) parsed.sub_split_distance = "";
    if (parsed.last_sub_split_threshold === undefined)
      parsed.last_sub_split_threshold = "20";
    if (parsed.sub_split_distances === undefined)
      parsed.sub_split_distances = "";

    // Migrate rest stops and splits
    for (const seg of parsed.segments ?? []) {
      for (const split of seg.splits ?? []) {
        if (split.rest_stop) {
          // Migrate TZ from rest_stop to split level
          if (
            split.differentTimezone === undefined &&
            split.rest_stop.differentTimezone !== undefined
          ) {
            split.differentTimezone = split.rest_stop.differentTimezone;
            split.timezone = split.rest_stop.timezone ?? browserTimezone;
          }
          delete split.rest_stop.differentTimezone;
          delete split.rest_stop.timezone;
          split.rest_stop = migrateRestStop(split.rest_stop);
        }
        // Ensure split-level TZ fields exist
        if (split.differentTimezone === undefined)
          split.differentTimezone = false;
        if (!split.timezone) split.timezone = browserTimezone;
      }
    }

    if (parsed.rwgpsRouteId !== undefined && parsed.rwgpsRouteId !== null) {
      const routeId = Number(parsed.rwgpsRouteId);
      parsed.rwgpsRouteId =
        Number.isFinite(routeId) && routeId > 0 ? routeId : null;
    }

    return parsed as CourseFormState;
  } catch {
    /* ignore corrupt data */
  }
  return INITIAL_FORM;
}

const KM_PER_MI = 1.60934;
const RWGPS_BASE = "https://ridewithgps.com";

interface RwgpsTrackPoint {
  x: number;
  y: number;
  e: number;
  d: number;
}

async function fetchRwgpsRouteById(
  token: string,
  routeId: number,
): Promise<{
  id: number;
  name: string;
  track: GpxTrackPoint[];
}> {
  const resp = await fetch(`${RWGPS_BASE}/api/v1/routes/${routeId}.json`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    throw new Error(`RWGPS error ${resp.status}`);
  }
  const data = (await resp.json()) as {
    route: {
      id: number;
      name: string;
      track_points: RwgpsTrackPoint[];
    };
  };
  return {
    id: data.route.id,
    name: data.route.name,
    track: data.route.track_points.map((p) => ({
      lat: p.y,
      lon: p.x,
      ele: p.e,
      cumDist: p.d / 1000,
    })),
  };
}

function unitConversionFactor(from: UnitSystem, to: UnitSystem): number {
  if (from === to) return 1;
  return from === "imperial" ? KM_PER_MI : 1 / KM_PER_MI;
}

function formatConvertedNumber(value: number): string {
  const normalized = Number(value.toFixed(4));
  if (Object.is(normalized, -0)) return "0";
  return String(normalized);
}

function hasAnyPositiveSplitDistance(form: CourseFormState): boolean {
  return form.segments.some((seg) =>
    seg.splits.some((split) => {
      const d = Number(split.distance);
      return Number.isFinite(d) && d > 0;
    }),
  );
}

function hydrateDistancesFromTrackIfEmpty(
  form: CourseFormState,
  totalDistUserUnits: number,
): CourseFormState {
  if (!(Number.isFinite(totalDistUserUnits) && totalDistUserUnits > 0)) {
    return form;
  }
  if (hasAnyPositiveSplitDistance(form)) return form;

  const splitCount = form.segments.reduce(
    (sum, seg) => sum + seg.splits.length,
    0,
  );
  if (splitCount <= 0) return form;

  const perSplit = totalDistUserUnits / splitCount;
  let marker = 0;

  return {
    ...form,
    segments: form.segments.map((seg) => ({
      ...seg,
      splits: seg.splits.map((split) => {
        if (form.mode === "target_distance") {
          marker += perSplit;
          return { ...split, distance: formatConvertedNumber(marker) };
        }
        return { ...split, distance: formatConvertedNumber(perSplit) };
      }),
    })),
  };
}

function convertNumericString(raw: string, factor: number): string {
  const trimmed = raw.trim();
  if (!trimmed) return raw;
  const parsed = Number(trimmed);
  if (Number.isNaN(parsed)) return raw;
  return formatConvertedNumber(parsed * factor);
}

function convertCommaSeparatedNumbers(raw: string, factor: number): string {
  if (!raw.trim()) return raw;
  return raw
    .split(",")
    .map((token) => {
      const trimmed = token.trim();
      if (!trimmed) return token;
      const parsed = Number(trimmed);
      if (Number.isNaN(parsed)) return token;
      return formatConvertedNumber(parsed * factor);
    })
    .join(", ");
}

function convertCourseUnitValues(
  form: CourseFormState,
  toUnitSystem: UnitSystem,
): CourseFormState {
  const factor = unitConversionFactor(form.unitSystem, toUnitSystem);
  if (factor === 1) return { ...form, unitSystem: toUnitSystem };

  return {
    ...form,
    unitSystem: toUnitSystem,
    sub_split_distance: convertNumericString(
      form.sub_split_distance ?? "",
      factor,
    ),
    last_sub_split_threshold: convertNumericString(
      form.last_sub_split_threshold ?? "",
      factor,
    ),
    sub_split_distances: convertCommaSeparatedNumbers(
      form.sub_split_distances ?? "",
      factor,
    ),
    init_moving_speed: convertNumericString(form.init_moving_speed, factor),
    min_moving_speed: convertNumericString(form.min_moving_speed, factor),
    split_delta: convertNumericString(form.split_delta, factor),
    segments: form.segments.map((seg) => ({
      ...seg,
      split_delta: convertNumericString(seg.split_delta, factor),
      moving_speed: convertNumericString(seg.moving_speed, factor),
      min_moving_speed: convertNumericString(seg.min_moving_speed, factor),
      splits: seg.splits.map((split) => ({
        ...split,
        distance: convertNumericString(split.distance, factor),
        sub_split_distance: convertNumericString(
          split.sub_split_distance,
          factor,
        ),
        last_sub_split_threshold: convertNumericString(
          split.last_sub_split_threshold,
          factor,
        ),
        sub_split_distances: convertCommaSeparatedNumbers(
          split.sub_split_distances,
          factor,
        ),
        moving_speed: convertNumericString(split.moving_speed, factor),
      })),
    })),
  };
}

export default function CourseForm() {
  const [form, setForm] = useState<CourseFormState>(loadSavedForm);
  const [result, setResult] = useState<CourseDetail | null>(null);
  const [activeTab, setActiveTab] = useState<"planning" | "projections">(
    "planning",
  );
  const [apiError, setApiError] = useState<string | null>(null);
  const [, setLoading] = useState(false); // used by API engine path
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [legendOpen, setLegendOpen] = useState(false);
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [gpxSearchOpen, setGpxSearchOpen] = useState(false);
  const [racePlanOpen, setRacePlanOpen] = useState(false);
  const [confirmExampleOpen, setConfirmExampleOpen] = useState(false);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const [validationDialogOpen, setValidationDialogOpen] = useState(false);
  const validationDialogRef = useRef<HTMLDialogElement>(null);
  const [confirmReduceSegmentsOpen, setConfirmReduceSegmentsOpen] =
    useState(false);
  const [pendingSegmentCountRaw, setPendingSegmentCountRaw] = useState<
    string | null
  >(null);
  const [
    pendingDeletedSplitDistanceCount,
    setPendingDeletedSplitDistanceCount,
  ] = useState(0);
  const [pendingExampleLoad, setPendingExampleLoad] = useState<{
    form: CourseFormState;
    gpxUrl?: string;
    urlName?: string;
  } | null>(null);
  const [criteriaModalOpen, setCriteriaModalOpen] = useState(false);
  const [etaMargins, setEtaMargins] = useState({ open: "15", close: "7" });
  const [etaMarginsOpen, setEtaMarginsOpen] = useState(false);
  const [showCourseResultsGrid, setShowCourseResultsGrid] = useState(false);
  const [pendingUnitSystem, setPendingUnitSystem] = useState<UnitSystem | null>(
    null,
  );
  const etaMarginsRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = etaMarginsRef.current;
    if (!el) return;
    if (etaMarginsOpen && !el.open) el.showModal();
    else if (!etaMarginsOpen && el.open) el.close();
  }, [etaMarginsOpen]);
  const [autoNameDialog, setAutoNameDialog] = useState<{
    open: boolean;
    namedItems: string[];
    segmentPrefix: string;
    splitPrefix: string;
    includeCityRoute: boolean;
  }>({
    open: false,
    namedItems: [],
    segmentPrefix: "",
    splitPrefix: "",
    includeCityRoute: true,
  });
  const autoNameDialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = autoNameDialogRef.current;
    if (!el) return;
    if (autoNameDialog.open && !el.open) el.showModal();
    else if (!autoNameDialog.open && el.open) el.close();
  }, [autoNameDialog.open]);

  const [quickSetup, setQuickSetup] = useState<{
    open: boolean;
    segments: string;
    splits: string;
    distance: string;
    sleep: string;
  }>({ open: false, segments: "1", splits: "1", distance: "", sleep: "0" });
  const quickSetupRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = quickSetupRef.current;
    if (!el) return;
    if (quickSetup.open && !el.open) el.showModal();
    else if (!quickSetup.open && el.open) el.close();
  }, [quickSetup.open]);

  const [gpxMissingWarning, setGpxMissingWarning] = useState<string | null>(
    null,
  );

  // GPX state — session only, not persisted to localStorage
  const [gpxTrack, setGpxTrack] = useState<GpxTrackPoint[] | null>(null);
  const [gpxSurface, setGpxSurface] = useState<string | null>(null);
  const [gpxFileName, setGpxFileName] = useState<string | null>(null);
  const [gpxLoading, setGpxLoading] = useState(false);
  const [rwgpsRestorePending, setRwgpsRestorePending] = useState<number | null>(
    null,
  );
  const rwgpsRestoreInFlightRef = useRef<number | null>(null);
  const gpxFileRef = useRef<HTMLInputElement>(null);

  // City of the GPX track's very first point (start of the whole course).
  const [gpxStartCity, setGpxStartCity] = useState<string | null>(null);

  // City label state — resolved city name per [segIdx][splitIdx].
  // null = not yet fetched or fetch failed; undefined cell = no GPX.
  const [cityLabels, setCityLabels] = useState<(string | null)[][]>([]);
  // true while that cell is the actively in-flight request.
  const [cityFetching, setCityFetching] = useState<boolean[][]>([]);
  // Queue of pending geocode requests (not state — mutations don't need re-render).
  type CityQueueItem = { segIdx: number; splitIdx: number; endKm: number };
  const cityQueueRef = useRef<CityQueueItem[]>([]);
  // Monotonically increasing generation — increment to cancel in-progress loop.
  const cityGenRef = useRef(0);
  // Tracks the endKm that was last successfully fetched per [segIdx][splitIdx],
  // so we can apply the >5 mi threshold on distance edits.
  const lastFetchedKmRef = useRef<(number | null)[][]>([]);
  // Timestamp (ms) of the last real Nominatim network request, shared across
  // all concurrent processCityQueue invocations so the 1 req/s limit is
  // respected even when a new processor starts before the old one exits.
  const lastNetworkRequestMsRef = useRef<number>(0);
  // Stable ref to gpxTrack for use inside async queue processor.
  const gpxTrackRef = useRef<GpxTrackPoint[] | null>(null);
  gpxTrackRef.current = gpxTrack;

  // Map popup navigation — incrementing the counter for a given seg/split
  // triggers that SegmentForm/SplitForm to expand and scroll into view.
  // Last map-popup navigation target — rev increments on every click so the
  // useEffect in SegmentForm/SplitForm always sees a changed value even when
  // the same split or a sibling split in the same segment is clicked twice.
  const [mapNavTarget, setMapNavTarget] = useState<{
    segIdx: number;
    splitIdx: number;
    rev: number;
  } | null>(null);
  // Ref so that handleMapMarkerClick always sees the current page size without
  // needing to be recreated when the user changes it.
  const segPageSizeRef = useRef(5);
  const handleMapMarkerClick = useCallback(
    (segIdx: number, splitIdx: number) => {
      setMapNavTarget((prev) => ({
        segIdx,
        splitIdx,
        rev: (prev?.rev ?? 0) + 1,
      }));
      // Jump to the page that contains the target segment.
      setSegPage(Math.floor(segIdx / segPageSizeRef.current));
    },
    [],
  );

  // Clear mapNavTarget after children have consumed the signal so stale
  // values don't re-fire when components remount (collapse → expand).
  useEffect(() => {
    if (mapNavTarget) setMapNavTarget(null);
  }, [mapNavTarget]);

  // Zoom-to-segment/split from form buttons — drives CourseMap's zoomTarget prop.
  const [mapZoomTarget, setMapZoomTarget] = useState<{
    segIdx: number;
    splitIdx?: number;
    rev: number;
  } | null>(null);
  const courseMapContainerRef = useRef<HTMLDivElement | null>(null);
  const handleZoomToSegment = useCallback((segIdx: number) => {
    setMapCollapsed(false);
    setMapZoomTarget((prev) => ({
      segIdx,
      rev: (prev?.rev ?? 0) + 1,
    }));
    requestAnimationFrame(() => {
      courseMapContainerRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    });
  }, []);
  const handleZoomToSplit = useCallback((segIdx: number, splitIdx: number) => {
    setMapCollapsed(false);
    setMapZoomTarget((prev) => ({
      segIdx,
      splitIdx,
      rev: (prev?.rev ?? 0) + 1,
    }));
    requestAnimationFrame(() => {
      courseMapContainerRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    });
  }, []);

  // Collapse/expand all segments and splits
  const [collapseAllSignal, setCollapseAllSignal] = useState(0);
  const [expandAllSignal, setExpandAllSignal] = useState(0);

  // Segment pagination — show a page of segments at a time on large courses.
  const [segPage, setSegPage] = useState(0);
  const [segPageSize, setSegPageSize] = useState(5);
  segPageSizeRef.current = segPageSize; // keep ref in sync
  // Ensure page stays in bounds when segments are added / removed.
  const totalSegPages = Math.ceil(form.segments.length / segPageSize);
  const clampedSegPage = Math.min(segPage, Math.max(0, totalSegPages - 1));
  if (clampedSegPage !== segPage) setSegPage(clampedSegPage);
  const pagedSegmentIndexes = useMemo(
    () =>
      form.segments
        .slice(clampedSegPage * segPageSize, (clampedSegPage + 1) * segPageSize)
        .map((_, localIdx) => clampedSegPage * segPageSize + localIdx),
    [clampedSegPage, form.segments, segPageSize],
  );

  // Course settings card — inline name editing
  const [mapCollapsed, setMapCollapsed] = useState(false);
  const [isEditingCourseName, setIsEditingCourseName] = useState(false);
  const courseNameInputRef = useRef<HTMLInputElement | null>(null);

  // Validation dialog
  useEffect(() => {
    const el = validationDialogRef.current;
    if (!el) return;
    if (validationDialogOpen && !el.open) el.showModal();
    else if (!validationDialogOpen && el.open) el.close();
  }, [validationDialogOpen]);

  // Restore GPX from IndexedDB on mount (large files don't fit in localStorage).
  // Skip when ?example is present — the example loader will supply the track,
  // and letting IDB restore race against it would overwrite the correct GPX.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("example")) return;
    if (form.rwgpsRouteId) return;
    loadGpx()
      .then((record) => {
        if (!record) return;
        setGpxFileName(record.fileName);
        setGpxLoading(true);
        setTimeout(() => {
          try {
            setGpxTrack(parseGpx(record.xml));
            setGpxSurface(extractSurfaceFromXml(record.xml));
          } catch {
            // Stored file is corrupt — silently drop it.
            clearGpx().catch(() => {});
            setGpxFileName(null);
          } finally {
            setGpxLoading(false);
          }
        }, 0);
      })
      .catch(() => {
        /* IDB unavailable — no-op */
      });
    // Run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const useEngine: "client" | "api" =
    new URLSearchParams(window.location.search).get("engine") === "api"
      ? "api"
      : "client";

  const { paidApisEnabled, user } = useAppSettings();

  // Persist form to localStorage on every change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(form));
  }, [form]);

  const update = (patch: Partial<CourseFormState>) =>
    setForm((prev) => ({ ...prev, ...patch }));

  const requestUnitSystemChange = useCallback(
    (next: UnitSystem) => {
      if (next === form.unitSystem) return;
      setPendingUnitSystem(next);
    },
    [form.unitSystem],
  );

  const handleConvertUnitSystem = useCallback(() => {
    if (!pendingUnitSystem) return;
    const factor = unitConversionFactor(form.unitSystem, pendingUnitSystem);
    setForm((prev) => convertCourseUnitValues(prev, pendingUnitSystem));
    setQuickSetup((prev) => ({
      ...prev,
      distance: convertNumericString(prev.distance, factor),
    }));
    setPendingUnitSystem(null);
  }, [form.unitSystem, pendingUnitSystem]);

  const handleKeepUnitSystemValues = useCallback(() => {
    if (!pendingUnitSystem) return;
    setForm((prev) => ({ ...prev, unitSystem: pendingUnitSystem }));
    setPendingUnitSystem(null);
  }, [pendingUnitSystem]);

  const handleReset = useCallback(() => {
    setForm(INITIAL_FORM);
    setResult(null);
    setApiError(null);
    setTouched(new Set());
  }, []);

  const handleConfirmReset = useCallback(() => {
    handleReset();
    setConfirmResetOpen(false);
  }, [handleReset]);

  const handleCancelReset = useCallback(() => {
    setConfirmResetOpen(false);
  }, []);

  const applyAutoName = useCallback(
    (
      overwriteAll: boolean,
      segmentPrefix: string,
      splitPrefix: string,
      includeCityRoute: boolean,
    ) => {
      const cityPart = (label: string, idx: number) =>
        (label.split(",")[idx] ?? "").trim();

      function applyTemplate(
        template: string,
        segIdx: number,
        splitIdx: number | undefined,
        toks: {
          fromCity: string;
          toCity: string;
          fromState: string;
          toState: string;
        },
      ): string {
        return template
          .replace(/\{segment_num\}/g, String(segIdx + 1))
          .replace(
            /\{split_num\}/g,
            splitIdx !== undefined ? String(splitIdx + 1) : "",
          )
          .replace(/\{from_city\}/g, toks.fromCity)
          .replace(/\{to_city\}/g, toks.toCity)
          .replace(/\{from_state\}/g, toks.fromState)
          .replace(/\{to_state\}/g, toks.toState);
      }

      setForm((prev) => {
        const newSegs = prev.segments.map((seg, si) => {
          const newSplits = seg.splits.map((split, sj) => {
            if (!overwriteAll && split.name?.trim()) return split;
            const endCity = cityLabels[si]?.[sj];
            if (!endCity) return split;
            const startCity =
              si === 0 && sj === 0
                ? gpxStartCity
                : sj > 0
                  ? cityLabels[si]?.[sj - 1]
                  : cityLabels[si - 1]?.[
                      prev.segments[si - 1].splits.length - 1
                    ];
            if (!startCity) return split;
            const toks = {
              fromCity: cityPart(startCity, 0),
              toCity: cityPart(endCity, 0),
              fromState: cityPart(startCity, 1),
              toState: cityPart(endCity, 1),
            };
            const cityRoute = includeCityRoute
              ? `${toks.fromCity} → ${toks.toCity}`
              : null;
            const prefix = applyTemplate(splitPrefix, si, sj, toks).trimEnd();
            const name = [prefix, cityRoute].filter(Boolean).join(" ");
            return { ...split, name };
          });

          const segStartCity =
            si === 0
              ? gpxStartCity
              : cityLabels[si - 1]?.[prev.segments[si - 1].splits.length - 1];
          const segEndCity = cityLabels[si]?.[seg.splits.length - 1];
          const canNameSeg = segStartCity && segEndCity;
          let segName: Record<string, string> = {};
          if (canNameSeg && (overwriteAll || !seg.name?.trim())) {
            const segToks = {
              fromCity: cityPart(segStartCity!, 0),
              toCity: cityPart(segEndCity!, 0),
              fromState: cityPart(segStartCity!, 1),
              toState: cityPart(segEndCity!, 1),
            };
            const cityRoute = includeCityRoute
              ? `${segToks.fromCity} → ${segToks.toCity}`
              : null;
            const prefix = applyTemplate(
              segmentPrefix,
              si,
              undefined,
              segToks,
            ).trimEnd();
            segName = { name: [prefix, cityRoute].filter(Boolean).join(" ") };
          }
          return { ...seg, splits: newSplits, ...segName };
        });
        return { ...prev, segments: newSegs };
      });
    },
    [cityLabels, gpxStartCity],
  );

  const handleAutoName = useCallback(() => {
    // Collect already-named segments and splits.
    const namedItems: string[] = [];
    form.segments.forEach((seg, si) => {
      if (seg.name?.trim())
        namedItems.push(`Segment ${si + 1}: "${seg.name.trim()}"`);
      seg.splits.forEach((split, sj) => {
        if (split.name?.trim())
          namedItems.push(
            `Segment ${si + 1} / Split ${sj + 1}: "${split.name.trim()}"`,
          );
      });
    });
    // Always open the dialog so user can configure prefixes
    setAutoNameDialog((d) => ({ ...d, open: true, namedItems }));
  }, [form.segments]);

  const handleLoadExample = useCallback(
    (example: CourseFormState, gpxUrl?: string) => {
      setForm(example);
      setResult(null);
      setApiError(null);
      setTouched(new Set());

      if (!gpxUrl) {
        setRwgpsRestorePending(example.rwgpsRouteId ?? null);
        setGpxTrack(null);
        setGpxFileName(null);
        setGpxSurface(null);
        setGpxMissingWarning(null);
        clearGpx().catch(() => {});
        if (gpxFileRef.current) gpxFileRef.current.value = "";
        return;
      }

      // Derive the display filename from the URL (strip path and extension)
      const displayName =
        gpxUrl
          .split("/")
          .pop()
          ?.replace(/\.gpx$/i, "") ?? "example";
      setGpxFileName(displayName);
      setGpxLoading(true);
      setRwgpsRestorePending(null);
      setGpxTrack(null);
      setGpxSurface(null);
      setGpxMissingWarning(null);

      fetch(gpxUrl)
        .then((res) => {
          if (!res.ok) throw new Error(`Failed to fetch GPX (${res.status})`);
          return res.text();
        })
        .then((xml) => {
          setTimeout(() => {
            try {
              setGpxTrack(parseGpx(xml));
              setGpxSurface(extractSurfaceFromXml(xml));
              setForm((prev) => ({ ...prev, rwgpsRouteId: null }));
              saveGpx(displayName, xml).catch(() => {});
            } catch (err: unknown) {
              const msg =
                err instanceof Error ? err.message : "Invalid GPX file";
              setApiError(msg);
              setGpxFileName(null);
            } finally {
              setGpxLoading(false);
            }
          }, 0);
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : "Failed to load GPX";
          setApiError(msg);
          setGpxFileName(null);
          setGpxLoading(false);
        });
    },
    [],
  );

  // Auto-load an example on first mount when ?example_name=<url_name> is present.
  // Runs once; the ESLint disable is intentional — handleLoadExample is stable.
  useEffect(() => {
    const name = new URLSearchParams(window.location.search).get("example");
    if (!name) return;
    const entry = EXAMPLES.find((e) => e.url_name === name);
    if (!entry) {
      // Unknown example — just clean the param.
      const url = new URL(window.location.href);
      url.searchParams.delete("example");
      window.history.replaceState({}, "", url.toString());
      return;
    }
    // Check if the current form (from localStorage) has meaningful user data.
    const dirty =
      form.segments.length > 1 ||
      (form.name?.trim() || "Course") !== "Course" ||
      form.segments.some(
        (seg) =>
          seg.splits.some((split) => split.distance.trim() !== "") ||
          (seg.name?.trim() ?? "") !== "",
      );
    if (dirty) {
      setPendingExampleLoad({ form: entry.form, gpxUrl: entry.gpxUrl });
      setConfirmExampleOpen(true);
    } else {
      handleLoadExample(entry.form, entry.gpxUrl);
      // Keep the ?example= param so the URL remains shareable.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Derived dirty flag — true when the form has meaningful user data that
  // would be lost if an example is loaded without warning.
  const isFormDirty = useMemo(
    () =>
      gpxTrack !== null ||
      form.segments.length > 1 ||
      (form.name?.trim() || "Course") !== "Course" ||
      form.segments.some(
        (seg) =>
          seg.splits.some((split) => split.distance.trim() !== "") ||
          (seg.name?.trim() ?? "") !== "",
      ),
    [form, gpxTrack],
  );

  // Guard that intercepts example loads when the form has data.
  const handleLoadExampleGuarded = useCallback(
    (example: CourseFormState, gpxUrl?: string, urlName?: string) => {
      if (isFormDirty) {
        setPendingExampleLoad({ form: example, gpxUrl, urlName });
        setConfirmExampleOpen(true);
      } else {
        handleLoadExample(example, gpxUrl);
        if (urlName) {
          const url = new URL(window.location.href);
          url.searchParams.set("example", urlName);
          window.history.replaceState({}, "", url.toString());
        }
      }
    },
    [isFormDirty, handleLoadExample],
  );

  const handleConfirmLoadExample = useCallback(() => {
    if (pendingExampleLoad) {
      handleLoadExample(pendingExampleLoad.form, pendingExampleLoad.gpxUrl);
      if (pendingExampleLoad.urlName) {
        const url = new URL(window.location.href);
        url.searchParams.set("example", pendingExampleLoad.urlName);
        window.history.replaceState({}, "", url.toString());
      }
      // Keep the ?example= param so the URL remains shareable.
    }
    setConfirmExampleOpen(false);
    setPendingExampleLoad(null);
    setExamplesOpen(false);
  }, [pendingExampleLoad, handleLoadExample]);

  const handleCancelLoadExample = useCallback(() => {
    setConfirmExampleOpen(false);
    setPendingExampleLoad(null);
  }, []);

  const handleExport = useCallback(async () => {
    // Embed the current GPX filename so an import on the same browser can
    // attempt to restore the file from IndexedDB.
    const exportData = gpxFileName
      ? { ...form, gpxFileName }
      : { ...form, gpxFileName: undefined };
    const json = JSON.stringify(exportData, null, 2);
    const blob = new Blob([json], { type: "application/json" });

    if ("showOpenFilePicker" in self) {
      try {
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: `pacing-${new Date().toISOString().slice(0, 10)}.json`,
          startIn: "downloads",
          types: [
            {
              description: "JSON File",
              accept: { "application/json": [".json"] },
            },
          ],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return;
      } catch (err) {
        // User cancelled the save dialog — do nothing.
        if (err instanceof DOMException && err.name === "AbortError") return;
        // Unexpected API error — fall through to legacy download.
      }
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pacing-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [form, gpxFileName]);

  const handleImport = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result as string) as CourseFormState;
          handleLoadExample(parsed);
          setGpxMissingWarning(null);

          if (parsed.rwgpsRouteId) {
            setRwgpsRestorePending(parsed.rwgpsRouteId);
            return;
          }

          const embeddedName = parsed.gpxFileName;
          if (!embeddedName) return;

          // Try to restore the GPX from IndexedDB by filename.
          loadGpx(embeddedName)
            .then((record) => {
              if (record) {
                // Found the named file — restore it.
                setGpxFileName(record.fileName);
                setGpxLoading(true);
                setTimeout(() => {
                  try {
                    setGpxTrack(parseGpx(record.xml));
                    setGpxSurface(extractSurfaceFromXml(record.xml));
                    // Update the "current" key so the GPX survives a page refresh.
                    saveGpx(record.fileName, record.xml).catch(() => {});
                  } catch {
                    setGpxFileName(null);
                    setGpxMissingWarning(
                      `This export included a GPX file “${embeddedName}” but it could not be loaded. Re-upload the file.`,
                    );
                  } finally {
                    setGpxLoading(false);
                  }
                }, 0);
              } else {
                // No record stored under that filename in this browser., or it’s a different file.
                setGpxMissingWarning(
                  `This export included a GPX file “${embeddedName}” but it is no longer stored in this browser. Re-upload the file.`,
                );
              }
            })
            .catch(() => {
              setGpxMissingWarning(
                `This export included a GPX file “${embeddedName}” but it could not be loaded. Re-upload the file.`,
              );
            });
        } catch {
          setApiError("Invalid JSON file.");
        }
      };
      reader.readAsText(file);
      e.target.value = "";
    },
    [handleLoadExample],
  );

  const handleGpxLoad = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      // Show loading state immediately with the filename
      const displayName = file.name.replace(/\.gpx$/i, "");
      setGpxFileName(displayName);
      setGpxLoading(true);
      setGpxTrack(null);
      setGpxSurface(null);
      const reader = new FileReader();
      reader.onload = () => {
        const xml = reader.result as string;
        // Yield to the browser so the loading banner renders before
        // the synchronous (potentially heavy) parse blocks the main thread.
        setTimeout(() => {
          try {
            const track = parseGpx(xml);
            setGpxTrack(track);
            setGpxSurface(extractSurfaceFromXml(xml));
            setGpxMissingWarning(null);
            setRwgpsRestorePending(null);
            setForm((prev) => ({ ...prev, rwgpsRouteId: null }));
            // Auto-detect timezone from the track's first point.
            const detectedTz = tzlookup(track[0].lat, track[0].lon);
            if (detectedTz) update({ timezone: detectedTz });
            // Persist to IDB so the GPX survives a page reload.
            saveGpx(displayName, xml).catch(() => {
              /* IDB unavailable */
            });
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : "Invalid GPX file";
            setApiError(msg);
            setGpxFileName(null);
          } finally {
            setGpxLoading(false);
          }
        }, 0);
      };
      reader.readAsText(file);
      e.target.value = "";
    },
    [],
  );

  const handleGpxClear = useCallback(() => {
    setGpxTrack(null);
    setGpxSurface(null);
    setGpxFileName(null);
    setGpxLoading(false);
    setRwgpsRestorePending(null);
    setGpxMissingWarning(null);
    setForm((prev) => ({ ...prev, rwgpsRouteId: null }));
    if (gpxFileRef.current) gpxFileRef.current.value = "";
    clearGpx().catch(() => {
      /* IDB unavailable */
    });
  }, []);

  /** Load GPX track points directly (from RideWithGPS API) without a file. */
  const handleGpxLoadDirect = useCallback(
    (
      track: import("../types").GpxTrackPoint[],
      routeName: string,
      routeId: number,
    ) => {
      if (track.length === 0) {
        setGpxLoading(false);
        setApiError(
          `RideWithGPS route ${routeId} did not include track points, so it cannot be mapped.`,
        );
        setGpxMissingWarning(
          `RideWithGPS route ${routeId} has no track points available. Try another route or export/import as GPX.`,
        );
        return;
      }
      setGpxFileName(routeName);
      setGpxTrack(track);
      setGpxSurface("unknown");
      setGpxLoading(false);
      setApiError(null);
      setGpxMissingWarning(null);
      setRwgpsRestorePending(null);
      setForm((prev) => {
        const totalKm = track[track.length - 1]?.cumDist ?? 0;
        const totalUserDist =
          prev.unitSystem === "imperial" ? totalKm / 1.60934 : totalKm;
        const withRouteId = { ...prev, rwgpsRouteId: routeId };
        return hydrateDistancesFromTrackIfEmpty(withRouteId, totalUserDist);
      });
      clearGpx().catch(() => {
        /* IDB unavailable */
      });
      if (track.length > 0) {
        const detectedTz = tzlookup(track[0].lat, track[0].lon);
        if (detectedTz) update({ timezone: detectedTz });
      }
    },
    [],
  );

  useEffect(() => {
    const routeId = form.rwgpsRouteId;
    if (!routeId || gpxTrack) return;
    if (rwgpsRestoreInFlightRef.current === routeId) return;

    const token = getRwgpsToken();
    if (!token) {
      setGpxLoading(false);
      setRwgpsRestorePending(routeId);
      setGpxMissingWarning(
        `This course references RideWithGPS route ${routeId}. Connect RideWithGPS and select the route to load it.`,
      );
      setGpxSearchOpen(true);
      return;
    }

    let cancelled = false;
    rwgpsRestoreInFlightRef.current = routeId;
    setGpxLoading(true);
    fetchRwgpsRouteById(token, routeId)
      .then((detail) => {
        if (cancelled) return;
        handleGpxLoadDirect(detail.track, detail.name, detail.id);
      })
      .catch(() => {
        if (cancelled) return;
        setRwgpsRestorePending(routeId);
        setGpxMissingWarning(
          `Could not auto-load RideWithGPS route ${routeId}. Reconnect RideWithGPS and select the route to continue.`,
        );
        setGpxSearchOpen(true);
      })
      .finally(() => {
        rwgpsRestoreInFlightRef.current = null;
        if (!cancelled) {
          setGpxLoading(false);
        }
      });

    return () => {
      cancelled = true;
      rwgpsRestoreInFlightRef.current = null;
    };
  }, [form.rwgpsRouteId, gpxTrack, handleGpxLoadDirect]);

  const sLabel = speedLabel(form.unitSystem);
  const dLabel = distanceLabel(form.unitSystem);
  const fmtInTz = formatIsoInTzShort;
  const courseEndTz = useMemo(() => {
    if (!result || result.segment_details.length === 0) return null;
    const lastSeg = result.segment_details[result.segment_details.length - 1];
    if (!lastSeg || lastSeg.split_details.length === 0) return null;
    return lastSeg.split_details[lastSeg.split_details.length - 1].end_timezone;
  }, [result]);

  // Stable string key from split distances only — doesn't change when unrelated
  // fields (rest stop, speed, etc.) are edited, so profiles aren't recomputed
  // on every keystroke in those fields.
  const splitDistancesKey = useMemo(
    () =>
      form.segments
        .map((seg) => seg.splits.map((sp) => sp.distance).join(","))
        .join("|"),
    [form.segments],
  );

  const [gpxProfiles, setGpxProfiles] = useState<SplitGpxProfile[][] | null>(
    null,
  );

  // ── Weather forecast state (lives here so it survives tab changes) ──
  const [hourlyWeather, setHourlyWeather] = useState<
    HourlyWeatherPoint[] | null
  >(null);
  const [weatherLoading, setWeatherLoading] = useState(false);

  // Clear stale weather whenever the result or GPX profiles change.
  useEffect(() => {
    setHourlyWeather(null);
  }, [result, gpxProfiles]);

  // Derive the per-split SplitWeatherPair[][] from hourly data (no re-fetch).
  const splitWeather = useMemo<(SplitWeatherPair | null)[][] | null>(() => {
    if (!hourlyWeather || !result) return null;
    const splitCounts = result.segment_details.map(
      (seg) => seg.split_details.length,
    );
    return deriveWeatherPairsFromHourly(
      hourlyWeather,
      result.segment_details.length,
      splitCounts,
    );
  }, [hourlyWeather, result]);

  // Whole-course wind direction + impact stats derived from all hourly samples.
  const courseWindStats = useMemo(() => {
    if (!hourlyWeather || hourlyWeather.length === 0) return null;
    const dirCounts = { N: 0, E: 0, S: 0, W: 0 };
    let headCount = 0,
      tailCount = 0,
      crossCount = 0,
      windBearingCount = 0;
    for (const pt of hourlyWeather) {
      const w = pt.weather;
      const dir = w.windDirection;
      if (dir >= 315 || dir < 45) dirCounts.N++;
      else if (dir < 135) dirCounts.E++;
      else if (dir < 225) dirCounts.S++;
      else dirCounts.W++;
      const profile = gpxProfiles?.[pt.segIdx]?.[pt.splitIdx];
      if (
        profile &&
        !(
          profile.startLat === profile.endLat &&
          profile.startLon === profile.endLon
        )
      ) {
        const φ1 = (profile.startLat * Math.PI) / 180;
        const φ2 = (profile.endLat * Math.PI) / 180;
        const Δλ = ((profile.endLon - profile.startLon) * Math.PI) / 180;
        const y = Math.sin(Δλ) * Math.cos(φ2);
        const x =
          Math.cos(φ1) * Math.sin(φ2) -
          Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
        const bearing = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
        const diff = (w.windDirection - bearing + 360) % 360;
        const angle = diff > 180 ? 360 - diff : diff;
        if (angle <= 45) headCount++;
        else if (angle >= 135) tailCount++;
        else crossCount++;
        windBearingCount++;
      }
    }
    const windTotal = dirCounts.N + dirCounts.E + dirCounts.S + dirCounts.W;
    return {
      windDir:
        windTotal > 0
          ? {
              N: Math.round((dirCounts.N / windTotal) * 100),
              E: Math.round((dirCounts.E / windTotal) * 100),
              S: Math.round((dirCounts.S / windTotal) * 100),
              W: Math.round((dirCounts.W / windTotal) * 100),
            }
          : null,
      windImpact:
        windBearingCount > 0
          ? {
              head: Math.round((headCount / windBearingCount) * 100),
              tail: Math.round((tailCount / windBearingCount) * 100),
              cross: Math.round((crossCount / windBearingCount) * 100),
            }
          : null,
    };
  }, [hourlyWeather, gpxProfiles]);

  const weatherAvailable = useMemo(() => {
    if (!gpxProfiles || !result) return false;
    const maxForecast = new Date();
    maxForecast.setDate(maxForecast.getDate() + 16);
    // Show for past courses (historical API) and near-future courses (forecast API).
    // Only hide when the entire course starts beyond the 16-day forecast window.
    return new Date(result.start_time) <= maxForecast;
  }, [gpxProfiles, result]);

  const handleFetchWeather = useCallback(() => {
    if (!gpxProfiles || !result || !gpxTrack) return;

    const coords = computeHourlyCoursePoints(
      result,
      gpxProfiles,
      gpxTrack,
      interpolateLatLon,
    );
    if (coords.length === 0) return;

    setWeatherLoading(true);
    fetchHourlyCourseWeather(coords, paidApisEnabled)
      .then((points) => {
        setHourlyWeather(points);
        setWeatherLoading(false);
      })
      .catch(() => {
        setWeatherLoading(false);
      });
  }, [result, gpxProfiles, gpxTrack]);

  // Memoized — avoids re-running the 30k-point RDP on every render.
  const bannerGainM = useMemo(
    () => (gpxTrack ? computeElevGainLoss(gpxTrack).gainM : 0),
    [gpxTrack],
  );

  // Per-split cumulative distances in user units (null when no GPX).
  // Used by SplitForm to show "X of Y mi (Z mi left/over)" label.
  const splitCumulativeDists = useMemo<(number | null)[][] | null>(() => {
    if (!gpxTrack) return null;
    let offset = 0;
    return form.segments.map((seg) => {
      const segCums: number[] = [];
      if (form.mode === "target_distance") {
        for (const split of seg.splits) {
          const d = parseFloat(split.distance);
          segCums.push(isNaN(d) ? 0 : d);
        }
        const lastD = parseFloat(
          seg.splits[seg.splits.length - 1]?.distance ?? "0",
        );
        offset = isNaN(lastD) ? offset : lastD;
      } else {
        for (const split of seg.splits) {
          const d = parseFloat(split.distance);
          offset += isNaN(d) ? 0 : d;
          segCums.push(offset);
        }
      }
      return segCums;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gpxTrack, form.unitSystem, form.mode, splitDistancesKey]);

  const gpxTotalDistUser = useMemo<number | null>(() => {
    if (!gpxTrack) return null;
    const km = gpxTrack[gpxTrack.length - 1].cumDist;
    return form.unitSystem === "imperial"
      ? Math.round((km / 1.60934) * 10) / 10
      : Math.round(km * 10) / 10;
  }, [gpxTrack, form.unitSystem]);

  // TZ auto-detected from the GPX track's first point.
  const detectedCourseTz = useMemo(
    () => (gpxTrack ? tzlookup(gpxTrack[0].lat, gpxTrack[0].lon) : null),
    [gpxTrack],
  );

  // Per-split distance status relative to the GPX total.
  // "over"       → this split's cumulative distance exceeds the GPX total (red)
  // "under-last" → last split/segment and total hasn't reached GPX total (yellow)
  // null         → no GPX loaded or within range
  const splitGpxStatuses = useMemo<Array<Array<"over" | "under-last" | null>>>(
    () => {
      const makeNull = () =>
        form.segments.map((s) =>
          s.splits.map((): "over" | "under-last" | null => null),
        );
      if (!gpxTrack) return makeNull();

      const gpxTotalKm = gpxTrack[gpxTrack.length - 1].cumDist;
      const gpxTotal =
        form.unitSystem === "imperial"
          ? Math.round((gpxTotalKm / 1.60934) * 10) / 10
          : Math.round(gpxTotalKm * 10) / 10;

      // Build cumulative distance from course start (in user units) for each split.
      let offset = 0;
      const cumDists: number[][] = [];
      for (const seg of form.segments) {
        const segCums: number[] = [];
        if (form.mode === "target_distance") {
          // In target_distance mode the distance field is already an absolute
          // cumulative course marker (same as tdOffset logic in splitDistances).
          // Do NOT add segOffset — the value IS the cumulative distance.
          for (const split of seg.splits) {
            const d = parseFloat(split.distance);
            segCums.push(isNaN(d) ? 0 : d);
          }
          const lastD = parseFloat(
            seg.splits[seg.splits.length - 1]?.distance ?? "0",
          );
          // Track where this segment ends (mirrors tdOffset = raw[last])
          offset = isNaN(lastD) ? offset : lastD;
        } else {
          for (const split of seg.splits) {
            const d = parseFloat(split.distance);
            offset += isNaN(d) ? 0 : d;
            segCums.push(offset);
          }
        }
        cumDists.push(segCums);
      }

      const lastSegIdx = form.segments.length - 1;
      const lastSplitIdx = (form.segments[lastSegIdx]?.splits.length ?? 1) - 1;
      const totalConfigured = cumDists[lastSegIdx]?.[lastSplitIdx] ?? 0;

      return form.segments.map((seg, i) =>
        seg.splits.map((_, j): "over" | "under-last" | null => {
          const cum = cumDists[i]?.[j] ?? 0;
          if (cum > gpxTotal + 0.05) return "over";
          if (
            i === lastSegIdx &&
            j === lastSplitIdx &&
            totalConfigured < gpxTotal - 0.05
          )
            return "under-last";
          return null;
        }),
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gpxTrack, form.unitSystem, form.mode, splitDistancesKey, form.segments],
  );

  // Debounced profile computation — expensive (GPX slicing + tzlookup per split).
  // Runs 400 ms after the user stops editing distances.
  // When unitSystem or mode changes the old profiles are for a different GPX slice, so
  // clear them immediately (before the debounce fires) to avoid briefly showing stale values.
  const prevUnitSystemRef = useRef(form.unitSystem);
  const prevModeRef = useRef(form.mode);
  useEffect(() => {
    if (
      form.unitSystem !== prevUnitSystemRef.current ||
      form.mode !== prevModeRef.current
    ) {
      prevUnitSystemRef.current = form.unitSystem;
      prevModeRef.current = form.mode;
      setGpxProfiles(null);
    }
  }, [form.unitSystem, form.mode]);

  useEffect(() => {
    if (!gpxTrack || !gpxSurface) {
      setGpxProfiles(null);
      return;
    }
    const timer = setTimeout(() => {
      try {
        // In target_distance mode the split distances are cumulative course
        // markers; convert them to per-split chunk distances before slicing
        // the GPX track (mirrors normalizeSplitDistances in courseProcessor).
        let tdOffset = 0;
        const splitDistances = form.segments.map((seg) => {
          const raw = seg.splits.map((sp) => parseFloat(sp.distance) || 0);
          if (form.mode !== "target_distance") return raw;
          const markers = [tdOffset, ...raw];
          const chunks = raw.map((_, i) =>
            Math.max(0, markers[i + 1] - markers[i]),
          );
          tdOffset = raw[raw.length - 1] || tdOffset;
          return chunks;
        });
        setGpxProfiles(
          computeAllProfiles(
            gpxTrack,
            gpxSurface,
            splitDistances,
            form.unitSystem,
          ),
        );
      } catch {
        setGpxProfiles(null);
      }
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gpxTrack, gpxSurface, splitDistancesKey, form.unitSystem, form.mode]);

  // Per-split [startKm, endKm] boundaries in the GPX track.
  // Used by the GPX export modal to slice the raw track for each split.
  const splitBoundariesKm = useMemo<[number, number][][] | null>(() => {
    if (!gpxTrack) return null;
    const toKm = form.unitSystem === "imperial" ? 1.60934 : 1;
    let tdOffset = 0;
    let cumulativeKm = 0;
    return form.segments.map((seg) => {
      const raw = seg.splits.map((sp) => parseFloat(sp.distance) || 0);
      let chunks: number[];
      if (form.mode !== "target_distance") {
        chunks = raw;
      } else {
        const markers = [tdOffset, ...raw];
        chunks = raw.map((_, i) => Math.max(0, markers[i + 1] - markers[i]));
        tdOffset = raw[raw.length - 1] || tdOffset;
      }
      return chunks.map((d) => {
        const startKm = cumulativeKm;
        const endKm = cumulativeKm + d * toKm;
        cumulativeKm = endKm;
        return [startKm, endKm] as [number, number];
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gpxTrack, form.unitSystem, form.mode, splitDistancesKey]);

  // City label queue
  // Runs 600 ms after splitBoundariesKm changes. Each uncached Nominatim
  // request is staggered 1100 ms apart to respect the 1 req/s policy.
  // A distance change > 8.047 km (~5 mi) invalidates that cell cached label.
  useEffect(() => {
    if (!splitBoundariesKm || !gpxTrack) {
      // GPX cleared -- wipe all city state and cancel any in-flight work.
      cityGenRef.current++;
      cityQueueRef.current = [];
      setCityLabels([]);
      setCityFetching([]);
      setGpxStartCity(null);
      lastFetchedKmRef.current = [];
      return;
    }

    // Fetch the start-of-course city once from the first track point.
    const startPoint = gpxTrack[0];
    const cachedStart = getCachedGeocode(startPoint.lat, startPoint.lon);
    if (cachedStart !== undefined) {
      setGpxStartCity(cachedStart);
    } else {
      reverseGeocode(startPoint.lat, startPoint.lon).then((label) => {
        setGpxStartCity(label);
      });
    }

    const timer = setTimeout(() => {
      const gen = ++cityGenRef.current;
      const track = gpxTrackRef.current;
      if (!track) return;

      const toFetch: CityQueueItem[] = [];
      splitBoundariesKm.forEach((segBounds, si) => {
        segBounds.forEach(([, endKm], sj) => {
          const prevKm = lastFetchedKmRef.current[si]?.[sj] ?? null;
          const needsFetch =
            prevKm === null || Math.abs(endKm - prevKm) > 8.047;
          if (needsFetch) {
            setCityLabels((prev) => {
              const next = prev.map((r) => [...r]);
              if (!next[si]) next[si] = [];
              next[si][sj] = null;
              return next;
            });
            cityQueueRef.current = cityQueueRef.current.filter(
              (q) => !(q.segIdx === si && q.splitIdx === sj),
            );
            toFetch.push({ segIdx: si, splitIdx: sj, endKm });
          }
        });
      });

      if (toFetch.length === 0) return;

      setCityFetching((prev) => {
        const next = prev.map((r) => [...r]);
        for (const { segIdx: si, splitIdx: sj } of toFetch) {
          if (!next[si]) next[si] = [];
          next[si][sj] = true;
        }
        return next;
      });

      cityQueueRef.current = [...cityQueueRef.current, ...toFetch];

      async function processCityQueue() {
        while (cityQueueRef.current.length > 0 && cityGenRef.current === gen) {
          const item = cityQueueRef.current.shift();
          if (!item) break;
          const { segIdx: si, splitIdx: sj, endKm } = item;
          const t = gpxTrackRef.current;
          if (!t) break;

          const coord = interpolateLatLon(t, endKm);
          const cached = coord
            ? getCachedGeocode(coord.lat, coord.lon)
            : undefined;
          const isNetwork = coord !== null && cached === undefined;

          // Rate-limit real network requests to ≤1 req/s (Nominatim policy).
          // lastNetworkRequestMsRef is shared across all concurrent processor
          // invocations: the check and update are in the same synchronous block
          // (no await between them), so JS's single-threaded model guarantees
          // no two processors can both pass the guard simultaneously.
          if (isNetwork) {
            const elapsed = Date.now() - lastNetworkRequestMsRef.current;
            if (elapsed < 1100) {
              await new Promise<void>((resolve) =>
                setTimeout(resolve, 1100 - elapsed),
              );
              if (cityGenRef.current !== gen) break;
            }
            lastNetworkRequestMsRef.current = Date.now();
          }

          let label: string | null = null;
          if (coord) {
            label =
              cached !== undefined
                ? cached
                : await reverseGeocode(coord.lat, coord.lon);
          }

          if (cityGenRef.current !== gen) break;

          if (!lastFetchedKmRef.current[si]) lastFetchedKmRef.current[si] = [];
          lastFetchedKmRef.current[si][sj] = endKm;

          setCityLabels((prev) => {
            const next = prev.map((r) => [...r]);
            if (!next[si]) next[si] = [];
            next[si][sj] = label;
            return next;
          });
          setCityFetching((prev) => {
            const next = prev.map((r) => [...r]);
            if (!next[si]) next[si] = [];
            next[si][sj] = false;
            return next;
          });
        }
      }

      processCityQueue();
    }, 600);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gpxTrack, splitBoundariesKm]);

  // â”€â”€ Handlers â”€â”€
  const splitHasDistanceValue = (distanceRaw: string): boolean => {
    const trimmed = distanceRaw.trim();
    if (!trimmed) return false;
    return !Number.isNaN(Number(trimmed));
  };

  const applySegmentCountChange = (raw: string) => {
    update({ segmentCount: raw });
    const n = parseInt(raw, 10);
    if (!isNaN(n) && n > 0) {
      const curr = form.segments;
      if (n > curr.length) {
        const extra: SegmentFormState[] = Array.from(
          { length: n - curr.length },
          makeDefaultSegment,
        );
        setForm((prev) => ({
          ...prev,
          segmentCount: raw,
          segments: [...prev.segments, ...extra],
        }));
      } else if (n < curr.length) {
        setForm((prev) => ({
          ...prev,
          segmentCount: raw,
          segments: prev.segments.slice(0, n),
        }));
      }
    }
  };

  const handleSegmentCountChange = (raw: string) => {
    const n = parseInt(raw, 10);
    if (!isNaN(n) && n > 0 && n < form.segments.length) {
      const removedSegments = form.segments.slice(n);
      const removedWithDistance = removedSegments
        .flatMap((seg) => seg.splits)
        .filter((split) => splitHasDistanceValue(split.distance)).length;
      if (removedWithDistance > 0) {
        setPendingSegmentCountRaw(raw);
        setPendingDeletedSplitDistanceCount(removedWithDistance);
        setConfirmReduceSegmentsOpen(true);
        return;
      }
    }
    applySegmentCountChange(raw);
  };

  const updateSegment = (i: number, seg: SegmentFormState) => {
    setForm((prev) => {
      const next = [...prev.segments];
      next[i] = seg;
      return { ...prev, segments: next };
    });
  };

  const moveSplitToPrevSeg = (segIdx: number, splitIdx: number) => {
    setForm((prev) => {
      if (segIdx === 0) return prev;
      const segs = prev.segments.map((s) => ({ ...s, splits: [...s.splits] }));
      const [split] = segs[segIdx].splits.splice(splitIdx, 1);
      segs[segIdx - 1].splits.push(split);
      segs[segIdx - 1].splitCount = String(segs[segIdx - 1].splits.length);
      // Remove source segment if now empty
      const filtered =
        segs[segIdx].splits.length === 0
          ? segs.filter((_, i) => i !== segIdx)
          : segs.map((s) => ({ ...s, splitCount: String(s.splits.length) }));
      return {
        ...prev,
        segments: filtered,
        segmentCount: String(filtered.length),
      };
    });
  };

  const moveSplitToNextSeg = (segIdx: number, splitIdx: number) => {
    setForm((prev) => {
      if (segIdx >= prev.segments.length - 1) return prev;
      const segs = prev.segments.map((s) => ({ ...s, splits: [...s.splits] }));
      const [split] = segs[segIdx].splits.splice(splitIdx, 1);
      segs[segIdx + 1].splits.unshift(split);
      segs[segIdx + 1].splitCount = String(segs[segIdx + 1].splits.length);
      // Remove source segment if now empty
      const filtered =
        segs[segIdx].splits.length === 0
          ? segs.filter((_, i) => i !== segIdx)
          : segs.map((s) => ({ ...s, splitCount: String(s.splits.length) }));
      return {
        ...prev,
        segments: filtered,
        segmentCount: String(filtered.length),
      };
    });
  };

  const deleteSplit = (segIdx: number, splitIdx: number) => {
    setForm((prev) => {
      const segs = prev.segments.map((s) => ({ ...s, splits: [...s.splits] }));
      segs[segIdx].splits.splice(splitIdx, 1);
      // Remove segment if now empty
      const filtered =
        segs[segIdx].splits.length === 0
          ? segs.filter((_, i) => i !== segIdx)
          : segs.map((s) => ({ ...s, splitCount: String(s.splits.length) }));
      return {
        ...prev,
        segments: filtered,
        segmentCount: String(filtered.length),
      };
    });
  };

  const deleteSegment = (segIdx: number) => {
    setForm((prev) => {
      if (prev.segments.length <= 1) return prev;
      const filtered = prev.segments.filter((_, i) => i !== segIdx);
      return {
        ...prev,
        segments: filtered,
        segmentCount: String(filtered.length),
      };
    });
  };

  const insertSegment = (afterIndex: number) => {
    setForm((prev) => {
      const next = [...prev.segments];
      next.splice(afterIndex + 1, 0, makeDefaultSegment());
      return { ...prev, segments: next, segmentCount: String(next.length) };
    });
  };

  const insertSplitAfter = (segIdx: number, splitIdx: number) => {
    setForm((prev) => {
      const segs = prev.segments.map((s) => ({ ...s, splits: [...s.splits] }));
      segs[segIdx].splits.splice(splitIdx + 1, 0, makeDefaultSplit());
      segs[segIdx].splitCount = String(segs[segIdx].splits.length);
      return { ...prev, segments: segs };
    });
  };

  // â”€â”€ Field-level validation keyed by input element IDs â”€â”€
  const computeFieldErrors = useCallback(
    (f: CourseFormState): Record<string, string> => {
      const e: Record<string, string> = {};
      const isValidHttpUrl = (value: string): boolean => {
        try {
          const parsed = new URL(value);
          return parsed.protocol === "http:" || parsed.protocol === "https:";
        } catch {
          return false;
        }
      };
      const isValidDayHoursEntry = (
        entry:
          | { mode: "hours" | "24h" | "closed"; opens: string; closes: string }
          | undefined,
      ): boolean => {
        if (!entry) return false;
        if (entry.mode === "24h" || entry.mode === "closed") return true;
        if (entry.mode !== "hours") return false;
        const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
        return timeRe.test(entry.opens) && timeRe.test(entry.closes);
      };
      const initSpeed = parseFloat(f.init_moving_speed);
      const minSpeed = parseFloat(f.min_moving_speed);
      const dtr = parseFloat(f.down_time_ratio);
      const splitDelta = parseFloat(f.split_delta);

      if (
        f.init_moving_speed.trim() === "" ||
        isNaN(initSpeed) ||
        initSpeed <= 0
      )
        e["course-init-speed"] = "Must be > 0";
      if (f.min_moving_speed.trim() === "" || isNaN(minSpeed) || minSpeed <= 0)
        e["course-min-speed"] = "Must be > 0";
      if (!isNaN(initSpeed) && !isNaN(minSpeed) && initSpeed < minSpeed)
        e["course-init-speed"] = "Must be ≥ Overall Min Speed";
      if (f.down_time_ratio.trim() === "" || isNaN(dtr) || dtr < 0 || dtr > 1)
        e["course-dtr"] = "Must be between 0 and 1";
      if (f.split_delta.trim() === "" || isNaN(splitDelta))
        e["course-split-delta"] = "Must be a number";

      const segCount = parseInt(f.segmentCount, 10);
      if (isNaN(segCount) || segCount < 1)
        e["course-seg-count"] = "Must be at least 1";

      f.segments.forEach((seg, i) => {
        const sp = `seg${i}`;
        const sleepVal = parseFloat(seg.sleep_time);
        if (seg.sleep_time.trim() !== "" && (isNaN(sleepVal) || sleepVal < 0))
          e[`${sp}-sleep-time`] = "Must be non-negative";

        // Cross-segment distance validation in target_distance mode
        if (f.mode === "target_distance" && i > 0) {
          const prevSeg = f.segments[i - 1];
          const prevLastSplit = prevSeg.splits[prevSeg.splits.length - 1];
          const prevLastDist = parseFloat(prevLastSplit?.distance ?? "");
          if (seg.nullified) {
            // Transit segment: validate the transit distance input
            const transitDist = parseFloat(seg.splits[0]?.distance ?? "");
            if (
              !isNaN(prevLastDist) &&
              !isNaN(transitDist) &&
              transitDist <= prevLastDist
            )
              e[`${sp}-transit-dist`] =
                `Must be > ${prevLastDist} (previous segment's last split)`;
          } else {
            const firstDist = parseFloat(seg.splits[0]?.distance ?? "");
            if (
              !isNaN(prevLastDist) &&
              !isNaN(firstDist) &&
              firstDist <= prevLastDist
            )
              e[`${sp}-split0-distance`] =
                `Must be > ${prevLastDist} (previous segment's last split)`;
          }
        }

        if (seg.nullified) {
          const transitSplit = seg.splits[0];
          const transitTime = parseFloat(seg.fixed_elapsed_time ?? "");
          if (
            (seg.fixed_elapsed_time ?? "").trim() === "" ||
            isNaN(transitTime) ||
            transitTime <= 0
          ) {
            e[`${sp}-transit-time`] = "Must be > 0";
          }

          const transitDist = parseFloat(transitSplit?.distance ?? "");
          if (isNaN(transitDist) || transitDist <= 0) {
            e[`${sp}-transit-dist`] = "Must be > 0";
          }

          if (seg.splits.length !== 1) {
            e[`${sp}-transit-dist`] =
              "Transit segment must contain exactly one split";
          }

          const rs = transitSplit?.rest_stop;
          if (rs?.enabled) {
            const rp = `${sp}-transit-rs`;
            if (!rs.name.trim()) e[`${rp}-name`] = "Required";
            if (!rs.address.trim()) e[`${rp}-address`] = "Required";
            if (rs.alt.trim() && !isValidHttpUrl(rs.alt.trim())) {
              e[`${rp}-alt`] = "Must be a valid http/https URL";
            }
            if (typeof rs.backup !== "boolean") {
              e[`${rp}-backup`] = "Must be true or false";
            }
            const hoursValid = rs.sameHoursEveryDay
              ? isValidDayHoursEntry(rs.allDays)
              : rs.perDay.every((day) => isValidDayHoursEntry(day));
            if (!hoursValid) {
              e[`${rp}-hours`] = "Provide valid open hours";
            }
          }

          return;
        }

        if (seg.down_time_ratio.trim() !== "") {
          const sdtr = parseFloat(seg.down_time_ratio);
          if (isNaN(sdtr) || sdtr < 0 || sdtr > 1)
            e[`${sp}-dtr`] = "Must be between 0 and 1";
        }
        if (seg.moving_speed.trim() !== "") {
          const sms = parseFloat(seg.moving_speed);
          const effectiveMin =
            seg.min_moving_speed.trim() !== ""
              ? parseFloat(seg.min_moving_speed)
              : minSpeed;
          if (isNaN(sms) || sms <= 0) e[`${sp}-moving-speed`] = "Must be > 0";
          else if (!isNaN(effectiveMin) && sms < effectiveMin)
            e[`${sp}-moving-speed`] =
              `Must be ≥ ${effectiveMin} (${seg.min_moving_speed.trim() !== "" ? "segment" : "overall"} minimum)`;
        }
        if (seg.min_moving_speed.trim() !== "") {
          const segMin = parseFloat(seg.min_moving_speed);
          if (isNaN(segMin) || segMin <= 0)
            e[`${sp}-min-speed`] = "Must be > 0";
        }

        // Effective minimum for splits in this segment
        const segMinSpeed =
          seg.min_moving_speed.trim() !== ""
            ? parseFloat(seg.min_moving_speed)
            : minSpeed;

        const splitCount = parseInt(seg.splitCount, 10);
        if (isNaN(splitCount) || splitCount < 1)
          e[`${sp}-split-count`] = "Must be at least 1";

        seg.splits.forEach((split, j) => {
          const pp = `${sp}-split${j}`;
          const dist = parseFloat(split.distance);
          if (isNaN(dist) || dist <= 0) e[`${pp}-distance`] = "Must be > 0";

          if (f.mode === "target_distance" && j > 0) {
            const prevDist = parseFloat(seg.splits[j - 1].distance);
            if (!isNaN(dist) && !isNaN(prevDist) && dist <= prevDist)
              e[`${pp}-distance`] =
                `Must be ≥ ${prevDist} (non-decreasing in Target Distance mode)`;
          }

          if (split.moving_speed.trim() !== "") {
            const spd = parseFloat(split.moving_speed);
            if (isNaN(spd) || spd <= 0) e[`${pp}-moving-speed`] = "Must be > 0";
            else if (!isNaN(segMinSpeed) && spd < segMinSpeed)
              e[`${pp}-moving-speed`] =
                `Must be ≥ ${segMinSpeed} (${seg.min_moving_speed.trim() !== "" ? "segment" : "overall"} minimum)`;
          }

          if (split.sub_split_mode === "even") {
            const ct = parseInt(split.sub_split_count, 10);
            if (isNaN(ct) || ct < 1) e[`${pp}-ss-count`] = "Must be ≥ 1";
          } else if (split.sub_split_mode === "fixed") {
            const sd = parseFloat(split.sub_split_distance);
            if (isNaN(sd) || sd <= 0) e[`${pp}-ss-distance`] = "Must be > 0";
            const thr = parseFloat(split.last_sub_split_threshold);
            if (isNaN(thr) || thr <= 0) e[`${pp}-ss-threshold`] = "Must be > 0";
          } else if (split.sub_split_mode === "custom") {
            const parts = split.sub_split_distances
              .split(",")
              .map((s) => s.trim());
            if (
              parts.length === 0 ||
              parts.some((p) => p === "" || isNaN(parseFloat(p)))
            )
              e[`${pp}-ss-distances`] =
                "Must be a comma-separated list of numbers";
          }

          if (split.rest_stop.enabled) {
            const rp = `${pp}-rs`;
            if (!split.rest_stop.name.trim()) e[`${rp}-name`] = "Required";
            if (!split.rest_stop.address.trim())
              e[`${rp}-address`] = "Required";
          }
        });
      });

      return e;
    },
    [],
  );

  const allErrors = useMemo(
    () => computeFieldErrors(form),
    [computeFieldErrors, form],
  );

  const gpxDistanceWarnings = useMemo(() => {
    const warnings: string[] = [];
    splitGpxStatuses.forEach((seg, si) => {
      const segmentName = form.segments[si]?.name?.trim();
      seg.forEach((status, sj) => {
        const splitName = form.segments[si]?.splits[sj]?.name?.trim();
        const segmentLabel = segmentName || `Segment ${si + 1}`;
        const splitLabel = splitName || `Split ${sj + 1}`;
        const locationLabel = `${segmentLabel}, ${splitLabel}`;
        if (status === "over") {
          warnings.push(
            `${locationLabel}: cumulative distance exceeds GPX total.`,
          );
        } else if (status === "under-last") {
          warnings.push(
            `${locationLabel}: course distance has not yet reached GPX total.`,
          );
        }
      });
    });
    return warnings;
  }, [form.segments, splitGpxStatuses]);

  const describeFieldId = useCallback(
    (id: string): string => {
      const courseMap: Record<string, string> = {
        "init-speed": "Course speed",
        "min-speed": "Course minimum speed",
        dtr: "Course down time ratio",
        "split-delta": "Course speed delta",
        "seg-count": "Course segment count",
        "start-time": "Course start time",
        "ss-mode": "Course sub-split mode",
        "ss-count": "Course sub-split count",
        "ss-distance": "Course sub-split distance",
        "ss-threshold": "Course last sub-split threshold",
        "ss-distances": "Course sub-split distances",
      };
      const segmentMap: Record<string, string> = {
        "sleep-time": "Sleep time",
        "split-count": "Split count",
        dtr: "Down time ratio",
        "moving-speed": "Segment speed",
        "min-speed": "Segment minimum speed",
        "transit-time": "Transit elapsed time",
        "transit-dist": "Transit distance",
      };
      const splitMap: Record<string, string> = {
        distance: "Split distance",
        "moving-speed": "Split speed",
        "ss-count": "Sub-split count",
        "ss-distance": "Sub-split distance",
        "ss-threshold": "Sub-split threshold",
        "ss-distances": "Sub-split distances",
      };

      const segLabel = (si: number) =>
        form.segments[si]?.name?.trim() || `Segment ${si + 1}`;
      const splitLabel = (si: number, sj: number) =>
        form.segments[si]?.splits[sj]?.name?.trim() || `Split ${sj + 1}`;

      if (id.startsWith("course-")) {
        const key = id.slice("course-".length);
        return courseMap[key] ?? `Course field (${key})`;
      }

      const transitRs = id.match(/^seg(\d+)-transit-rs-(.+)$/);
      if (transitRs) {
        const si = Number(transitRs[1]);
        return `${segLabel(si)} transit rest stop ${transitRs[2]}`;
      }

      const splitRs = id.match(/^seg(\d+)-split(\d+)-rs-(.+)$/);
      if (splitRs) {
        const si = Number(splitRs[1]);
        const sj = Number(splitRs[2]);
        return `${segLabel(si)}, ${splitLabel(si, sj)} rest stop ${splitRs[3]}`;
      }

      const split = id.match(/^seg(\d+)-split(\d+)-(.+)$/);
      if (split) {
        const si = Number(split[1]);
        const sj = Number(split[2]);
        const key = split[3];
        return `${segLabel(si)}, ${splitLabel(si, sj)} ${splitMap[key] ?? key}`;
      }

      const segment = id.match(/^seg(\d+)-(.+)$/);
      if (segment) {
        const si = Number(segment[1]);
        const key = segment[2];
        return `${segLabel(si)} ${segmentMap[key] ?? key}`;
      }

      return id;
    },
    [form.segments],
  );

  const visibleErrors = useMemo(() => {
    const visible: Record<string, string> = {};
    for (const [id, msg] of Object.entries(allErrors)) {
      if (touched.has(id)) visible[id] = msg;
    }
    return visible;
  }, [allErrors, touched]);

  const handleBlur = useCallback((e: React.FocusEvent) => {
    const id = (e.target as HTMLElement).id;
    if (id) {
      setTouched((prev) => {
        if (prev.has(id)) return prev;
        const next = new Set(prev);
        next.add(id);
        return next;
      });
    }
  }, []);

  // -- Auto-calculate whenever the form becomes valid --
  useEffect(() => {
    if (Object.keys(allErrors).length > 0) return;

    let cancelled = false;

    const run = async () => {
      try {
        const payload = serializeCourse(form);
        if (useEngine === "client") {
          if (!cancelled) {
            setResult(processCourse(payload));
            setApiError(null);
          }
        } else {
          setLoading(true);
          const data = await calculateCourse(payload);
          if (!cancelled) {
            setResult(data);
            setApiError(null);
            setLoading(false);
          }
        }
      } catch (err: unknown) {
        if (cancelled) return;
        setLoading(false);
        if (err instanceof CalcError) {
          setApiError(
            err.validationErrors.length > 0
              ? err.validationErrors.join("\n")
              : err.message,
          );
        } else if (
          typeof err === "object" &&
          err !== null &&
          "response" in err
        ) {
          const axErr = err as {
            response?: { data?: { detail?: unknown }; status?: number };
          };
          const detail = axErr.response?.data?.detail;
          if (Array.isArray(detail)) {
            const msgs = detail.map((d: unknown) => {
              if (typeof d === "string") return d;
              if (typeof d === "object" && d !== null) {
                const obj = d as { loc?: unknown[]; msg?: string };
                const path = obj.loc ? obj.loc.join(" -> ") : "";
                const msg = obj.msg ?? JSON.stringify(d);
                return path ? `${path}: ${msg}` : msg;
              }
              return JSON.stringify(d);
            });
            setApiError(msgs.join("\n"));
          } else if (typeof detail === "string") {
            setApiError(detail);
          } else {
            setApiError(
              `Server error (${axErr.response?.status ?? "unknown"})`,
            );
          }
        } else {
          console.log(err);
          setApiError("Network error - is the API running?");
        }
      }
    };

    // Debounce: short for client (synchronous), longer for API to reduce calls.
    const delay = useEngine === "client" ? 250 : 500;
    const timer = setTimeout(run, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allErrors]);

  return (
    <AllErrorsContext.Provider value={allErrors}>
      <FieldErrorContext.Provider value={visibleErrors}>
        <div className="title-row">
          <h1>
            Ultra Cycling Planner{" "}
            <span className="app-version">v{__APP_VERSION__}</span>
          </h1>
          <div className="title-nav-buttons">
            <div className="nav-btn-group title-nav-btn-group-left">
              <button
                type="button"
                className="nav-btn nav-btn-legend"
                onClick={() => setLegendOpen(true)}
                title="Open the guide"
              >
                <i className="fa-solid fa-book-atlas"></i>
                <span className="nav-btn-label">Guide</span>
              </button>
              <button
                type="button"
                className="nav-btn"
                onClick={() => setExamplesOpen(true)}
                title="Load a pre-built example course"
              >
                <i className="fa-solid fa-vial"></i>
                <span className="nav-btn-label">Examples</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                style={{ display: "none" }}
                onChange={handleImport}
              />
              {PAID_APIS_ENABLED && user && (
                <button
                  type="button"
                  className="nav-btn"
                  onClick={() => setRacePlanOpen(true)}
                  title="Save or load race plans"
                >
                  <i className="fa-solid fa-cloud" />
                  <span className="nav-btn-label">My Plans</span>
                </button>
              )}
            </div>

            <div className="nav-btn-group title-nav-btn-group-right">
              <button
                type="button"
                className={`nav-btn nav-btn-gpx${gpxLoading ? " nav-btn-loading" : ""}`}
                onClick={() => !gpxLoading && gpxFileRef.current?.click()}
                disabled={gpxLoading}
                title="Load a GPX track file for elevation profiles and nearby stops"
              >
                {gpxLoading ? (
                  <>
                    <span className="btn-spinner btn-spinner-sm" /> Parsing…
                  </>
                ) : (
                  <>
                    <span className="nav-btn-icon">
                      <i className="fas fa-map" />
                    </span>
                    <span className="nav-btn-label">Load GPX</span>
                  </>
                )}
              </button>
              <input
                ref={gpxFileRef}
                type="file"
                accept=".gpx"
                style={{ display: "none" }}
                onChange={handleGpxLoad}
              />
              <button
                type="button"
                className="nav-btn"
                onClick={() => {
                  setRwgpsRestorePending(form.rwgpsRouteId ?? null);
                  setGpxSearchOpen(true);
                }}
                title="Search and import routes from RideWithGPS"
              >
                <span className="nav-btn-icon">
                  <i className="fas fa-search" />
                </span>
                <span className="nav-btn-label">Search RideWithGPS</span>
              </button>
            </div>
          </div>
        </div>

        {/* Paid-API toggle — only rendered when built with VITE_ENABLE_PAID_APIS=true */}
        {PAID_APIS_ENABLED && <PaidApiToggle />}

        <p className="app-description">
          Plan multi-day cycling events with detailed pacing, rest stops, and
          time estimates. Define segments and splits with custom speeds, decay
          rates, sub-split strategies, and rest stop open hours. The calculator
          projects arrival times, checks them against business hours, and
          supports timezone-aware scheduling across regions.
        </p>

        {/* GPX banner — independent of tab state */}
        {gpxFileName && gpxLoading && (
          <div className="gpx-file-field gpx-file-field-loading">
            <div className="gpx-file-meta">
              <span className="gpx-file-label gpx-label-loading">
                <span className="btn-spinner btn-spinner-sm" /> Parsing GPX
              </span>
              <span className="gpx-file-name">{gpxFileName}</span>
              <span className="gpx-file-stats gpx-stats-loading">
                Reading track points…
              </span>
            </div>
          </div>
        )}
        {gpxFileName && gpxTrack && !gpxLoading && (
          <div className="gpx-file-field">
            <div className="gpx-file-meta">
              <span className="gpx-file-label">
                <i className="fas fa-map" /> GPX route{" "}
                {
                  /* Display when loaded from RideWithGPS*/
                  form.rwgpsRouteId ? "(Route Loaded from RideWithGPS)" : ""
                }
              </span>
              <span className="gpx-file-name">{gpxFileName}</span>
              <span className="gpx-file-stats">
                {form.unitSystem === "imperial"
                  ? `${(gpxTrack[gpxTrack.length - 1].cumDist / 1.60934).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} mi`
                  : `${gpxTrack[gpxTrack.length - 1].cumDist.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`}
                {" · "}
                {form.unitSystem === "imperial"
                  ? `⬆ ${Math.round(bannerGainM * 3.28084).toLocaleString()} ft`
                  : `⬆ ${Math.round(bannerGainM).toLocaleString()} m`}
                {" · "}
                {gpxTrack.length.toLocaleString()} pts
              </span>
            </div>
            <button
              type="button"
              className="gpx-file-remove"
              onClick={handleGpxClear}
              aria-label="Remove GPX route"
            >
              Remove
            </button>
          </div>
        )}
        {gpxMissingWarning && (
          <div className="gpx-missing-warning">
            <span>
              <i className="fas fa-exclamation-triangle" /> {gpxMissingWarning}
            </span>
            <button
              type="button"
              className="gpx-missing-dismiss"
              onClick={() => setGpxMissingWarning(null)}
              aria-label="Dismiss warning"
            >
              ✕
            </button>
          </div>
        )}

        {/* Course map — independent of tab state */}
        {gpxTrack && splitBoundariesKm && (
          <div className="course-map-collapsible" ref={courseMapContainerRef}>
            <div
              className="course-map-collapse-header"
              onClick={() => setMapCollapsed((c) => !c)}
            >
              <span className="collapse-icon">
                {mapCollapsed ? (
                  <i className="fas fa-chevron-right" />
                ) : (
                  <i className="fas fa-chevron-down" />
                )}
              </span>
              <span>Course Map</span>
            </div>
            {!mapCollapsed && (
              <Suspense
                fallback={<div className="map-loading">Loading map…</div>}
              >
                <CourseMapDeferred
                  gpxTrack={gpxTrack}
                  splitBoundariesKm={splitBoundariesKm}
                  formSegments={form.segments}
                  unitSystem={form.unitSystem}
                  gpxProfiles={gpxProfiles}
                  onMarkerClick={handleMapMarkerClick}
                  courseName={form.name?.trim() || undefined}
                  zoomTarget={mapZoomTarget}
                  hourlyWeather={hourlyWeather}
                  courseTz={form.timezone}
                  segmentBoundaryTimes={result?.segment_details.map(
                    (seg) => seg.end_time,
                  )}
                />
              </Suspense>
            )}
          </div>
        )}

        <div className="course-settings-header course-persist-header">
          <div className="split-header-left">
            <div className="split-header-titlerow">
              <button
                type="button"
                className={`course-validation-btn${Object.keys(allErrors).length > 0 || apiError || gpxDistanceWarnings.length > 0 ? " course-validation-btn--error" : " course-validation-btn--ok"}`}
                title={
                  Object.keys(allErrors).length > 0
                    ? `${Object.keys(allErrors).length} validation error${Object.keys(allErrors).length === 1 ? "" : "s"} — click to view`
                    : gpxDistanceWarnings.length > 0
                      ? `${gpxDistanceWarnings.length} GPX distance warning${gpxDistanceWarnings.length === 1 ? "" : "s"} — click to view`
                      : apiError
                        ? "Calculation error — click to view"
                        : "No validation errors"
                }
                onClick={(e) => {
                  e.stopPropagation();
                  setValidationDialogOpen(true);
                }}
                aria-label={
                  Object.keys(allErrors).length > 0 ||
                  apiError ||
                  gpxDistanceWarnings.length > 0
                    ? "View validation errors"
                    : "Form is valid"
                }
              >
                <i
                  className={
                    Object.keys(allErrors).length > 0 ||
                    apiError ||
                    gpxDistanceWarnings.length > 0
                      ? "fa-solid fa-circle-exclamation"
                      : "fa-regular fa-circle-check"
                  }
                />
              </button>
              {activeTab === "planning" && isEditingCourseName ? (
                <input
                  ref={courseNameInputRef}
                  className="split-header-name-input"
                  type="text"
                  value={form.name ?? ""}
                  placeholder="Course name (e.g. Mishigami 2025)"
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => update({ name: e.target.value })}
                  onBlur={() => setIsEditingCourseName(false)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === "Escape") {
                      setIsEditingCourseName(false);
                      e.preventDefault();
                    }
                  }}
                />
              ) : (
                <span
                  className={
                    activeTab === "planning"
                      ? "split-header-title split-header-title--editable"
                      : "split-header-title"
                  }
                  title={
                    activeTab === "planning" ? "Click to rename" : undefined
                  }
                  onClick={(e) => {
                    if (activeTab !== "planning") return;
                    e.stopPropagation();
                    setIsEditingCourseName(true);
                    setTimeout(() => courseNameInputRef.current?.focus(), 0);
                  }}
                >
                  {form.name?.trim() || "Course"}
                </span>
              )}
            </div>
          </div>
          <div
            className="course-header-actions"
            onClick={(e) => e.stopPropagation()}
          >
            {activeTab === "planning" && (
              <button
                className="segments-toggle-btn segments-toggle-btn--reset"
                type="button"
                onClick={() => setConfirmResetOpen(true)}
                title="Reset all form fields to defaults"
              >
                ↺ Reset
              </button>
            )}
            {activeTab === "planning" && (
              <button
                type="button"
                className="segments-toggle-btn"
                onClick={() => fileInputRef.current?.click()}
                title="Import a previously exported JSON course"
              >
                <i className="fas fa-download"></i> Import JSON
              </button>
            )}
            {activeTab === "projections" &&
              weatherAvailable &&
              !hourlyWeather && (
                <button
                  type="button"
                  className="segments-toggle-btn"
                  onClick={handleFetchWeather}
                  disabled={weatherLoading}
                  title="Load weather forecast for each split (Open-Meteo, 16-day window)"
                >
                  {weatherLoading ? (
                    "Loading forecast…"
                  ) : (
                    <>
                      <i className="fa-solid fa-cloud-sun" /> Forecast
                    </>
                  )}
                </button>
              )}
            <button
              type="button"
              className="segments-toggle-btn segments-toggle-btn--export"
              onClick={handleExport}
              disabled={Object.keys(allErrors).length > 0}
              title={
                Object.keys(allErrors).length > 0
                  ? "Fix validation errors before exporting"
                  : "Export course configuration as JSON"
              }
            >
              <i className="fa-solid fa-file-export"></i> Export
            </button>
          </div>
        </div>

        {/* Validation status dialog */}
        <dialog
          ref={validationDialogRef}
          className="legend-modal"
          onClose={() => setValidationDialogOpen(false)}
        >
          {(() => {
            const hasValidationIssues =
              Object.keys(allErrors).length > 0 ||
              Boolean(apiError) ||
              gpxDistanceWarnings.length > 0;
            return (
              <>
                <div className="legend-header">
                  <h2>
                    {hasValidationIssues ? (
                      <>
                        <i className="fa-solid fa-circle-exclamation validation-dialog__icon--error" />{" "}
                        Validation Issues
                      </>
                    ) : (
                      <>
                        <i className="fa-regular fa-circle-check validation-dialog__icon--ok" />{" "}
                        Form Valid
                      </>
                    )}
                  </h2>
                  <button
                    className="legend-close"
                    onClick={() => setValidationDialogOpen(false)}
                    aria-label="Close"
                  >
                    <i className="fas fa-times" />
                  </button>
                </div>
                <div className="legend-body">
                  {!hasValidationIssues ? (
                    <p className="validation-dialog__ok-msg">
                      No validation errors — the form is ready to calculate.
                    </p>
                  ) : (
                    <>
                      {gpxDistanceWarnings.length > 0 && (
                        <ul className="validation-dialog__list">
                          {gpxDistanceWarnings.map((msg, idx) => (
                            <li key={`gpx-warning-${idx}`}>{msg}</li>
                          ))}
                        </ul>
                      )}
                      {Object.keys(allErrors).length > 0 && (
                        <ul className="validation-dialog__list">
                          {Object.entries(allErrors).map(([id, msg], idx) => (
                            <li key={`${id}-${idx}`}>
                              {describeFieldId(id)}: {msg}
                            </li>
                          ))}
                        </ul>
                      )}
                      {apiError && (
                        <div className="validation-dialog__api-error">
                          <strong>
                            {useEngine === "client"
                              ? "Calc Error"
                              : "Server Error"}
                            :
                          </strong>
                          <pre>{apiError}</pre>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </>
            );
          })()}
        </dialog>

        <div className="app-tab-bar" role="tablist">
          <button
            role="tab"
            type="button"
            className={`app-tab-btn${activeTab === "planning" ? " active" : ""}`}
            onClick={() => setActiveTab("planning")}
          >
            <i className="fas fa-pencil-alt" /> Planning
          </button>
          <button
            role="tab"
            type="button"
            className={`app-tab-btn${activeTab === "projections" ? " active" : ""}`}
            onClick={() => setActiveTab("projections")}
          >
            <i className="fas fa-chart-line" /> Projections
          </button>
        </div>
        <div className="course-form" onBlur={handleBlur}>
          <Suspense fallback={null}>
            <LegendModal
              open={legendOpen}
              onClose={() => setLegendOpen(false)}
            />
            <ExampleModal
              open={examplesOpen}
              onClose={() => setExamplesOpen(false)}
              examples={EXAMPLES}
              onSelect={handleLoadExampleGuarded}
            />
            {criteriaModalOpen && (
              <FindNearbyModal
                unitSystem={form.unitSystem}
                onClose={() => setCriteriaModalOpen(false)}
              />
            )}
            <ConfirmModal
              open={confirmExampleOpen}
              title="Load example?"
              message="You have existing course data that will be replaced by the example. Do you want to continue?"
              confirmLabel="Load example"
              cancelLabel="Keep my data"
              onConfirm={handleConfirmLoadExample}
              onCancel={handleCancelLoadExample}
            />
            <ConfirmModal
              open={confirmResetOpen}
              title="Reset course?"
              message="This will clear your current course data and restore defaults. Continue?"
              confirmLabel="Reset"
              cancelLabel="Cancel"
              onConfirm={handleConfirmReset}
              onCancel={handleCancelReset}
            />
            <ConfirmModal
              open={confirmReduceSegmentsOpen}
              title="Reduce segment count?"
              message={`Reducing segment count will delete ${pendingDeletedSplitDistanceCount} split${pendingDeletedSplitDistanceCount === 1 ? "" : "s"} with distance values. Continue?`}
              confirmLabel="Reduce"
              cancelLabel="Cancel"
              onConfirm={() => {
                if (pendingSegmentCountRaw != null) {
                  applySegmentCountChange(pendingSegmentCountRaw);
                }
                setConfirmReduceSegmentsOpen(false);
                setPendingSegmentCountRaw(null);
                setPendingDeletedSplitDistanceCount(0);
              }}
              onCancel={() => {
                setConfirmReduceSegmentsOpen(false);
                setPendingSegmentCountRaw(null);
                setPendingDeletedSplitDistanceCount(0);
              }}
            />
            <ConfirmModal
              open={pendingUnitSystem !== null}
              title="Switch unit system?"
              message={`Switching from ${form.unitSystem === "imperial" ? "Imperial" : "Metric"} to ${pendingUnitSystem === "imperial" ? "Imperial" : "Metric"}. Convert existing distance and speed values to the new system, or keep the current numbers as-is?`}
              confirmLabel="Convert values"
              cancelLabel="Keep values"
              onConfirm={handleConvertUnitSystem}
              onCancel={handleKeepUnitSystemValues}
            />

            <GpxSearchModal
              open={gpxSearchOpen}
              onClose={() => setGpxSearchOpen(false)}
              unitSystem={form.unitSystem}
              initialMode={rwgpsRestorePending ? "route-id" : "collections"}
              initialRouteId={rwgpsRestorePending}
              onSelect={(track, routeName, routeId) => {
                handleGpxLoadDirect(track, routeName, routeId);
                setRwgpsRestorePending(null);
                setGpxSearchOpen(false);
              }}
            />
            {PAID_APIS_ENABLED && user && (
              <RacePlanModal
                open={racePlanOpen}
                onClose={() => setRacePlanOpen(false)}
                currentForm={form}
                onLoad={(loadedForm) => {
                  setForm(loadedForm);
                  setRacePlanOpen(false);
                }}
              />
            )}
          </Suspense>

          <div
            className={
              activeTab !== "planning" ? "tab-panel--hidden" : undefined
            }
          >
            {/* Course Settings Card */}
            <div className="course-settings-card">
              <div className="segment-body">
                {/* Unit & Mode Toggles */}
                <div className="toggle-row--inline">
                  <div className="toggle-row-label-group">
                    <span id="units-label">Units</span>
                  </div>
                  <div
                    className="toggle-group"
                    role="group"
                    aria-labelledby="units-label"
                  >
                    <button
                      type="button"
                      className={form.unitSystem === "imperial" ? "active" : ""}
                      onClick={() => requestUnitSystemChange("imperial")}
                    >
                      Imperial
                    </button>
                    <button
                      type="button"
                      className={form.unitSystem === "metric" ? "active" : ""}
                      onClick={() => requestUnitSystemChange("metric")}
                    >
                      Metric
                    </button>
                  </div>
                </div>

                <div className="toggle-row--inline">
                  <div className="toggle-row-label-group">
                    <span id="mode-label">Distance Mode</span>
                    <span className="hint">
                      {form.mode === "distance"
                        ? "Distance values define the length of each split."
                        : "Distance values define course mile-markers."}
                    </span>
                  </div>
                  <div
                    className="toggle-group"
                    role="group"
                    aria-labelledby="mode-label"
                  >
                    <button
                      type="button"
                      className={form.mode === "distance" ? "active" : ""}
                      onClick={() => update({ mode: "distance" })}
                    >
                      Split
                    </button>
                    <button
                      type="button"
                      className={
                        form.mode === "target_distance" ? "active" : ""
                      }
                      onClick={() => update({ mode: "target_distance" })}
                    >
                      Target
                    </button>
                  </div>
                </div>

                {/* Course-level inputs */}
                <div className="fields-grid">
                  <div className="field">
                    <label htmlFor="course-init-speed">
                      Speed ({sLabel}) *
                    </label>
                    <NumberInput
                      id="course-init-speed"
                      step="any"
                      min="0"
                      value={form.init_moving_speed}
                      onChange={(v) => update({ init_moving_speed: v })}
                      placeholder="e.g. 16"
                    />
                    <FieldError fieldId="course-init-speed" />
                  </div>

                  <div className="field">
                    <label htmlFor="course-min-speed">
                      Min Speed ({sLabel}) *
                    </label>
                    <NumberInput
                      id="course-min-speed"
                      step="1"
                      min="0"
                      value={form.min_moving_speed}
                      onChange={(v) => update({ min_moving_speed: v })}
                      placeholder="e.g. 14"
                    />
                    <FieldError fieldId="course-min-speed" />
                  </div>

                  <div className="field">
                    <label htmlFor="course-dtr">Down Time Ratio *</label>
                    <NumberInput
                      id="course-dtr"
                      step="0.05"
                      min="0"
                      max="1"
                      value={form.down_time_ratio}
                      onChange={(v) => update({ down_time_ratio: v })}
                      placeholder="e.g. 0.05"
                    />
                    <FieldError fieldId="course-dtr" />
                  </div>

                  <div className="field">
                    <label
                      htmlFor="course-split-delta"
                      title="Per-split speed change: positive builds, negative fades."
                    >
                      Speed ∆ ({sLabel}) *
                    </label>
                    <NumberInput
                      id="course-split-delta"
                      step="0.05"
                      value={form.split_delta}
                      onChange={(v) => update({ split_delta: v })}
                      placeholder="0"
                    />
                    <FieldError fieldId="course-split-delta" />
                  </div>

                  <div className="field span-two-columns">
                    <label htmlFor="course-start-time">Start Time *</label>
                    <input
                      id="course-start-time"
                      type="datetime-local"
                      value={form.start_time}
                      onChange={(e) => update({ start_time: e.target.value })}
                    />
                    {form.timezone !== browserTimezone &&
                      (() => {
                        const hint = formatStartTimeHint(
                          form.start_time,
                          form.timezone,
                        );
                        return hint ? (
                          <span className="start-time-tz-hint">
                            Interpreted as {hint}
                          </span>
                        ) : null;
                      })()}
                  </div>

                  <div className="field span-two-columns">
                    <label htmlFor="course-tz">
                      Timezone
                      {detectedCourseTz &&
                        form.timezone !== detectedCourseTz && (
                          <button
                            type="button"
                            className="tz-reset-btn"
                            title="Reset to GPS auto-detected timezone"
                            onClick={() =>
                              update({ timezone: detectedCourseTz })
                            }
                          >
                            ✕ Reset to auto
                          </button>
                        )}
                    </label>
                    <TimezoneSelect
                      id="course-tz"
                      value={form.timezone}
                      onChange={(tz) => update({ timezone: tz })}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="course-ss-mode">Sub-Split Mode</label>
                    <select
                      id="course-ss-mode"
                      value={form.sub_split_mode}
                      onChange={(e) =>
                        update({
                          sub_split_mode: e.target.value as SubSplitMode,
                        })
                      }
                    >
                      <option value="hour">Hourly</option>
                      <option value="even">Even</option>
                      <option value="fixed">Fixed Size</option>
                      <option value="custom">Custom</option>
                    </select>
                  </div>

                  {form.sub_split_mode === "even" && (
                    <div className="field">
                      <label htmlFor="course-ss-count">Count *</label>
                      <NumberInput
                        id="course-ss-count"
                        min="1"
                        step="1"
                        value={form.sub_split_count ?? ""}
                        onChange={(v) => update({ sub_split_count: v })}
                        placeholder="1"
                      />
                      <FieldError fieldId="course-ss-count" />
                    </div>
                  )}

                  {form.sub_split_mode === "fixed" && (
                    <>
                      <div className="field">
                        <label htmlFor="course-ss-distance">
                          Size ({distanceLabel(form.unitSystem)}) *
                        </label>
                        <NumberInput
                          id="course-ss-distance"
                          step="any"
                          value={form.sub_split_distance ?? ""}
                          onChange={(v) => update({ sub_split_distance: v })}
                          placeholder="e.g. 20"
                        />
                        <FieldError fieldId="course-ss-distance" />
                      </div>
                      <div className="field">
                        <label htmlFor="course-ss-threshold">
                          Last Threshold ({distanceLabel(form.unitSystem)}) *
                        </label>
                        <NumberInput
                          id="course-ss-threshold"
                          step="any"
                          value={form.last_sub_split_threshold ?? ""}
                          onChange={(v) =>
                            update({ last_sub_split_threshold: v })
                          }
                          placeholder="e.g. 10"
                        />
                        <FieldError fieldId="course-ss-threshold" />
                      </div>
                    </>
                  )}

                  {form.sub_split_mode === "custom" && (
                    <div className="field field--full-width">
                      <label htmlFor="course-ss-distances">
                        Distances (comma-sep.) *
                      </label>
                      <input
                        id="course-ss-distances"
                        type="text"
                        value={form.sub_split_distances ?? ""}
                        onChange={(e) =>
                          update({ sub_split_distances: e.target.value })
                        }
                        placeholder="e.g. 10, 20, 30"
                      />
                      <FieldError fieldId="course-ss-distances" />
                    </div>
                  )}

                  <div className="field">
                    <label htmlFor="course-seg-count"># of Segments</label>
                    <NumberInput
                      id="course-seg-count"
                      min="1"
                      step="1"
                      value={form.segmentCount}
                      onChange={(v) => handleSegmentCountChange(v)}
                      placeholder="1"
                    />
                    <FieldError fieldId="course-seg-count" />
                  </div>
                </div>

                {/* Segments Toolbar */}
                <div className="segments-toolbar">
                  <div className="segments-toolbar-left">
                    <button
                      className="segments-toggle-btn"
                      onClick={() => setCollapseAllSignal((s) => s + 1)}
                      title="Collapse all segments and their splits"
                    >
                      ▶ Collapse
                    </button>
                    <button
                      className="segments-toggle-btn"
                      onClick={() => setExpandAllSignal((s) => s + 1)}
                      title="Expand all segments"
                    >
                      ▼ Expand
                    </button>
                  </div>
                  <div className="segments-toolbar-right">
                    <button
                      type="button"
                      className="segments-toggle-btn"
                      onClick={() =>
                        setQuickSetup((q) => ({ ...q, open: true }))
                      }
                      title="Quickly build or append segments with uniform split distances"
                    >
                      <i className="fa-solid fa-bolt"></i> Quick Setup
                    </button>
                    {gpxStartCity && (
                      <button
                        type="button"
                        className="segments-toggle-btn"
                        onClick={handleAutoName}
                        title="Name all splits and segments using their nearest cities"
                      >
                        <i className="fa-solid fa-tags"></i> Auto-Name
                      </button>
                    )}
                    <span className="segments-toolbar-sep" />
                    <button
                      type="button"
                      className="segments-toggle-btn"
                      onClick={() => setCriteriaModalOpen(true)}
                      title="Configure stop types and search radius used by all split nearby-stop searches"
                    >
                      <i className="fa-solid fa-magnifying-glass-location"></i>{" "}
                      Stop Criteria
                    </button>
                    <button
                      type="button"
                      className="segments-toggle-btn"
                      onClick={() => setEtaMarginsOpen(true)}
                      title="Configure the time windows used for 'near open' and 'near close' ETA badges"
                    >
                      <i className="fa-regular fa-hourglass-half"></i> ETA
                      Margins
                    </button>
                  </div>
                </div>
                {/* Pagination controls — always present so page-size preference persists */}
                <div className="seg-pagination">
                  <button
                    type="button"
                    className="seg-page-btn seg-page-btn--first"
                    disabled={clampedSegPage === 0}
                    onClick={() => setSegPage(0)}
                    title="First page"
                  >
                    «
                  </button>
                  <button
                    type="button"
                    className="seg-page-btn"
                    disabled={clampedSegPage === 0}
                    onClick={() => setSegPage((p) => Math.max(0, p - 1))}
                    title="Previous page"
                  >
                    ‹ Prev
                  </button>
                  <span className="seg-page-label">
                    {totalSegPages > 1
                      ? `Segments ${clampedSegPage * segPageSize + 1}-${Math.min(
                          (clampedSegPage + 1) * segPageSize,
                          form.segments.length,
                        )} of ${form.segments.length}`
                      : `${form.segments.length} segment${form.segments.length !== 1 ? "s" : ""}`}
                  </span>
                  <button
                    type="button"
                    className="seg-page-btn"
                    disabled={clampedSegPage >= totalSegPages - 1}
                    onClick={() =>
                      setSegPage((p) => Math.min(totalSegPages - 1, p + 1))
                    }
                    title="Next page"
                  >
                    Next ›
                  </button>
                  <button
                    type="button"
                    className="seg-page-btn seg-page-btn--last"
                    disabled={clampedSegPage >= totalSegPages - 1}
                    onClick={() => setSegPage(Math.max(0, totalSegPages - 1))}
                    title="Last page"
                  >
                    »
                  </button>
                  <select
                    className="seg-page-size"
                    value={segPageSize}
                    onChange={(e) => {
                      const newSize = Number(e.target.value);
                      // Keep the first visible segment on screen after resize.
                      const firstVisible = clampedSegPage * segPageSize;
                      setSegPageSize(newSize);
                      setSegPage(Math.floor(firstVisible / newSize));
                    }}
                    title="Segments per page"
                  >
                    <option value={5}>5 / page</option>
                    <option value={10}>10 / page</option>
                    <option value={20}>20 / page</option>
                  </select>
                </div>
                <div className="segments-container">
                  {form.segments
                    .slice(
                      clampedSegPage * segPageSize,
                      (clampedSegPage + 1) * segPageSize,
                    )
                    .flatMap((seg, localIdx) => {
                      const i = clampedSegPage * segPageSize + localIdx;
                      const totalOnPage = Math.min(
                        segPageSize,
                        form.segments.length - clampedSegPage * segPageSize,
                      );
                      const isLastOnPage = localIdx === totalOnPage - 1;
                      const segEl = (
                        <SegmentFormComponent
                          key={i}
                          segIndex={i}
                          value={seg}
                          onChange={(s) => updateSegment(i, s)}
                          unitSystem={form.unitSystem}
                          mode={form.mode}
                          isLastSeg={i === form.segments.length - 1}
                          totalSegments={form.segments.length}
                          onMoveSplitToPrevSeg={(splitIdx) =>
                            moveSplitToPrevSeg(i, splitIdx)
                          }
                          onMoveSplitToNextSeg={(splitIdx) =>
                            moveSplitToNextSeg(i, splitIdx)
                          }
                          onDeleteSplit={(splitIdx) => deleteSplit(i, splitIdx)}
                          onInsertSplitAfter={(splitIdx) =>
                            insertSplitAfter(i, splitIdx)
                          }
                          canDeleteSegment={form.segments.length > 1}
                          onDeleteSegment={() => deleteSegment(i)}
                          prevSegNullified={
                            i > 0 ? !!form.segments[i - 1].nullified : false
                          }
                          nextSegNullified={
                            i < form.segments.length - 1
                              ? !!form.segments[i + 1].nullified
                              : false
                          }
                          gpxProfiles={gpxProfiles?.[i] ?? null}
                          gpxTrack={gpxTrack}
                          courseTz={form.timezone}
                          courseSplitMode={form.sub_split_mode}
                          splitStatuses={splitGpxStatuses[i]}
                          cityLabels={cityLabels[i]}
                          cityFetching={cityFetching[i]}
                          cumulativeDists={
                            splitCumulativeDists?.[i] ?? undefined
                          }
                          segmentStartDist={
                            i === 0
                              ? 0
                              : (splitCumulativeDists?.[i - 1]?.[
                                  form.segments[i - 1].splits.length - 1
                                ] ?? null)
                          }
                          gpxTotalDist={gpxTotalDistUser}
                          segmentStartCity={
                            i === 0
                              ? gpxStartCity
                              : (cityLabels[i - 1]?.[
                                  form.segments[i - 1].splits.length - 1
                                ] ?? null)
                          }
                          expandSignal={
                            mapNavTarget?.segIdx === i
                              ? mapNavTarget.rev
                              : undefined
                          }
                          expandSplitIdx={
                            mapNavTarget?.segIdx === i
                              ? mapNavTarget.splitIdx
                              : -1
                          }
                          collapseSignal={collapseAllSignal || undefined}
                          expandAllSignal={expandAllSignal || undefined}
                          splitResults={
                            result?.segment_details[i]?.split_details ??
                            undefined
                          }
                          segmentResult={result?.segment_details[i] ?? null}
                          etaMarginOpen={parseInt(etaMargins.open, 10) || 15}
                          etaMarginClose={parseInt(etaMargins.close, 10) || 7}
                          onZoomToSegment={
                            gpxTrack ? () => handleZoomToSegment(i) : undefined
                          }
                          onZoomToSplit={
                            gpxTrack
                              ? (splitIdx: number) =>
                                  handleZoomToSplit(i, splitIdx)
                              : undefined
                          }
                          splitBoundariesKm={splitBoundariesKm?.[i] ?? null}
                        />
                      );
                      if (isLastOnPage) return [segEl];
                      return [
                        segEl,
                        <InsertZone
                          key={`insert-seg-${i}`}
                          onInsert={() => insertSegment(i)}
                          label={`Insert segment after segment ${i + 1}`}
                        />,
                      ];
                    })}
                </div>
              </div>
            </div>

            {/* API error */}
            {apiError && (
              <div className="error-banner">
                <strong>
                  {useEngine === "client" ? "Calc Error" : "Server Error"}:
                </strong>
                <pre>{apiError}</pre>
              </div>
            )}
          </div>
          {activeTab === "projections" && (
            <div className="projections-tab">
              {result && (
                <div className="course-proj-summary">
                  <div className="split-results-panel">
                    <dl className="split-results-grid">
                      <div>
                        <dt title="Course start time">Start</dt>
                        <dd>{fmtInTz(result.start_time, form.timezone)}</dd>
                      </div>
                      <div>
                        <dt title="Course end time">End</dt>
                        <dd>
                          {fmtInTz(
                            result.end_time,
                            courseEndTz ?? form.timezone,
                          )}
                          {courseEndTz && courseEndTz !== form.timezone && (
                            <span className="split-end-tz">
                              {fmtInTz(result.end_time, form.timezone)}
                            </span>
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt title="Total course distance">Distance</dt>
                        <dd>
                          {result.distance.toLocaleString(undefined, {
                            minimumFractionDigits: 1,
                            maximumFractionDigits: 1,
                          })}{" "}
                          {dLabel}
                        </dd>
                      </div>
                      <div>
                        <dt title="Total elapsed time">Elapsed</dt>
                        <dd
                          title={formatHours(result.elapsed_time_hours, "full")}
                        >
                          {formatHours(result.elapsed_time_hours)}
                        </dd>
                      </div>
                      <div>
                        <dt title="Time spent actively riding or moving">
                          Active
                        </dt>
                        <dd
                          title={formatHours(
                            Math.max(
                              0,
                              result.elapsed_time_hours -
                                result.sleep_time_hours,
                            ),
                            "full",
                          )}
                        >
                          {formatHours(
                            Math.max(
                              0,
                              result.elapsed_time_hours -
                                result.sleep_time_hours,
                            ),
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt title="Time spent moving (excludes down time)">
                          Moving
                        </dt>
                        <dd
                          title={formatHours(result.moving_time_hours, "full")}
                        >
                          {formatHours(result.moving_time_hours)}
                        </dd>
                      </div>
                      <div>
                        <dt title="Time stopped or inactive">Down</dt>
                        <dd title={formatHours(result.down_time_hours, "full")}>
                          {formatHours(result.down_time_hours)}
                        </dd>
                      </div>
                      <div>
                        <dt title="Sleep time across the course">Sleep</dt>
                        <dd
                          title={formatHours(result.sleep_time_hours, "full")}
                        >
                          {formatHours(result.sleep_time_hours)}
                        </dd>
                      </div>
                      <div>
                        <dt title="Time spent on adjustments (rest stops, etc.)">
                          Adj Time
                        </dt>
                        <dd
                          title={formatHours(
                            result.adjustment_time_hours,
                            "full",
                          )}
                        >
                          {formatHours(result.adjustment_time_hours)}
                        </dd>
                      </div>
                      <div>
                        <dt title="Time spent on transit segments">Transit</dt>
                        <dd
                          title={formatHours(result.transit_time_hours, "full")}
                        >
                          {formatHours(result.transit_time_hours)}
                        </dd>
                      </div>
                      <div>
                        <dt title="Average moving speed across the course">
                          Speed
                        </dt>
                        <dd>
                          {result.moving_time_hours > 0
                            ? (
                                result.distance / result.moving_time_hours
                              ).toFixed(2)
                            : "0.00"}{" "}
                          {sLabel}
                        </dd>
                      </div>
                      <div>
                        <dt title="Average pace for the course">Pace</dt>
                        <dd>
                          {(Math.max(
                            0,
                            result.elapsed_time_hours - result.sleep_time_hours,
                          ) > 0
                            ? result.distance /
                              Math.max(
                                0,
                                result.elapsed_time_hours -
                                  result.sleep_time_hours,
                              )
                            : 0
                          ).toFixed(2)}{" "}
                          {sLabel}
                        </dd>
                      </div>
                    </dl>
                  </div>

                  <button
                    type="button"
                    className="optional-toggle"
                    onClick={() => setShowCourseResultsGrid((v) => !v)}
                  >
                    <span
                      className={`chevron${showCourseResultsGrid ? " open" : ""}`}
                    >
                      ▶
                    </span>
                    More details
                  </button>

                  {showCourseResultsGrid && (
                    <div className="split-results-panel">
                      <dl className="split-results-grid">
                        <div>
                          <dt title="Moving-time ratio: active first, course elapsed in parentheses">
                            Moving Ratio
                          </dt>
                          <dd
                            className="proj-segment-ratio-value"
                            title={formatRawDualRatio(
                              result.moving_time_hours,
                              Math.max(
                                0,
                                result.elapsed_time_hours -
                                  result.sleep_time_hours,
                              ),
                              result.elapsed_time_hours,
                            )}
                          >
                            {formatRatioPercent(
                              result.moving_time_hours,
                              Math.max(
                                0,
                                result.elapsed_time_hours -
                                  result.sleep_time_hours,
                              ),
                            )}{" "}
                            (
                            {formatRatioPercent(
                              result.moving_time_hours,
                              result.elapsed_time_hours,
                            )}
                            )
                          </dd>
                        </div>
                        <div>
                          <dt title="Down-time ratio: active first, course elapsed in parentheses">
                            Down Ratio
                          </dt>
                          <dd
                            className="proj-segment-ratio-value"
                            title={formatRawDualRatio(
                              result.down_time_hours,
                              Math.max(
                                0,
                                result.elapsed_time_hours -
                                  result.sleep_time_hours,
                              ),
                              result.elapsed_time_hours,
                            )}
                          >
                            {formatRatioPercent(
                              result.down_time_hours,
                              Math.max(
                                0,
                                result.elapsed_time_hours -
                                  result.sleep_time_hours,
                              ),
                            )}{" "}
                            (
                            {formatRatioPercent(
                              result.down_time_hours,
                              result.elapsed_time_hours,
                            )}
                            )
                          </dd>
                        </div>
                        <div>
                          <dt title="Sleep-time ratio: active first, course elapsed in parentheses">
                            Sleep Ratio
                          </dt>
                          <dd
                            className="proj-segment-ratio-value"
                            title={formatRawDualRatio(
                              result.sleep_time_hours,
                              Math.max(
                                0,
                                result.elapsed_time_hours -
                                  result.sleep_time_hours,
                              ),
                              result.elapsed_time_hours,
                            )}
                          >
                            {formatRatioPercent(
                              result.sleep_time_hours,
                              Math.max(
                                0,
                                result.elapsed_time_hours -
                                  result.sleep_time_hours,
                              ),
                            )}{" "}
                            (
                            {formatRatioPercent(
                              result.sleep_time_hours,
                              result.elapsed_time_hours,
                            )}
                            )
                          </dd>
                        </div>
                        <div>
                          <dt title="Adjustment ratio: active first, course elapsed in parentheses">
                            Adj Ratio
                          </dt>
                          <dd
                            className="proj-segment-ratio-value"
                            title={formatRawDualRatio(
                              result.adjustment_time_hours,
                              Math.max(
                                0,
                                result.elapsed_time_hours -
                                  result.sleep_time_hours,
                              ),
                              result.elapsed_time_hours,
                            )}
                          >
                            {formatRatioPercent(
                              result.adjustment_time_hours,
                              Math.max(
                                0,
                                result.elapsed_time_hours -
                                  result.sleep_time_hours,
                              ),
                            )}{" "}
                            (
                            {formatRatioPercent(
                              result.adjustment_time_hours,
                              result.elapsed_time_hours,
                            )}
                            )
                          </dd>
                        </div>
                        <div>
                          <dt title="Down time divided by moving time, with course elapsed time in parentheses">
                            Down / Moving
                          </dt>
                          <dd
                            className="proj-segment-ratio-value"
                            title={formatRawRatio(
                              result.down_time_hours,
                              result.moving_time_hours,
                            )}
                          >
                            {formatRatioPercent(
                              result.down_time_hours,
                              result.moving_time_hours,
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt title="Active time divided by elapsed time, with course elapsed time in parentheses">
                            Active / Elapsed
                          </dt>
                          <dd
                            className="proj-segment-ratio-value"
                            title={formatRawRatio(
                              result.elapsed_time_hours -
                                result.sleep_time_hours,
                              result.elapsed_time_hours,
                            )}
                          >
                            {formatRatioPercent(
                              result.elapsed_time_hours -
                                result.sleep_time_hours,
                              result.elapsed_time_hours,
                            )}
                          </dd>
                        </div>
                        {courseWindStats?.windDir && (
                          <div style={{ gridColumn: "1 / -1" }}>
                            <dt title="Proportion of hourly forecast samples with wind from each cardinal direction">
                              Wind Direction
                            </dt>
                            <dd>
                              <i className="fa-solid fa-arrow-up" />{" "}
                              {courseWindStats.windDir.N}%{" · "}
                              <i className="fa-solid fa-arrow-right" />{" "}
                              {courseWindStats.windDir.E}%{" · "}
                              <i className="fa-solid fa-arrow-down" />{" "}
                              {courseWindStats.windDir.S}%{" · "}
                              <i className="fa-solid fa-arrow-left" />{" "}
                              {courseWindStats.windDir.W}%
                            </dd>
                          </div>
                        )}
                        {courseWindStats?.windImpact && (
                          <div style={{ gridColumn: "1 / -1" }}>
                            <dt title="Proportion of hourly samples by wind angle relative to route bearing: headwind (≤45° ahead), crosswind (45-135°), tailwind (≥135° behind)">
                              Wind Impact
                            </dt>
                            <dd>
                              <i className="fa-solid fa-arrow-up" />{" "}
                              {courseWindStats.windImpact.head}% head{" · "}
                              <i className="fa-solid fa-arrows-left-right" />{" "}
                              {courseWindStats.windImpact.cross}% cross{" · "}
                              <i className="fa-solid fa-arrow-down" />{" "}
                              {courseWindStats.windImpact.tail}% tail
                            </dd>
                          </div>
                        )}
                      </dl>
                    </div>
                  )}
                </div>
              )}

              <div className="segments-toolbar">
                <div className="segments-toolbar-left">
                  <button
                    className="segments-toggle-btn"
                    onClick={() => setCollapseAllSignal((s) => s + 1)}
                    title="Collapse all segments and their splits"
                  >
                    ▶ Collapse
                  </button>
                  <button
                    className="segments-toggle-btn"
                    onClick={() => setExpandAllSignal((s) => s + 1)}
                    title="Expand all segments"
                  >
                    ▼ Expand
                  </button>
                </div>
              </div>

              <div className="seg-pagination">
                <button
                  type="button"
                  className="seg-page-btn seg-page-btn--first"
                  disabled={clampedSegPage === 0}
                  onClick={() => setSegPage(0)}
                  title="First page"
                >
                  «
                </button>
                <button
                  type="button"
                  className="seg-page-btn"
                  disabled={clampedSegPage === 0}
                  onClick={() => setSegPage((p) => Math.max(0, p - 1))}
                  title="Previous page"
                >
                  ‹ Prev
                </button>
                <span className="seg-page-label">
                  {totalSegPages > 1
                    ? `Segments ${clampedSegPage * segPageSize + 1}-${Math.min(
                        (clampedSegPage + 1) * segPageSize,
                        form.segments.length,
                      )} of ${form.segments.length}`
                    : `${form.segments.length} segment${form.segments.length !== 1 ? "s" : ""}`}
                </span>
                <button
                  type="button"
                  className="seg-page-btn"
                  disabled={clampedSegPage >= totalSegPages - 1}
                  onClick={() =>
                    setSegPage((p) => Math.min(totalSegPages - 1, p + 1))
                  }
                  title="Next page"
                >
                  Next ›
                </button>
                <button
                  type="button"
                  className="seg-page-btn seg-page-btn--last"
                  disabled={clampedSegPage >= totalSegPages - 1}
                  onClick={() => setSegPage(Math.max(0, totalSegPages - 1))}
                  title="Last page"
                >
                  »
                </button>
                <select
                  className="seg-page-size"
                  value={segPageSize}
                  onChange={(e) => {
                    const newSize = Number(e.target.value);
                    const firstVisible = clampedSegPage * segPageSize;
                    setSegPageSize(newSize);
                    setSegPage(Math.floor(firstVisible / newSize));
                  }}
                  title="Segments per page"
                >
                  <option value={5}>5 / page</option>
                  <option value={10}>10 / page</option>
                  <option value={20}>20 / page</option>
                </select>
              </div>

              <Suspense fallback={<div className="map-loading">Loading…</div>}>
                <ProjectionsView
                  result={result}
                  form={form}
                  unitSystem={form.unitSystem}
                  courseTz={form.timezone}
                  courseStartCity={gpxStartCity}
                  segmentIndexes={pagedSegmentIndexes}
                  mapNavTarget={mapNavTarget}
                  collapseSignal={collapseAllSignal}
                  expandAllSignal={expandAllSignal}
                  gpxTrack={gpxTrack}
                  cityLabels={cityLabels}
                  cityFetching={cityFetching}
                  gpxProfiles={gpxProfiles}
                  splitCumulativeDists={splitCumulativeDists}
                  gpxTotalDist={gpxTotalDistUser}
                  etaMarginOpen={parseInt(etaMargins.open, 10) || 15}
                  etaMarginClose={parseInt(etaMargins.close, 10) || 7}
                  splitWeather={splitWeather}
                  hourlyWeather={hourlyWeather}
                  onZoomToSegment={handleZoomToSegment}
                  onZoomToSplit={handleZoomToSplit}
                />
              </Suspense>
            </div>
          )}
        </div>

        {/* ETA Margins dialog */}
        <dialog
          ref={etaMarginsRef}
          className="legend-modal"
          onClose={() => setEtaMarginsOpen(false)}
        >
          <div className="legend-header">
            <h2>ETA Margins</h2>
            <button
              className="legend-close"
              onClick={() => setEtaMarginsOpen(false)}
              aria-label="Close"
            >
              ✕
            </button>
          </div>
          <div className="legend-body">
            <p style={{ marginTop: 0, marginBottom: "1rem" }}>
              Time windows (in minutes) for the &ldquo;Near open&rdquo; and
              &ldquo;Near close&rdquo; ETA badges on rest stops.
            </p>
            <div className="fields-grid">
              <div className="field">
                <label htmlFor="eta-margin-open">Near Open (min)</label>
                <input
                  id="eta-margin-open"
                  type="number"
                  min="0"
                  step="1"
                  value={etaMargins.open}
                  onChange={(e) =>
                    setEtaMargins((m) => ({ ...m, open: e.target.value }))
                  }
                />
                {(() => {
                  const v = parseInt(etaMargins.open, 10);
                  if (
                    etaMargins.open.trim() === "" ||
                    isNaN(v) ||
                    v < 0 ||
                    !Number.isInteger(v)
                  )
                    return (
                      <span className="field-error">
                        Must be a non-negative integer
                      </span>
                    );
                  return null;
                })()}
              </div>
              <div className="field">
                <label htmlFor="eta-margin-close">Near Close (min)</label>
                <input
                  id="eta-margin-close"
                  type="number"
                  min="0"
                  step="1"
                  value={etaMargins.close}
                  onChange={(e) =>
                    setEtaMargins((m) => ({ ...m, close: e.target.value }))
                  }
                />
                {(() => {
                  const v = parseInt(etaMargins.close, 10);
                  if (
                    etaMargins.close.trim() === "" ||
                    isNaN(v) ||
                    v < 0 ||
                    !Number.isInteger(v)
                  )
                    return (
                      <span className="field-error">
                        Must be a non-negative integer
                      </span>
                    );
                  return null;
                })()}
              </div>
            </div>
          </div>
          <div className="legend-footer">
            <button
              type="button"
              className="action-btn action-btn-export"
              onClick={() => setEtaMarginsOpen(false)}
            >
              Done
            </button>
          </div>
        </dialog>

        {/* Quick-setup dialog */}
        <dialog
          ref={quickSetupRef}
          className="legend-modal"
          onClose={() => setQuickSetup((q) => ({ ...q, open: false }))}
        >
          <div className="legend-header">
            <h2>Quick Setup</h2>
            <button
              className="legend-close"
              onClick={() => setQuickSetup((q) => ({ ...q, open: false }))}
              aria-label="Close"
            >
              ✕
            </button>
          </div>
          <div className="legend-body">
            <p style={{ marginTop: 0, marginBottom: "1rem" }}>
              Create segments with uniform splits. In{" "}
              <strong>Split Distance</strong> mode each split gets the distance
              value directly; in <strong>Target Distance</strong> mode the
              values are rolled up into cumulative course markers.
            </p>
            <div className="fields-grid qs-fields-grid">
              <div className="field">
                <label htmlFor="qs-segments"># Segments</label>
                <NumberInput
                  id="qs-segments"
                  min="1"
                  step="1"
                  value={quickSetup.segments}
                  onChange={(v) =>
                    setQuickSetup((q) => ({ ...q, segments: v }))
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="qs-splits"># Splits / Segment</label>
                <NumberInput
                  id="qs-splits"
                  min="1"
                  step="1"
                  value={quickSetup.splits}
                  onChange={(v) => setQuickSetup((q) => ({ ...q, splits: v }))}
                />
              </div>
              <div className="field">
                <label htmlFor="qs-distance">
                  Distance / Split ({distanceLabel(form.unitSystem)})
                </label>
                <NumberInput
                  id="qs-distance"
                  min="0"
                  step="any"
                  value={quickSetup.distance}
                  onChange={(v) =>
                    setQuickSetup((q) => ({ ...q, distance: v }))
                  }
                  placeholder="e.g. 50"
                />
              </div>
              <div className="field">
                <label htmlFor="qs-sleep">Sleep / Segment (min)</label>
                <NumberInput
                  id="qs-sleep"
                  min="0"
                  step="any"
                  value={quickSetup.sleep}
                  onChange={(v) => setQuickSetup((q) => ({ ...q, sleep: v }))}
                />
                {minutesToHms(quickSetup.sleep) && (
                  <span className="time-aside">
                    {minutesToHms(quickSetup.sleep)}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="legend-footer">
            {form.segments.length > 0 &&
              (() => {
                const nSeg = parseInt(quickSetup.segments, 10);
                const nSpl = parseInt(quickSetup.splits, 10);
                const dist = parseFloat(quickSetup.distance);
                const sleepVal =
                  quickSetup.sleep.trim() === "" ? "0" : quickSetup.sleep;
                const valid =
                  !isNaN(nSeg) &&
                  nSeg > 0 &&
                  !isNaN(nSpl) &&
                  nSpl > 0 &&
                  !isNaN(dist) &&
                  dist > 0;
                return (
                  <button
                    type="button"
                    className="action-btn action-btn-export"
                    disabled={!valid}
                    title={valid ? undefined : "Fill in all fields to continue"}
                    onClick={() => {
                      setForm((prev) => {
                        const isTarget = prev.mode === "target_distance";
                        const lastSeg = prev.segments[prev.segments.length - 1];
                        const lastSplit =
                          lastSeg?.splits[lastSeg.splits.length - 1];
                        const lastDist = parseFloat(lastSplit?.distance ?? "0");
                        const startOffset =
                          isTarget && !isNaN(lastDist) ? lastDist : 0;
                        const newSegs: SegmentFormState[] = Array.from(
                          { length: nSeg },
                          (_, si) => ({
                            ...makeDefaultSegment(),
                            sleep_time: sleepVal,
                            splits: Array.from({ length: nSpl }, (_, sj) => ({
                              ...makeDefaultSplit(),
                              distance: isTarget
                                ? String(
                                    startOffset + (si * nSpl + sj + 1) * dist,
                                  )
                                : String(dist),
                            })),
                            splitCount: String(nSpl),
                          }),
                        );
                        return {
                          ...prev,
                          segmentCount: String(prev.segments.length + nSeg),
                          segments: [...prev.segments, ...newSegs],
                        };
                      });
                      setQuickSetup((q) => ({ ...q, open: false }));
                    }}
                  >
                    Append Segments
                  </button>
                );
              })()}
            {(() => {
              const nSeg = parseInt(quickSetup.segments, 10);
              const nSpl = parseInt(quickSetup.splits, 10);
              const dist = parseFloat(quickSetup.distance);
              const sleepVal =
                quickSetup.sleep.trim() === "" ? "0" : quickSetup.sleep;
              const valid =
                !isNaN(nSeg) &&
                nSeg > 0 &&
                !isNaN(nSpl) &&
                nSpl > 0 &&
                !isNaN(dist) &&
                dist > 0;
              return (
                <button
                  type="button"
                  className="action-btn action-btn-export"
                  disabled={!valid}
                  title={valid ? undefined : "Fill in all fields to continue"}
                  onClick={() => {
                    setForm((prev) => {
                      const isTarget = prev.mode === "target_distance";
                      const newSegs: SegmentFormState[] = Array.from(
                        { length: nSeg },
                        (_, si) => ({
                          ...makeDefaultSegment(),
                          sleep_time: sleepVal,
                          splits: Array.from({ length: nSpl }, (_, sj) => ({
                            ...makeDefaultSplit(),
                            distance: isTarget
                              ? String((si * nSpl + sj + 1) * dist)
                              : String(dist),
                          })),
                          splitCount: String(nSpl),
                        }),
                      );
                      return {
                        ...prev,
                        segmentCount: String(nSeg),
                        segments: newSegs,
                      };
                    });
                    setQuickSetup((q) => ({ ...q, open: false }));
                  }}
                >
                  Build Segments
                </button>
              );
            })()}
          </div>
        </dialog>

        {/* Auto-name dialog */}
        <dialog
          ref={autoNameDialogRef}
          className="legend-modal"
          onClose={() => setAutoNameDialog((d) => ({ ...d, open: false }))}
        >
          <div className="legend-header">
            <h2>Auto-Name by Cities</h2>
            <button
              className="legend-close"
              onClick={() => setAutoNameDialog((d) => ({ ...d, open: false }))}
              aria-label="Close"
            >
              ✕
            </button>
          </div>
          <div className="legend-body">
            {/* Prefix template inputs */}
            <div className="auto-name-prefix-section">
              <p
                style={{
                  marginTop: 0,
                  marginBottom: "0.6rem",
                  fontSize: "0.85rem",
                  color: "#aaa",
                }}
              >
                Optionally add a prefix to each name. Available tokens:{" "}
                <code className="autoname-token">{"{segment_num}"}</code>{" "}
                <code className="autoname-token">{"{split_num}"}</code>{" "}
                <code className="autoname-token">{"{from_city}"}</code>{" "}
                <code className="autoname-token">{"{to_city}"}</code>{" "}
                <code className="autoname-token">{"{from_state}"}</code>{" "}
                <code className="autoname-token">{"{to_state}"}</code>
              </p>
              <div className="auto-name-prefix-rows">
                <div className="auto-name-prefix-row">
                  <label htmlFor="an-seg-prefix">Segment prefix</label>
                  <input
                    id="an-seg-prefix"
                    type="text"
                    className="auto-name-prefix-input"
                    value={autoNameDialog.segmentPrefix}
                    onChange={(e) =>
                      setAutoNameDialog((d) => ({
                        ...d,
                        segmentPrefix: e.target.value,
                      }))
                    }
                    placeholder={`e.g. Day {segment_num}:`}
                  />
                  {autoNameDialog.segmentPrefix.trim() && (
                    <span className="auto-name-prefix-preview">
                      →{" "}
                      <em>
                        {autoNameDialog.segmentPrefix
                          .replace(/\{segment_num\}/g, "1")
                          .replace(/\{from_city\}/g, "Chicago")
                          .replace(/\{to_city\}/g, "Milwaukee")
                          .replace(/\{from_state\}/g, "IL")
                          .replace(/\{to_state\}/g, "WI")
                          .trimEnd()}
                        {autoNameDialog.includeCityRoute &&
                          " Chicago → Milwaukee"}
                      </em>
                    </span>
                  )}
                </div>
                <div className="auto-name-prefix-row">
                  <label htmlFor="an-spl-prefix">Split prefix</label>
                  <input
                    id="an-spl-prefix"
                    type="text"
                    className="auto-name-prefix-input"
                    value={autoNameDialog.splitPrefix}
                    onChange={(e) =>
                      setAutoNameDialog((d) => ({
                        ...d,
                        splitPrefix: e.target.value,
                      }))
                    }
                    placeholder={`e.g. D{segment_num}.S{split_num}`}
                  />
                  {autoNameDialog.splitPrefix.trim() && (
                    <span className="auto-name-prefix-preview">
                      →{" "}
                      <em>
                        {autoNameDialog.splitPrefix
                          .replace(/\{segment_num\}/g, "1")
                          .replace(/\{split_num\}/g, "1")
                          .replace(/\{from_city\}/g, "Chicago")
                          .replace(/\{to_city\}/g, "Milwaukee")
                          .replace(/\{from_state\}/g, "IL")
                          .replace(/\{to_state\}/g, "WI")
                          .trimEnd()}
                        {autoNameDialog.includeCityRoute &&
                          " Chicago → Milwaukee"}
                      </em>
                    </span>
                  )}
                </div>
              </div>
              {/* City route toggle */}
              <label className="auto-name-city-toggle">
                <input
                  type="checkbox"
                  checked={autoNameDialog.includeCityRoute}
                  onChange={(e) =>
                    setAutoNameDialog((d) => ({
                      ...d,
                      includeCityRoute: e.target.checked,
                    }))
                  }
                />
                <span>Append "City A → City B" route</span>
              </label>
            </div>

            {/* Existing-names warning (only when items present) */}
            {autoNameDialog.namedItems.length > 0 && (
              <>
                <p
                  style={{
                    margin: "0.75rem 0 0.4rem",
                    fontSize: "0.85rem",
                    color: "#aaa",
                  }}
                >
                  The following segments and splits already have names:
                </p>
                <ul style={{ paddingLeft: "1.25rem", margin: "0 0 0.5rem" }}>
                  {autoNameDialog.namedItems.map((item) => (
                    <li
                      key={item}
                      style={{ marginBottom: "0.25rem", fontSize: "0.82rem" }}
                    >
                      {item}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <div className="legend-footer">
            {autoNameDialog.namedItems.length > 0 && (
              <button
                type="button"
                className="action-btn action-btn-export"
                onClick={() => {
                  const { segmentPrefix, splitPrefix, includeCityRoute } =
                    autoNameDialog;
                  setAutoNameDialog((d) => ({ ...d, open: false }));
                  applyAutoName(
                    false,
                    segmentPrefix,
                    splitPrefix,
                    includeCityRoute,
                  );
                }}
              >
                Rename Unnamed Only
              </button>
            )}
            <button
              type="button"
              className="action-btn action-btn-export"
              onClick={() => {
                const { segmentPrefix, splitPrefix, includeCityRoute } =
                  autoNameDialog;
                setAutoNameDialog((d) => ({ ...d, open: false }));
                applyAutoName(
                  true,
                  segmentPrefix,
                  splitPrefix,
                  includeCityRoute,
                );
              }}
            >
              {autoNameDialog.namedItems.length > 0 ? "Rename All" : "Apply"}
            </button>
          </div>
        </dialog>
      </FieldErrorContext.Provider>
    </AllErrorsContext.Provider>
  );
}
