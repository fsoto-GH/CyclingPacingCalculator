import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  lazy,
  Suspense,
} from "react";
import type {
  CourseForm as CourseFormState,
  SegmentForm as SegmentFormState,
  CourseDetail,
  GpxTrackPoint,
  SplitGpxProfile,
} from "../types";
import { makeDefaultDayHours } from "../types";
import type { RestStopForm as RestStopFormType } from "../types";
import {
  nowLocalDatetime,
  speedLabel,
  distanceLabel,
  minutesToHms,
} from "../utils";
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
import tzlookup from "tz-lookup";
import { getCachedGeocode, reverseGeocode } from "../calculator/geocode";
import { saveGpx, loadGpx, clearGpx } from "../gpxStore";
import SegmentFormComponent from "./SegmentForm";
const CourseMap = lazy(() => import("./CourseMap"));
const ResultsView = lazy(() => import("./ResultsView"));
const LegendModal = lazy(() => import("./LegendModal"));
const ExampleModal = lazy(() => import("./ExampleModal"));
import { EXAMPLES } from "../examples";
import TimezoneSelect, { browserTimezone } from "./TimezoneSelect";
import { FieldErrorContext, FieldError } from "./FieldError";
import NumberInput from "./NumberInput";

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
  };
}

const STORAGE_KEY = "cycling-pacing-form";

const INITIAL_FORM: CourseFormState = {
  name: "",
  unitSystem: "imperial",
  mode: "distance",
  timezone: browserTimezone,
  init_moving_speed: "",
  min_moving_speed: "",
  down_time_ratio: "",
  split_delta: "",
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

    return parsed as CourseFormState;
  } catch {
    /* ignore corrupt data */
  }
  return INITIAL_FORM;
}

export default function CourseForm() {
  const [form, setForm] = useState<CourseFormState>(loadSavedForm);
  const [result, setResult] = useState<CourseDetail | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [, setLoading] = useState(false); // used by API engine path
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [legendOpen, setLegendOpen] = useState(false);
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [autoNameDialog, setAutoNameDialog] = useState<{
    open: boolean;
    namedItems: string[];
  }>({ open: false, namedItems: [] });
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
  const [mapNavSignals, setMapNavSignals] = useState<Record<string, number>>(
    {},
  );
  const handleMapMarkerClick = useCallback(
    (segIdx: number, splitIdx: number) => {
      const key = `${segIdx}-${splitIdx}`;
      setMapNavSignals((prev) => ({ ...prev, [key]: (prev[key] ?? 0) + 1 }));
    },
    [],
  );

  // Collapse/expand all segments and splits
  const [collapseAllSignal, setCollapseAllSignal] = useState(0);
  const [expandAllSignal, setExpandAllSignal] = useState(0);

  // Course settings card — collapsible + inline name editing
  const [courseCollapsed, setCourseCollapsed] = useState(false);
  const [isEditingCourseName, setIsEditingCourseName] = useState(false);
  const courseNameInputRef = useRef<HTMLInputElement | null>(null);

  // Restore GPX from IndexedDB on mount (large files don't fit in localStorage).
  useEffect(() => {
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

  // Persist form to localStorage on every change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(form));
  }, [form]);

  const update = (patch: Partial<CourseFormState>) =>
    setForm((prev) => ({ ...prev, ...patch }));

  const handleReset = useCallback(() => {
    setForm(INITIAL_FORM);
    setResult(null);
    setApiError(null);
    setTouched(new Set());
    setGpxTrack(null);
    setGpxSurface(null);
    setGpxFileName(null);
    setGpxMissingWarning(null);
    clearGpx().catch(() => {});
  }, []);

  const applyAutoName = useCallback(
    (overwriteAll: boolean) => {
      const cityShort = (label: string) => label.split(",")[0].trim();
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
            return {
              ...split,
              name: `${cityShort(startCity)} → ${cityShort(endCity)}`,
            };
          });

          const segStartCity =
            si === 0
              ? gpxStartCity
              : cityLabels[si - 1]?.[prev.segments[si - 1].splits.length - 1];
          const segEndCity = cityLabels[si]?.[seg.splits.length - 1];
          const canNameSeg = segStartCity && segEndCity;
          return {
            ...seg,
            splits: newSplits,
            ...(canNameSeg && (overwriteAll || !seg.name?.trim())
              ? {
                  name: `${cityShort(segStartCity!)} → ${cityShort(segEndCity!)}`,
                }
              : {}),
          };
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

    if (namedItems.length === 0) {
      applyAutoName(true);
    } else {
      setAutoNameDialog({ open: true, namedItems });
    }
  }, [form.segments, applyAutoName]);

  const handleLoadExample = useCallback(
    (example: CourseFormState, gpxUrl?: string) => {
      setForm(example);
      setResult(null);
      setApiError(null);
      setTouched(new Set());

      if (!gpxUrl) {
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
    if (entry) handleLoadExample(entry.form, entry.gpxUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = useCallback(() => {
    // Embed the current GPX filename so an import on the same browser can
    // attempt to restore the file from IndexedDB.
    const exportData = gpxFileName
      ? { ...form, gpxFileName }
      : { ...form, gpxFileName: undefined };
    const json = JSON.stringify(exportData, null, 2);
    const blob = new Blob([json], { type: "application/json" });
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
    setGpxMissingWarning(null);
    if (gpxFileRef.current) gpxFileRef.current.value = "";
    clearGpx().catch(() => {
      /* IDB unavailable */
    });
  }, []);

  const sLabel = speedLabel(form.unitSystem);

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
          if (cum > gpxTotal + 1e-9) return "over";
          if (
            i === lastSegIdx &&
            j === lastSplitIdx &&
            totalConfigured < gpxTotal - 1e-9
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
  const handleSegmentCountChange = (raw: string) => {
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

  const updateSegment = (i: number, seg: SegmentFormState) => {
    setForm((prev) => {
      const next = [...prev.segments];
      next[i] = seg;
      return { ...prev, segments: next };
    });
  };

  // â”€â”€ Field-level validation keyed by input element IDs â”€â”€
  const computeFieldErrors = useCallback(
    (f: CourseFormState): Record<string, string> => {
      const e: Record<string, string> = {};
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
          const firstDist = parseFloat(seg.splits[0]?.distance ?? "");
          if (
            !isNaN(prevLastDist) &&
            !isNaN(firstDist) &&
            firstDist <= prevLastDist
          )
            e[`${sp}-split0-distance`] =
              `Must be > ${prevLastDist} (previous segment's last split)`;
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
    <FieldErrorContext.Provider value={visibleErrors}>
      <div className="course-form" onBlur={handleBlur}>
        <div className="title-row">
          <h1>
            Cycling Pacing Calculator{" "}
            <span className="app-version">v{__APP_VERSION__}</span>
          </h1>
          <div className="title-nav-buttons">
            <div className="nav-btn-group">
              <button
                type="button"
                className="nav-btn"
                onClick={() => setExamplesOpen(true)}
                title="Load a pre-built example course"
              >
                <span className="nav-btn-icon">🧪</span>
                <span className="nav-btn-label">Examples</span>
              </button>
              <button
                type="button"
                className="nav-btn"
                onClick={() => fileInputRef.current?.click()}
                title="Import a previously exported JSON course"
              >
                <span className="nav-btn-icon">📥</span>
                <span className="nav-btn-label">Import JSON</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                style={{ display: "none" }}
                onChange={handleImport}
              />
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
                    <span className="nav-btn-icon">🗺️</span>
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
            </div>
            <button
              type="button"
              className="nav-btn nav-btn-legend"
              onClick={() => setLegendOpen(true)}
              title="Open the guide"
            >
              <span className="nav-btn-icon">❓</span>
              <span className="nav-btn-label">Guide</span>
            </button>
          </div>
        </div>
        <p className="app-description">
          Plan multi-day cycling events with detailed pacing, rest stops, and
          time estimates. Define segments and splits with custom speeds, decay
          rates, sub-split strategies, and rest stop open hours. The calculator
          projects arrival times, checks them against business hours, and
          supports timezone-aware scheduling across regions.
        </p>
        <Suspense fallback={null}>
          <LegendModal open={legendOpen} onClose={() => setLegendOpen(false)} />
          <ExampleModal
            open={examplesOpen}
            onClose={() => setExamplesOpen(false)}
            examples={EXAMPLES}
            onSelect={handleLoadExample}
          />
        </Suspense>

        {/* GPX banner */}
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
              <span className="gpx-file-label">🗺 GPX route</span>
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
            <span>⚠ {gpxMissingWarning}</span>
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

        {/* Course Settings Card */}
        <div className="segment-form course-settings-card">
          <div
            className="segment-header"
            onClick={() => {
              if (!isEditingCourseName) setCourseCollapsed((c) => !c);
            }}
          >
            <span className="collapse-icon" style={{ color: "#4361ee" }}>
              {courseCollapsed ? "▶" : "▼"}
            </span>
            <div className="split-header-left">
              <div className="split-header-titlerow">
                {isEditingCourseName ? (
                  <input
                    ref={courseNameInputRef}
                    className="split-header-name-input"
                    type="text"
                    value={form.name ?? ""}
                    placeholder="Course name (e.g. Mishigami 2025)"
                    style={{ fontSize: "0.95rem" }}
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
                    className="split-header-title split-header-title--editable"
                    style={{ fontSize: "0.95rem" }}
                    title="Click to rename"
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsEditingCourseName(true);
                      setTimeout(() => courseNameInputRef.current?.focus(), 0);
                    }}
                  >
                    {form.name?.trim() || "Course Settings"}
                  </span>
                )}
              </div>
            </div>
          </div>

          {!courseCollapsed && (
            <div className="segment-body">
              {/* Unit & Mode Toggles */}
              <div className="toggle-row-pair">
                <div className="field toggle-row">
                  <label id="units-label">Units</label>
                  <div
                    className="toggle-group"
                    role="group"
                    aria-labelledby="units-label"
                  >
                    <button
                      type="button"
                      className={
                        form.unitSystem === "imperial" ? "active" : ""
                      }
                      onClick={() => update({ unitSystem: "imperial" })}
                    >
                      Imperial ({speedLabel("imperial")},{" "}
                      {distanceLabel("imperial")})
                    </button>
                    <button
                      type="button"
                      className={form.unitSystem === "metric" ? "active" : ""}
                      onClick={() => update({ unitSystem: "metric" })}
                    >
                      Metric ({speedLabel("metric")}, {distanceLabel("metric")})
                    </button>
                  </div>
                </div>

                <div className="field toggle-row">
                  <label id="mode-label">Mode</label>
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
                      Split Distance
                    </button>
                    <button
                      type="button"
                      className={
                        form.mode === "target_distance" ? "active" : ""
                      }
                      onClick={() => update({ mode: "target_distance" })}
                    >
                      Target Distance
                    </button>
                  </div>
                  <span className="hint">
                    {form.mode === "distance"
                      ? "Distance values will define the length of each split."
                      : "Distance values will define course mile-markers."}
                  </span>
                </div>
              </div>

              {/* Course-level inputs */}
              <div className="fields-grid">
                <div className="field">
                  <label htmlFor="course-init-speed">Speed ({sLabel}) *</label>
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
                </div>

                <div className="field span-two-columns">
                  <label htmlFor="course-tz">Timezone</label>
                  <TimezoneSelect
                    id="course-tz"
                    value={form.timezone}
                    onChange={(tz) => update({ timezone: tz })}
                  />
                </div>
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
            </div>
          )}
        </div>

        {/* Segments */}
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
            <span className="segments-toolbar-sep" />
            <button
              type="button"
              className="segments-toggle-btn"
              onClick={() => setQuickSetup((q) => ({ ...q, open: true }))}
              title="Quickly build or append segments with uniform split distances"
            >
              ⚡ Quick Setup
            </button>
            {gpxStartCity && (
              <button
                type="button"
                className="segments-toggle-btn"
                onClick={handleAutoName}
                title="Name all splits and segments using their nearest cities"
              >
                🏷️ Auto-Name
              </button>
            )}
          </div>
          <div className="segments-toolbar-right">
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
              📁 Export
            </button>
            <button
              className="segments-toggle-btn segments-toggle-btn--reset"
              type="button"
              onClick={handleReset}
              title="Reset all form fields to defaults"
            >
              ↺ Reset
            </button>
          </div>
        </div>
        <div className="segments-container">
          {form.segments.map((seg, i) => (
            <SegmentFormComponent
              key={i}
              segIndex={i}
              value={seg}
              onChange={(s) => updateSegment(i, s)}
              unitSystem={form.unitSystem}
              mode={form.mode}
              gpxProfiles={gpxProfiles?.[i] ?? null}
              gpxTrack={gpxTrack}
              courseTz={form.timezone}
              isLastSeg={i === form.segments.length - 1}
              splitStatuses={splitGpxStatuses[i]}
              cityLabels={cityLabels[i]}
              cityFetching={cityFetching[i]}
              cumulativeDists={splitCumulativeDists?.[i] ?? undefined}
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
              expandSignal={(() => {
                // Any nav signal targeting a split in this segment should expand it
                return (
                  form.segments[i].splits.reduce((max, _, j) => {
                    const k = `${i}-${j}`;
                    return Math.max(max, mapNavSignals[k] ?? 0);
                  }, 0) || undefined
                );
              })()}
              expandSplitIdx={(() => {
                // Find which split has the most recent signal for this segment
                let best = -1;
                let bestVal = 0;
                form.segments[i].splits.forEach((_, j) => {
                  const v = mapNavSignals[`${i}-${j}`] ?? 0;
                  if (v > bestVal) {
                    bestVal = v;
                    best = j;
                  }
                });
                return best;
              })()}
              collapseSignal={collapseAllSignal || undefined}
              expandAllSignal={expandAllSignal || undefined}
            />
          ))}
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
            Create segments with uniform splits in{" "}
            <strong>Split Distance</strong> mode.
          </p>
          <div
            className="fields-grid"
            style={{ gridTemplateColumns: "repeat(4, 1fr)", gap: "0.75rem" }}
          >
            <div className="field">
              <label htmlFor="qs-segments"># Segments</label>
              <NumberInput
                id="qs-segments"
                min="1"
                step="1"
                value={quickSetup.segments}
                onChange={(v) => setQuickSetup((q) => ({ ...q, segments: v }))}
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
                onChange={(v) => setQuickSetup((q) => ({ ...q, distance: v }))}
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
          <button
            type="button"
            className="action-btn"
            onClick={() => setQuickSetup((q) => ({ ...q, open: false }))}
          >
            Cancel
          </button>
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
                  className="action-btn"
                  disabled={!valid}
                  title={valid ? undefined : "Fill in all fields to continue"}
                  onClick={() => {
                    const newSegs: SegmentFormState[] = Array.from(
                      { length: nSeg },
                      () => ({
                        ...makeDefaultSegment(),
                        sleep_time: sleepVal,
                        splits: Array.from({ length: nSpl }, () => ({
                          ...makeDefaultSplit(),
                          distance: String(dist),
                        })),
                        splitCount: String(nSpl),
                      }),
                    );
                    setForm((prev) => ({
                      ...prev,
                      mode: "distance",
                      segmentCount: String(prev.segments.length + nSeg),
                      segments: [...prev.segments, ...newSegs],
                    }));
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
                  const newSegs: SegmentFormState[] = Array.from(
                    { length: nSeg },
                    () => ({
                      ...makeDefaultSegment(),
                      sleep_time: sleepVal,
                      splits: Array.from({ length: nSpl }, () => ({
                        ...makeDefaultSplit(),
                        distance: String(dist),
                      })),
                      splitCount: String(nSpl),
                    }),
                  );
                  setForm((prev) => ({
                    ...prev,
                    mode: "distance",
                    segmentCount: String(nSeg),
                    segments: newSegs,
                  }));
                  setQuickSetup((q) => ({ ...q, open: false }));
                }}
              >
                Build Segments
              </button>
            );
          })()}
        </div>
      </dialog>

      {/* Auto-name confirmation dialog */}
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
          <p style={{ marginTop: 0 }}>
            The following segments and splits already have names. How would you
            like to proceed?
          </p>
          <ul style={{ paddingLeft: "1.25rem", margin: "0 0 0.5rem" }}>
            {autoNameDialog.namedItems.map((item) => (
              <li key={item} style={{ marginBottom: "0.25rem" }}>
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div className="legend-footer">
          <button
            type="button"
            className="action-btn"
            onClick={() => setAutoNameDialog((d) => ({ ...d, open: false }))}
          >
            Cancel
          </button>
          <button
            type="button"
            className="action-btn"
            onClick={() => {
              setAutoNameDialog((d) => ({ ...d, open: false }));
              applyAutoName(false);
            }}
          >
            Rename Unnamed Only
          </button>
          <button
            type="button"
            className="action-btn action-btn-export"
            onClick={() => {
              setAutoNameDialog((d) => ({ ...d, open: false }));
              applyAutoName(true);
            }}
          >
            Rename All
          </button>
        </div>
      </dialog>

      {/* Live course map — shown as soon as a GPX and at least one distance are set */}
      {gpxTrack && splitBoundariesKm && (
        <Suspense fallback={<div className="map-loading">Loading map…</div>}>
          <CourseMap
            gpxTrack={gpxTrack}
            splitBoundariesKm={splitBoundariesKm}
            formSegments={form.segments}
            unitSystem={form.unitSystem}
            onMarkerClick={handleMapMarkerClick}
          />
        </Suspense>
      )}

      {/* Results — outside course-form to avoid re-layout on form state changes */}
      {result && (
        <Suspense
          fallback={<div className="map-loading">Loading results…</div>}
        >
          <ResultsView
            result={result}
            unitSystem={form.unitSystem}
            formSegments={form.segments}
            courseTz={form.timezone}
            courseName={form.name?.trim() || undefined}
            cityLabels={cityLabels}
            gpxTrack={gpxTrack}
            splitBoundariesKm={splitBoundariesKm}
            gpxProfiles={gpxProfiles}
          />
        </Suspense>
      )}
    </FieldErrorContext.Provider>
  );
}
