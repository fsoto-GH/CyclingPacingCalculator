import { useState, useEffect, useCallback, useMemo } from "react";
import type {
  CourseForm as CourseFormState,
  SegmentForm as SegmentFormState,
  SplitForm as SplitFormState,
  CourseDetail,
} from "../types";
import { makeDefaultDayHours } from "../types";
import type { RestStopForm as RestStopFormType } from "../types";
import { nowLocalDatetime, speedLabel, distanceLabel } from "../utils";
import { makeDefaultSplit } from "../defaults";
import { serializeCourse } from "../serialization";
import { calculateCourse } from "../api";
import SegmentFormComponent from "./SegmentForm";
import ResultsView from "./ResultsView";
import LegendModal from "./LegendModal";
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

function exampleSplit(overrides: Partial<SplitFormState>): SplitFormState {
  return { ...makeDefaultSplit(), ...overrides };
}

function toLocalDatetime(iso: string): string {
  const d = new Date(iso);
  const offset = d.getTimezoneOffset();
  return new Date(d.getTime() - offset * 60000).toISOString().slice(0, 16);
}

const EXAMPLE_FORM: CourseFormState = {
  unitSystem: "imperial",
  timezone: browserTimezone,
  mode: "target_distance",
  init_moving_speed: "17",
  min_moving_speed: "16",
  down_time_ratio: "0.1",
  split_decay: "0.1",
  start_time: toLocalDatetime("2026-04-11T11:00:00.000Z"),
  segmentCount: "2",
  segments: [
    {
      sleep_time: "360",
      include_end_down_time: true,
      down_time_ratio: "",
      split_decay: "",
      moving_speed: "",
      min_moving_speed: "",
      splitCount: "2",
      splits: [
        exampleSplit({
          distance: "50",
          sub_split_mode: "even",
          sub_split_count: "3",
          adjustment_time: "0",
          rest_stop: {
            enabled: true,
            name: "Taqueria El Sol",
            address: "3100 14th St NW, Washington, DC 20010",
            alt: "",
            sameHoursEveryDay: true,
            allDays: { mode: "hours", opens: "17:00", closes: "23:00" },
            perDay: [
              makeDefaultDayHours(),
              makeDefaultDayHours(),
              makeDefaultDayHours(),
              makeDefaultDayHours(),
              makeDefaultDayHours(),
              makeDefaultDayHours(),
              makeDefaultDayHours(),
            ],
          },
        }),
        exampleSplit({
          distance: "100",
          sub_split_mode: "even",
          sub_split_count: "1",
          adjustment_time: "2",
          down_time: "750",
          differentTimezone: true,
          timezone: "America/New_York",
          rest_stop: {
            enabled: true,
            name: "McDonald's",
            address: "1539 Pennsylvania Ave. SE, Washington, DC",
            alt: "https://www.mcdonalds.com/us/en-us/location/DC/WASHINGTON/1539-PENNSYLVANIA-SE/7394.html",
            sameHoursEveryDay: false,
            allDays: makeDefaultDayHours(),
            perDay: [
              { mode: "hours", opens: "05:30", closes: "02:00" },
              { mode: "hours", opens: "05:30", closes: "02:00" },
              { mode: "hours", opens: "05:30", closes: "02:00" },
              { mode: "hours", opens: "05:30", closes: "03:00" },
              { mode: "hours", opens: "05:30", closes: "03:00" },
              { mode: "hours", opens: "05:30", closes: "03:00" },
              { mode: "hours", opens: "05:30", closes: "02:00" },
            ],
          },
        }),
      ],
    },
    {
      sleep_time: "0",
      include_end_down_time: false,
      down_time_ratio: "",
      split_decay: "",
      moving_speed: "",
      min_moving_speed: "",
      splitCount: "2",
      splits: [
        exampleSplit({
          distance: "150",
          sub_split_mode: "fixed",
          sub_split_distance: "20",
          last_sub_split_threshold: "10",
          adjustment_time: "0",
        }),
        exampleSplit({
          distance: "198",
          sub_split_mode: "fixed",
          sub_split_distance: "20",
          last_sub_split_threshold: "10",
          adjustment_time: "0",
          rest_stop: {
            enabled: true,
            name: "Home",
            address: "1600 Pennsylvania Ave NW, Washington, DC 20500",
            alt: "",
            sameHoursEveryDay: true,
            allDays: { mode: "24h", opens: "06:00", closes: "22:00" },
            perDay: [
              makeDefaultDayHours(),
              makeDefaultDayHours(),
              makeDefaultDayHours(),
              makeDefaultDayHours(),
              makeDefaultDayHours(),
              makeDefaultDayHours(),
              makeDefaultDayHours(),
            ],
          },
        }),
      ],
    },
  ],
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

  const handleLoadExample = useCallback(() => {
    setForm(EXAMPLE_FORM);
    setResult(null);
    setApiError(null);
    setTouched(new Set());
    setSubmitted(false);
  }, []);

  const sLabel = speedLabel(form.unitSystem);

  // ── Handlers ──
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

  // ── Field-level validation keyed by input element IDs ──
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
          if (isNaN(sms) || sms <= 0) e[`${sp}-moving-speed`] = "Must be > 0";
          else if (!isNaN(minSpeed) && sms < minSpeed)
            e[`${sp}-moving-speed`] = `Must be ≥ ${minSpeed} (overall minimum)`;
        }
        if (seg.min_moving_speed.trim() !== "") {
          const segMin = parseFloat(seg.min_moving_speed);
          if (isNaN(segMin) || segMin <= 0)
            e[`${sp}-min-speed`] = "Must be > 0";
        }

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
            else if (!isNaN(minSpeed) && spd < minSpeed)
              e[`${pp}-moving-speed`] =
                `Must be ≥ ${minSpeed} (overall minimum)`;
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

  // ── Submit ──
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
      const data = await calculateCourse(payload);
      setResult(data);
      setApiError(null);
    } catch (err: unknown) {
      setResult(null);
      if (typeof err === "object" && err !== null && "response" in err) {
        const axErr = err as {
          response?: { data?: { detail?: unknown }; status?: number };
        };
        const detail = axErr.response?.data?.detail;
        if (Array.isArray(detail)) {
          const msgs = detail.map((d: unknown) => {
            if (typeof d === "string") return d;
            if (typeof d === "object" && d !== null) {
              const obj = d as { loc?: unknown[]; msg?: string };
              const path = obj.loc ? obj.loc.join(" → ") : "";
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
        setApiError("Network error — is the API running?");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <FieldErrorContext.Provider value={visibleErrors}>
      <div className="course-form" onBlur={handleBlur}>
        <div className="title-row">
          <h1>Cycling Pacing Calculator</h1>
          <button
            type="button"
            className="legend-btn"
            onClick={() => setLegendOpen(true)}
            title="Legend & definitions"
          >
            ℹ
          </button>
          <button
            type="button"
            className="ghost-btn"
            onClick={handleLoadExample}
          >
            Load Example
          </button>
        </div>
        <p className="app-description">
          Plan multi-day cycling events with detailed pacing, rest stops, and
          time estimates. Define segments and splits with custom speeds, decay
          rates, sub-split strategies, and rest stop open hours. The calculator
          projects arrival times, checks them against business hours, and
          supports timezone-aware scheduling across regions.
        </p>
        <LegendModal open={legendOpen} onClose={() => setLegendOpen(false)} />

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
            />
          ))}
        </div>

        {/* API error */}
        {apiError && (
          <div className="error-banner">
            <strong>Server Error:</strong>
            <pre>{apiError}</pre>
          </div>
        )}

        {/* Submit */}
        <div className="button-row">
          <button
            type="button"
            className="submit-btn"
            onClick={handleSubmit}
            disabled={loading}
          >
            {loading ? "Calculating..." : "Calculate"}
          </button>
          <button className="reset-btn" type="button" onClick={handleReset}>
            Reset Form
          </button>
        </div>
      </div>

      {/* Results — outside course-form to avoid re-layout on form state changes */}
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
