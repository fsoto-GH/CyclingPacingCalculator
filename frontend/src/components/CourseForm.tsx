import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type {
  CourseForm as CourseFormState,
  SegmentForm as SegmentFormState,
  CourseDetail,
  GpxTrackPoint,
  SplitGpxProfile,
} from "../types";
import { makeDefaultDayHours } from "../types";
import type { RestStopForm as RestStopFormType } from "../types";
import { nowLocalDatetime, speedLabel, distanceLabel } from "../utils";
import { makeDefaultSplit } from "../defaults";
import { serializeCourse } from "../serialization";
import { calculateCourse } from "../api";
import { processCourse, CalcError } from "../calculator/courseProcessor";
import {
  parseGpx,
  computeAllProfiles,
  computeElevGainLoss,
  extractSurfaceFromXml,
} from "../calculator/gpxParser";
import SegmentFormComponent from "./SegmentForm";
import ResultsView from "./ResultsView";
import LegendModal from "./LegendModal";
import ExampleModal from "./ExampleModal";
import { EXAMPLES } from "../examples";
import TimezoneSelect, { browserTimezone } from "./TimezoneSelect";
import { FieldErrorContext, FieldError } from "./FieldError";

function makeDefaultSegment(): SegmentFormState {
  return {
    sleep_time: "0",
    include_end_down_time: false,
    down_time_ratio: "",
    split_decay: "",
    moving_speed: "",
    min_moving_speed: "",
    splitCount: "1",
    splits: [makeDefaultSplit()],
  };
}

const STORAGE_KEY = "cycling-pacing-form";

const INITIAL_FORM: CourseFormState = {
  unitSystem: "imperial",
  mode: "distance",
  timezone: browserTimezone,
  init_moving_speed: "",
  min_moving_speed: "",
  down_time_ratio: "0",
  split_decay: "0",
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
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [examplesOpen, setExamplesOpen] = useState(false);

  // GPX state — session only, not persisted to localStorage
  const [gpxTrack, setGpxTrack] = useState<GpxTrackPoint[] | null>(null);
  const [gpxSurface, setGpxSurface] = useState<string | null>(null);
  const [gpxFileName, setGpxFileName] = useState<string | null>(null);
  const gpxFileRef = useRef<HTMLInputElement>(null);
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
    setSubmitted(false);
  }, []);

  const handleLoadExample = useCallback((example: CourseFormState) => {
    setForm(example);
    setResult(null);
    setApiError(null);
    setTouched(new Set());
    setSubmitted(false);
  }, []);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = useCallback(() => {
    const json = JSON.stringify(form, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pacing-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [form]);

  const handleImport = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result as string) as CourseFormState;
          handleLoadExample(parsed);
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
      const reader = new FileReader();
      reader.onload = () => {
        const xml = reader.result as string;
        try {
          const track = parseGpx(xml);
          setGpxTrack(track);
          setGpxSurface(extractSurfaceFromXml(xml));
          setGpxFileName(file.name);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : "Invalid GPX file";
          setApiError(msg);
        }
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
    if (gpxFileRef.current) gpxFileRef.current.value = "";
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

  // Debounced profile computation — expensive (GPX slicing + tzlookup per split).
  // Runs 400 ms after the user stops editing distances.
  useEffect(() => {
    if (!gpxTrack || !gpxSurface) {
      setGpxProfiles(null);
      return;
    }
    const timer = setTimeout(() => {
      try {
        const splitDistances = form.segments.map((seg) =>
          seg.splits.map((sp) => parseFloat(sp.distance) || 0),
        );
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
  }, [gpxTrack, gpxSurface, splitDistancesKey, form.unitSystem]);

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
    if (submitted) return allErrors;
    const visible: Record<string, string> = {};
    for (const [id, msg] of Object.entries(allErrors)) {
      if (touched.has(id)) visible[id] = msg;
    }
    return visible;
  }, [allErrors, touched, submitted]);

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

  // â”€â”€ Submit â”€â”€
  const handleSubmit = async (e: React.MouseEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setApiError(null);
    const errs = computeFieldErrors(form);
    if (Object.keys(errs).length > 0) {
      const firstId = Object.keys(errs)[0];
      document
        .getElementById(firstId)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    setLoading(true);
    try {
      const payload = serializeCourse(form);
      if (useEngine === "client") {
        setResult(processCourse(payload));
        setApiError(null);
      } else {
        const data = await calculateCourse(payload);
        setResult(data);
        setApiError(null);
      }
    } catch (err: unknown) {
      setResult(null);
      if (err instanceof CalcError) {
        setApiError(
          err.validationErrors.length > 0
            ? err.validationErrors.join("\n")
            : err.message,
        );
      } else if (typeof err === "object" && err !== null && "response" in err) {
        const axErr = err as {
          response?: { data?: { detail?: unknown }; status?: number };
        };
        const detail = axErr.response?.data?.detail;
        if (Array.isArray(detail)) {
          const msgs = detail.map((d: unknown) => {
            if (typeof d === "string") return d;
            if (typeof d === "object" && d !== null) {
              const obj = d as { loc?: unknown[]; msg?: string };
              const path = obj.loc ? obj.loc.join(" â†’ ") : "";
              const msg = obj.msg ?? JSON.stringify(d);
              return path ? `${path}: ${msg}` : msg;
            }
            return JSON.stringify(d);
          });
          setApiError(msgs.join("\n"));
        } else if (typeof detail === "string") {
          setApiError(detail);
        } else {
          setApiError(`Server error (${axErr.response?.status ?? "unknown"})`);
        }
      } else {
        setApiError("Network error â€” is the API running?");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <FieldErrorContext.Provider value={visibleErrors}>
      <div className="course-form" onBlur={handleBlur}>
        <div className="title-row">
          <h1>
            Cycling Pacing Calculator{" "}
            <span className="app-version">v{__APP_VERSION__}</span>
          </h1>
          <div className="title-nav-buttons">
            <button
              type="button"
              className="nav-btn"
              onClick={() => setExamplesOpen(true)}
            >
              Examples
            </button>
            <button
              type="button"
              className="nav-btn"
              onClick={() => fileInputRef.current?.click()}
            >
              Import
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
              className="nav-btn"
              onClick={() => gpxFileRef.current?.click()}
              title="Load a GPX track file for elevation profiles and nearby stops"
            >
              Load GPX
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
              className="nav-btn nav-btn-legend"
              onClick={() => setLegendOpen(true)}
            >
              Legend
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
        <LegendModal open={legendOpen} onClose={() => setLegendOpen(false)} />
        <ExampleModal
          open={examplesOpen}
          onClose={() => setExamplesOpen(false)}
          examples={EXAMPLES}
          onSelect={handleLoadExample}
        />

        {/* GPX banner */}
        {gpxFileName && gpxTrack && (
          <div className="gpx-file-field">
            <div className="gpx-file-meta">
              <span className="gpx-file-label">🗺 GPX route</span>
              <span className="gpx-file-name">{gpxFileName}</span>
              <span className="gpx-file-stats">
                {form.unitSystem === "imperial"
                  ? `${(gpxTrack[gpxTrack.length - 1].cumDist / 1.60934).toFixed(1)} mi`
                  : `${gpxTrack[gpxTrack.length - 1].cumDist.toFixed(1)} km`}
                {" · "}
                {form.unitSystem === "imperial"
                  ? `⬆ ${Math.round(bannerGainM * 3.28084).toLocaleString()} ft`
                  : `⬆ ${Math.round(bannerGainM).toLocaleString()} m`}
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
                className={form.unitSystem === "imperial" ? "active" : ""}
                onClick={() => update({ unitSystem: "imperial" })}
              >
                Imperial ({speedLabel("imperial")}, {distanceLabel("imperial")})
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
                Distance
              </button>
              <button
                type="button"
                className={form.mode === "target_distance" ? "active" : ""}
                onClick={() => update({ mode: "target_distance" })}
              >
                Target Distance
              </button>
            </div>
            <span className="hint">
              {form.mode === "distance"
                ? "Split distances are chunks that add up to the total."
                : "Split distances are cumulative markers along the route."}
            </span>
          </div>
        </div>

        {/* Course-level inputs */}
        <div className="fields-grid">
          <div className="field">
            <label htmlFor="course-init-speed">Speed ({sLabel}) *</label>
            <input
              id="course-init-speed"
              type="number"
              step="any"
              min="0"
              value={form.init_moving_speed}
              onChange={(e) => update({ init_moving_speed: e.target.value })}
            />
            <FieldError fieldId="course-init-speed" />
          </div>

          <div className="field">
            <label htmlFor="course-min-speed">Min Speed ({sLabel}) *</label>
            <input
              id="course-min-speed"
              type="number"
              step="any"
              min="0"
              value={form.min_moving_speed}
              onChange={(e) => update({ min_moving_speed: e.target.value })}
            />
            <FieldError fieldId="course-min-speed" />
          </div>

          <div className="field">
            <label htmlFor="course-dtr">Down Time Ratio *</label>
            <input
              id="course-dtr"
              type="number"
              step="0.05"
              min="0"
              max="1"
              value={form.down_time_ratio}
              onChange={(e) => update({ down_time_ratio: e.target.value })}
            />
            <FieldError fieldId="course-dtr" />
          </div>

          <div className="field">
            <label htmlFor="course-split-decay">Split Decay ({sLabel}) *</label>
            <input
              id="course-split-decay"
              type="number"
              step="0.05"
              value={form.split_decay}
              onChange={(e) => update({ split_decay: e.target.value })}
            />
            <span className="hint">
              Per-split speed change; negative = faster
            </span>
          </div>

          <div className="field">
            <label htmlFor="course-start-time">Start Time *</label>
            <input
              id="course-start-time"
              type="datetime-local"
              value={form.start_time}
              onChange={(e) => update({ start_time: e.target.value })}
            />
          </div>

          <div className="field">
            <label htmlFor="course-tz">Timezone</label>
            <TimezoneSelect
              id="course-tz"
              value={form.timezone}
              onChange={(tz) => update({ timezone: tz })}
            />
          </div>

          <div className="field">
            <label htmlFor="course-seg-count">Segments *</label>
            <input
              id="course-seg-count"
              type="number"
              min="1"
              step="1"
              value={form.segmentCount}
              onChange={(e) => handleSegmentCountChange(e.target.value)}
            />
            <FieldError fieldId="course-seg-count" />
          </div>
        </div>

        {/* Segments */}
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

        {/* Action buttons */}
        <div className="button-row">
          <button
            type="button"
            className={`action-btn action-btn-primary${useEngine === "api" ? " action-btn-primary--api" : ""}`}
            onClick={handleSubmit}
            disabled={loading}
          >
            {loading ? "Calculating..." : "Calculate"}
          </button>
          <button
            type="button"
            className="action-btn action-btn-export"
            onClick={handleExport}
            disabled={Object.keys(allErrors).length > 0}
            title={
              Object.keys(allErrors).length > 0
                ? "Fix validation errors before exporting"
                : undefined
            }
          >
            Export
          </button>
          <button
            className="action-btn action-btn-reset"
            type="button"
            onClick={handleReset}
          >
            Reset
          </button>
        </div>
      </div>

      {/* Results â€” outside course-form to avoid re-layout on form state changes */}
      {result && (
        <ResultsView
          result={result}
          unitSystem={form.unitSystem}
          formSegments={form.segments}
          courseTz={form.timezone}
        />
      )}
    </FieldErrorContext.Provider>
  );
}
