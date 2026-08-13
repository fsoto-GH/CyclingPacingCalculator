import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CourseDetail,
  CourseForm,
  GpxTrackPoint,
  RealtimeSplitOverride,
  SplitGpxProfile,
  UnitSystem,
} from "../types";
import type { AuthUser } from "../AppSettingsContext";
import {
  distanceLabel,
  nowLocalDatetime,
  speedLabel,
  tzLocalStringToUtcIso,
} from "../utils";
import {
  buildRealtimeEtaInfo,
  formatIsoInTzShort,
  type EtaInfo,
} from "../timeMath";
import {
  fetchSplitWeatherPairs,
  weatherCodeIcon,
  weatherCodeLabel,
  windDirectionLabel,
} from "../calculator/weather";
import type { SplitWeather, SplitWeatherPair } from "../calculator/weather";
import { saveRealtimeOverrides } from "../api";
import { SERVER_FUNCTIONS_ENABLED } from "../config";

// ── localStorage helpers ──────────────────────────────────────────────────────

const LS_PREFIX = "ultra-cycling-planner-realtime-";
const LS_PLAN_ID_KEY = "ultra-cycling-planner-realtime-plan-id";
const STALE_MS = 30 * 24 * 60 * 60 * 1000;

interface LocalData {
  schemaVersion: 1;
  savedAt: string;
  overrides: Record<string, RealtimeSplitOverride>;
}

function courseHash(form: CourseForm): string {
  const key =
    form.start_time +
    "|" +
    form.segments.map((s) => s.splits.length).join(",");
  let h = 2_166_136_261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = (h * 16_777_619) >>> 0;
  }
  return h.toString(36);
}

function loadLocalOverrides(
  hash: string,
): Map<number, RealtimeSplitOverride> | null {
  try {
    const raw = localStorage.getItem(LS_PREFIX + hash);
    if (!raw) return null;
    const data = JSON.parse(raw) as LocalData;
    if (data.schemaVersion !== 1) return null;
    const map = new Map<number, RealtimeSplitOverride>();
    for (const [k, v] of Object.entries(data.overrides)) {
      map.set(Number(k), v as RealtimeSplitOverride);
    }
    return map.size > 0 ? map : null;
  } catch {
    return null;
  }
}

function saveLocalOverrides(
  hash: string,
  overrides: Map<number, RealtimeSplitOverride>,
): void {
  try {
    const data: LocalData = {
      schemaVersion: 1,
      savedAt: new Date().toISOString(),
      overrides: Object.fromEntries(
        [...overrides.entries()].map(([k, v]) => [String(k), v]),
      ),
    };
    localStorage.setItem(LS_PREFIX + hash, JSON.stringify(data));
  } catch { /* quota — ignore */ }
}

function cleanStaleRealtimeKeys(): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k?.startsWith(LS_PREFIX)) continue;
      const raw = localStorage.getItem(k);
      if (!raw) { localStorage.removeItem(k); continue; }
      try {
        const { savedAt } = JSON.parse(raw) as Partial<LocalData>;
        if (!savedAt || Date.now() - new Date(savedAt).getTime() > STALE_MS)
          localStorage.removeItem(k);
      } catch {
        localStorage.removeItem(k);
      }
    }
  } catch { /* ignore */ }
}

// ── Internal types ────────────────────────────────────────────────────────────

interface SplitRow {
  segIdx: number;
  splitIdx: number;
  name: string;
  distance: number;
  projectedStart: string;
  projectedEnd: string;
  projectedSpeed: number;
  minSpeed: number;
  delta: number;
  timezone: string;
}

interface RealtimeViewProps {
  result: CourseDetail | null;
  form: CourseForm;
  unitSystem: UnitSystem;
  gpxProfiles?: SplitGpxProfile[][] | null;
  /** Reserved for future route overlay */
  gpxTrack?: GpxTrackPoint[] | null;
  etaMarginOpen?: number;
  etaMarginClose?: number;
  user?: AuthUser | null;
  realtimePlanId?: string | null;
  onRealtimePlanSaved?: (id: string) => void;
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function toDatetimeLocal(iso: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(iso));
  const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${v.year}-${v.month}-${v.day}T${v.hour}:${v.minute}`;
}

function hoursBetween(start: string, end: string, timezone: string): number {
  return (
    (new Date(tzLocalStringToUtcIso(end, timezone)).getTime() -
      new Date(tzLocalStringToUtcIso(start, timezone)).getTime()) /
    3_600_000
  );
}

function formatDelta(hours: number): string {
  const minutes = Math.round(Math.abs(hours) * 60);
  if (minutes === 0) return "on plan";
  return `${minutes} min ${hours < 0 ? "ahead" : "behind"}`;
}

function fmtTemp(tempC: number, unitSystem: UnitSystem): string {
  return unitSystem === "imperial"
    ? `${Math.round((tempC * 9) / 5 + 32)}\u00b0F`
    : `${Math.round(tempC)}\u00b0C`;
}

function fmtWind(kmh: number, unitSystem: UnitSystem): string {
  return unitSystem === "imperial"
    ? `${Math.round(kmh * 0.621_371)} mph`
    : `${Math.round(kmh)} km/h`;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function RealtimeView({
  result,
  form,
  unitSystem,
  gpxProfiles,
  gpxTrack: _gpxTrack,
  etaMarginOpen = 15,
  etaMarginClose = 7,
  user,
  realtimePlanId: externalPlanId,
  onRealtimePlanSaved,
}: RealtimeViewProps) {
  const speedUnit = speedLabel(unitSystem);
  const distanceUnit = distanceLabel(unitSystem);

  const hash = useMemo(() => courseHash(form), [form]);

  const rows = useMemo<SplitRow[]>(() => {
    if (!result) return [];
    return result.segment_details.flatMap((segment, segIdx) =>
      segment.split_details.map((split, splitIdx) => {
        const cfgSplit = form.segments[segIdx]?.splits[splitIdx];
        const cfgSeg = form.segments[segIdx];
        const timezone =
          split.end_timezone ||
          (cfgSplit?.differentTimezone && cfgSplit.timezone
            ? cfgSplit.timezone
            : form.timezone);
        const minSpeed =
          Number(
            cfgSplit?.moving_speed ||
              cfgSeg?.min_moving_speed ||
              form.min_moving_speed,
          ) || 0;
        return {
          segIdx,
          splitIdx,
          name:
            cfgSplit?.name?.trim() ||
            `Segment ${segIdx + 1}, split ${splitIdx + 1}`,
          distance: split.distance,
          projectedStart: split.start_time,
          projectedEnd: split.end_time,
          projectedSpeed: split.moving_speed,
          minSpeed,
          delta: Number(cfgSeg?.split_delta || form.split_delta) || 0,
          timezone,
        };
      }),
    );
  }, [form, result]);

  // ── Override state ──
  const [overrides, setOverrides] = useState<Map<number, RealtimeSplitOverride>>(
    () => loadLocalOverrides(courseHash(form)) ?? new Map(),
  );
  const [localWarning, setLocalWarning] = useState<string | null>(null);

  // Detect course hash change after initial mount and invalidate stale overrides
  const hashRef = useRef<string | null>(null);
  useEffect(() => {
    if (hashRef.current === hash) return;
    if (hashRef.current !== null) {
      setOverrides(new Map());
      setLocalWarning(
        "Course was modified — previous realtime session was not applied.",
      );
    } else {
      const stored = loadLocalOverrides(hash);
      if (stored) setOverrides(stored);
    }
    hashRef.current = hash;
  }, [hash]);

  // ── Auto-select current split on first mount ──
  const didAutoSelectRef = useRef(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  useEffect(() => {
    if (didAutoSelectRef.current || rows.length === 0) return;
    didAutoSelectRef.current = true;
    const now = Date.now();
    let idx = 0;
    for (let i = 0; i < rows.length; i++) {
      if (new Date(rows[i].projectedEnd).getTime() < now) idx = i + 1;
    }
    setSelectedIndex(Math.min(idx, rows.length - 1));
  }, [rows]);

  useEffect(() => { cleanStaleRealtimeKeys(); }, []);

  // ── Controlled field state ──
  const [actualStart, setActualStart] = useState("");
  const [actualEnd, setActualEnd] = useState("");
  const [manualSpeed, setManualSpeed] = useState("");

  // Repopulate fields on navigation; read from override map first
  useEffect(() => {
    const row = rows[selectedIndex];
    if (!row) return;
    const ov = overrides.get(selectedIndex);
    setActualStart(
      ov?.actualStart ?? toDatetimeLocal(row.projectedStart, row.timezone),
    );
    setActualEnd(
      ov?.actualEnd ?? toDatetimeLocal(row.projectedEnd, row.timezone),
    );
    setManualSpeed(ov?.manualSpeed ?? row.projectedSpeed.toFixed(2));
    setSplitWeather(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIndex, rows]); // deliberately excludes overrides

  // ── Debounced localStorage auto-save ──
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(
      () => saveLocalOverrides(hash, overrides),
      500,
    );
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [hash, overrides]);

  // ── Device time ticker ──
  const [deviceTime, setDeviceTime] = useState(() =>
    new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
  );
  useEffect(() => {
    const id = setInterval(
      () =>
        setDeviceTime(
          new Date().toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          }),
        ),
      60_000,
    );
    return () => clearInterval(id);
  }, []);

  // ── Override write helpers ──
  function updateOverride(patch: Partial<RealtimeSplitOverride>): void {
    setOverrides((m) => {
      const next = new Map(m);
      const existing = next.get(selectedIndex) ?? {};
      next.set(selectedIndex, { ...existing, ...patch });
      return next;
    });
  }

  function handleActualStartChange(v: string): void {
    setActualStart(v);
    updateOverride({ actualStart: v });
  }
  function handleActualEndChange(v: string): void {
    setActualEnd(v);
    updateOverride({ actualEnd: v });
  }
  function handleManualSpeedChange(v: string): void {
    setManualSpeed(v);
    updateOverride({ manualSpeed: v });
  }

  function handleReset(): void {
    setOverrides((m) => {
      const next = new Map(m);
      next.delete(selectedIndex);
      return next;
    });
    const row = rows[selectedIndex];
    if (row) {
      setActualStart(toDatetimeLocal(row.projectedStart, row.timezone));
      setActualEnd(toDatetimeLocal(row.projectedEnd, row.timezone));
      setManualSpeed(row.projectedSpeed.toFixed(2));
    }
    setSplitWeather(null);
  }

  // ── Calculation for the selected split ──
  const selected = rows[selectedIndex];

  const calculation = useMemo(() => {
    if (!selected) return null;
    const enteredSpeed = Number(manualSpeed);
    const hasManualSpeed = Number.isFinite(enteredSpeed) && enteredSpeed > 0;
    const enteredHours =
      actualStart && actualEnd
        ? hoursBetween(actualStart, actualEnd, selected.timezone)
        : 0;
    const speedFromTimes =
      enteredHours > 0
        ? selected.distance / Math.max(enteredHours, 1 / 60)
        : selected.projectedSpeed;
    const effectiveSpeed = hasManualSpeed ? enteredSpeed : speedFromTimes;
    const minSpeedViolation =
      selected.minSpeed > 0 && effectiveSpeed < selected.minSpeed;
    const updatedEnd =
      actualStart && effectiveSpeed > 0
        ? new Date(
            new Date(
              tzLocalStringToUtcIso(actualStart, selected.timezone),
            ).getTime() +
              (selected.distance / effectiveSpeed) * 3_600_000,
          ).toISOString()
        : selected.projectedEnd;
    const deltaHours = actualStart
      ? hoursBetween(
          toDatetimeLocal(selected.projectedStart, selected.timezone),
          actualStart,
          selected.timezone,
        )
      : 0;
    return {
      effectiveSpeed,
      minSpeedViolation,
      updatedEnd,
      deltaHours,
      speedFromTimes,
    };
  }, [actualEnd, actualStart, manualSpeed, selected]);

  // ── Downstream propagation ──
  const updatedRows = useMemo(() => {
    if (!calculation || selectedIndex >= rows.length) return rows;
    const next = rows.map((r) => ({ ...r }));
    next[selectedIndex] = {
      ...next[selectedIndex],
      projectedEnd: calculation.updatedEnd,
      projectedSpeed: calculation.effectiveSpeed,
    };
    let speed = calculation.effectiveSpeed;
    let startMs = new Date(next[selectedIndex].projectedEnd).getTime();
    for (let i = selectedIndex + 1; i < next.length; i++) {
      const row = next[i];
      speed = Math.max(speed + row.delta, row.minSpeed);
      const origDurMs =
        new Date(row.projectedEnd).getTime() -
        new Date(row.projectedStart).getTime();
      const origMovingMs = (row.distance / row.projectedSpeed) * 3_600_000;
      const stopMs = Math.max(0, origDurMs - origMovingMs);
      const newEndMs =
        startMs + (row.distance / speed) * 3_600_000 + stopMs;
      next[i] = {
        ...row,
        projectedStart: new Date(startMs).toISOString(),
        projectedEnd: new Date(newEndMs).toISOString(),
        projectedSpeed: speed,
      };
      startMs = newEndMs;
    }
    return next;
  }, [calculation, rows, selectedIndex]);

  // ── Forecast ──
  const [splitWeather, setSplitWeather] = useState<SplitWeatherPair | null>(
    null,
  );
  const [weatherLoading, setWeatherLoading] = useState(false);

  const canForecast = !!(
    selected && gpxProfiles?.[selected.segIdx]?.[selected.splitIdx]
  );

  const handleFetchForecast = useCallback(async () => {
    if (!selected || !gpxProfiles) return;
    const profile = gpxProfiles[selected.segIdx]?.[selected.splitIdx];
    if (!profile) return;
    const startTimeIso = actualStart
      ? tzLocalStringToUtcIso(actualStart, selected.timezone)
      : selected.projectedStart;
    const endTimeIso = calculation?.updatedEnd ?? selected.projectedEnd;
    setWeatherLoading(true);
    try {
      const pairs = await fetchSplitWeatherPairs([
        {
          startLat: profile.startLat,
          startLon: profile.startLon,
          startTimeIso,
          endLat: profile.endLat,
          endLon: profile.endLon,
          endTimeIso,
        },
      ]);
      setSplitWeather(pairs[0] ?? null);
    } catch {
      setSplitWeather(null);
    } finally {
      setWeatherLoading(false);
    }
  }, [actualStart, calculation, gpxProfiles, selected]);

  // ── Rest stop info ──
  const restStopInfo = useMemo(() => {
    if (!selected || !result) return null;
    const formSplit = form.segments[selected.segIdx]?.splits[selected.splitIdx];
    if (!formSplit) return null;
    const arrivalIso = calculation?.updatedEnd ?? selected.projectedEnd;
    const mainEta = buildRealtimeEtaInfo(
      arrivalIso,
      formSplit,
      form.timezone,
      etaMarginOpen,
      etaMarginClose,
    );
    const hasMain =
      formSplit.rest_stop.enabled &&
      !!(
        formSplit.rest_stop.name ||
        formSplit.rest_stop.address ||
        formSplit.rest_stop.alt ||
        mainEta
      );
    const hasInterm =
      formSplit.intermediate_stop.enabled &&
      !!(
        formSplit.intermediate_stop.name ||
        formSplit.intermediate_stop.address ||
        formSplit.intermediate_stop.alt
      );
    if (!hasMain && !hasInterm) return null;
    return { formSplit, mainEta, hasMain, hasInterm };
  }, [calculation, etaMarginClose, etaMarginOpen, form, result, selected]);

  // ── DB save ──
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [realtimePlanId, setRealtimePlanId] = useState<string | null>(() => {
    if (externalPlanId) return externalPlanId;
    try {
      return localStorage.getItem(LS_PLAN_ID_KEY);
    } catch {
      return null;
    }
  });

  const handleDbSave = useCallback(async () => {
    if (!SERVER_FUNCTIONS_ENABLED || !user) return;
    setSaveStatus("saving");
    setSaveError(null);
    const payload = {
      form,
      realtime: {
        schemaVersion: 1 as const,
        overrides: Object.fromEntries(
          [...overrides.entries()].map(([k, v]) => [String(k), v]),
        ),
      },
    };
    try {
      const saved = await saveRealtimeOverrides(
        realtimePlanId,
        `${form.name?.trim() || "Course"} \u2014 Realtime`,
        payload,
      );
      if (!realtimePlanId) {
        setRealtimePlanId(saved.id);
        try {
          localStorage.setItem(LS_PLAN_ID_KEY, saved.id);
        } catch { /* ignore */ }
        onRealtimePlanSaved?.(saved.id);
      }
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 3000);
    } catch (err) {
      setSaveStatus("error");
      setSaveError(err instanceof Error ? err.message : "Save failed");
    }
  }, [form, onRealtimePlanSaved, overrides, realtimePlanId, user]);

  // ── Queue scroll ──
  const selectedRowRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    selectedRowRef.current?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }, [selectedIndex]);

  // ── Row status ──
  function rowStatus(
    row: SplitRow,
    idx: number,
  ): "done" | "selected" | "future" {
    if (idx === selectedIndex) return "selected";
    const ov = overrides.get(idx);
    const isDone = ov?.actualEnd
      ? true
      : new Date(row.projectedEnd).getTime() < Date.now();
    return isDone ? "done" : "future";
  }

  const canSaveToDb = SERVER_FUNCTIONS_ENABLED && !!user;
  const hasOverrideOnSelected = overrides.has(selectedIndex);
  const remainingCount = updatedRows.filter(
    (row, i) => rowStatus(row, i) !== "done",
  ).length;

  if (!result || rows.length === 0) {
    return (
      <div className="realtime-empty">
        <i className="fas fa-stopwatch" />
        <p>Calculate a course in Planning before opening the realtime view.</p>
      </div>
    );
  }

  return (
    <div className="realtime-tab">
      {localWarning && (
        <div className="realtime-warning realtime-warning--banner" role="alert">
          <i className="fas fa-triangle-exclamation" /> {localWarning}
          <button
            type="button"
            className="realtime-warning-dismiss"
            onClick={() => setLocalWarning(null)}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      <div className="realtime-intro">
        <div>
          <span className="realtime-kicker">Ride mode</span>
          <h2>Update the plan as you ride</h2>
          <p>
            Changes are saved locally and do not alter the course
            configuration.
          </p>
        </div>
        <div className="realtime-intro-actions">
          <span className="realtime-device-time">
            <i className="fas fa-clock" /> {deviceTime}
          </span>
          {canSaveToDb && (
            <button
              type="button"
              className={`realtime-save-btn${saveStatus === "saved" ? " realtime-save-btn--saved" : ""}`}
              onClick={handleDbSave}
              disabled={saveStatus === "saving"}
              title="Save this session to your account"
            >
              {saveStatus === "saving" ? (
                <>
                  <span className="btn-spinner btn-spinner-sm" /> Saving\u2026
                </>
              ) : saveStatus === "saved" ? (
                <>
                  <i className="fas fa-check" /> Saved
                </>
              ) : (
                <>
                  <i className="fa-regular fa-floppy-disk" />
                  {" Save"}
                  {overrides.size > 0 && realtimePlanId && (
                    <span
                      className="realtime-dirty-dot"
                      aria-hidden="true"
                    />
                  )}
                </>
              )}
            </button>
          )}
          {saveStatus === "error" && saveError && (
            <span className="realtime-save-error">{saveError}</span>
          )}
        </div>
      </div>

      <div className="realtime-grid">
        {/* ── Editor ── */}
        <section className="realtime-editor">
          <label className="realtime-split-label">
            Current split
            <select
              value={selectedIndex}
              onChange={(e) => setSelectedIndex(Number(e.target.value))}
            >
              {rows.map((row, i) => {
                const st = rowStatus(row, i);
                const prefix =
                  st === "done" ? "\u2713 " : i === selectedIndex ? "\u25b6 " : "";
                return (
                  <option key={`${row.segIdx}-${row.splitIdx}`} value={i}>
                    {prefix}{row.name}
                  </option>
                );
              })}
            </select>
          </label>

          <div className="realtime-fields">
            <label>
              Prev split end / start
              <input
                type="datetime-local"
                value={actualStart}
                onChange={(e) => handleActualStartChange(e.target.value)}
              />
              <small>
                {selected?.timezone}{" "}
                <button
                  type="button"
                  className="realtime-now-button"
                  onClick={() => handleActualStartChange(nowLocalDatetime())}
                >
                  Use device time
                </button>
              </small>
            </label>
            <label>
              Split end / next start
              <input
                type="datetime-local"
                value={actualEnd}
                onChange={(e) => handleActualEndChange(e.target.value)}
              />
              <small>Optional until complete</small>
            </label>
            <label>
              Speed ({speedUnit})
              <input
                type="number"
                min="0"
                step="0.01"
                value={manualSpeed}
                onChange={(e) => handleManualSpeedChange(e.target.value)}
              />
              <small>
                {calculation?.speedFromTimes.toFixed(2)} {speedUnit} from
                times
              </small>
            </label>
          </div>

          {calculation?.minSpeedViolation && selected && (
            <div className="realtime-warning" role="alert">
              <i className="fas fa-triangle-exclamation" /> Speed is below
              configured minimum of {selected.minSpeed.toFixed(2)} {speedUnit}.
            </div>
          )}

          {calculation && selected && (
            <dl className="realtime-result-grid">
              <div>
                <dt>Updated end</dt>
                <dd>
                  {formatIsoInTzShort(
                    calculation.updatedEnd,
                    selected.timezone,
                  )}
                </dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd
                  className={
                    calculation.deltaHours < -1 / 60
                      ? "realtime-ahead"
                      : calculation.deltaHours > 1 / 60
                        ? "realtime-behind"
                        : "realtime-on-plan"
                  }
                >
                  {formatDelta(calculation.deltaHours)}
                </dd>
              </div>
              <div>
                <dt>Projected speed</dt>
                <dd>
                  {selected.projectedSpeed.toFixed(2)} {speedUnit}
                </dd>
              </div>
              <div>
                <dt>Distance</dt>
                <dd>
                  {selected.distance.toFixed(1)} {distanceUnit}
                </dd>
              </div>
            </dl>
          )}

          {restStopInfo && (
            <div className="realtime-stops">
              <div className="realtime-stops-header">
                <i className="fa-solid fa-map-pin" aria-hidden="true" /> Stops
              </div>
              {restStopInfo.hasInterm && (
                <RestStopRow
                  type="intermediate"
                  name={restStopInfo.formSplit.intermediate_stop.name}
                  address={restStopInfo.formSplit.intermediate_stop.address}
                  alt={restStopInfo.formSplit.intermediate_stop.alt}
                  etaInfo={null}
                />
              )}
              {restStopInfo.hasMain && (
                <RestStopRow
                  type="rest"
                  name={restStopInfo.formSplit.rest_stop.name}
                  address={restStopInfo.formSplit.rest_stop.address}
                  alt={restStopInfo.formSplit.rest_stop.alt}
                  etaInfo={restStopInfo.mainEta}
                />
              )}
            </div>
          )}

          {canForecast && (
            <div className="realtime-forecast">
              <div className="realtime-forecast-header">
                <span>Weather forecast</span>
                <button
                  type="button"
                  className="realtime-forecast-btn"
                  onClick={handleFetchForecast}
                  disabled={weatherLoading}
                >
                  {weatherLoading ? (
                    <>
                      <span className="btn-spinner btn-spinner-sm" /> Loading\u2026
                    </>
                  ) : (
                    <>
                      <i className="fa-solid fa-cloud-sun" />{" "}
                      {splitWeather ? "Refresh" : "Fetch"}
                    </>
                  )}
                </button>
              </div>
              {splitWeather && (
                <div className="realtime-weather-cards">
                  {splitWeather.start && (
                    <WeatherMini
                      label="Departure"
                      weather={splitWeather.start}
                      unitSystem={unitSystem}
                    />
                  )}
                  {splitWeather.end && (
                    <WeatherMini
                      label="Arrival"
                      weather={splitWeather.end}
                      unitSystem={unitSystem}
                    />
                  )}
                </div>
              )}
            </div>
          )}

          <div className="realtime-editor-actions">
            <button
              type="button"
              className="realtime-reset-btn"
              onClick={handleReset}
              disabled={!hasOverrideOnSelected}
              title={
                hasOverrideOnSelected
                  ? "Reset this split to projected values"
                  : "No overrides to reset"
              }
            >
              <i className="fas fa-rotate-left" /> Reset split
            </button>
          </div>
        </section>

        {/* ── Queue ── */}
        <section className="realtime-queue">
          <div className="realtime-section-heading">
            <span>All splits</span>
            <span>{remainingCount} remaining</span>
          </div>
          {updatedRows.map((row, i) => {
            const status = rowStatus(row, i);
            const isSelected = i === selectedIndex;
            return (
              <button
                key={`${row.segIdx}-${row.splitIdx}`}
                ref={isSelected ? selectedRowRef : undefined}
                className={`realtime-queue-row realtime-queue-row--${status}`}
                onClick={() => setSelectedIndex(i)}
                type="button"
              >
                <span className="realtime-queue-index">
                  {status === "done" ? (
                    <i className="fas fa-check" />
                  ) : isSelected ? (
                    "NOW"
                  ) : (
                    `${row.segIdx + 1}.${row.splitIdx + 1}`
                  )}
                </span>
                <span className="realtime-queue-name">{row.name}</span>
                <span className="realtime-queue-time">
                  {formatIsoInTzShort(row.projectedEnd, row.timezone)}
                </span>
                <span className="realtime-queue-speed">
                  {row.projectedSpeed.toFixed(1)} {speedUnit}
                </span>
                {overrides.has(i) && (
                  <span
                    className="realtime-queue-override-dot"
                    title="Override active"
                    aria-hidden="true"
                  />
                )}
              </button>
            );
          })}
        </section>
      </div>
    </div>
  );
}

// ── WeatherMini ───────────────────────────────────────────────────────────────

function WeatherMini({
  label,
  weather,
  unitSystem,
}: {
  label: string;
  weather: SplitWeather;
  unitSystem: UnitSystem;
}) {
  return (
    <div className="realtime-weather-card">
      <div className="realtime-weather-label">
        {weatherCodeIcon(weather.weatherCode, weather.isDay)} {label}
      </div>
      <div className="realtime-weather-row">
        <span title={weatherCodeLabel(weather.weatherCode)}>
          {fmtTemp(weather.temperature, unitSystem)}
        </span>
        <span>{weatherCodeLabel(weather.weatherCode)}</span>
        <span>
          {fmtWind(weather.windSpeed, unitSystem)}{" "}
          {windDirectionLabel(weather.windDirection)}
        </span>
        {weather.precipitationProbabilityAvailable &&
          weather.precipitationProbability > 0 && (
            <span title="Precipitation probability">
              <i className="fa-solid fa-droplet" />{" "}
              {weather.precipitationProbability}%
            </span>
          )}
      </div>
    </div>
  );
}

// ── RestStopRow ───────────────────────────────────────────────────────────────

function RestStopRow({
  type,
  name,
  address,
  alt,
  etaInfo,
}: {
  type: "rest" | "intermediate";
  name: string;
  address: string;
  alt: string;
  etaInfo: EtaInfo | null;
}) {
  return (
    <div className={`realtime-stop-row realtime-stop-row--${type}`}>
      <span
        className={`realtime-stop-badge${etaInfo ? ` realtime-stop-badge--${etaInfo.status}` : ""}`}
      >
        <i className="fa-solid fa-location-dot" aria-hidden="true" />
        {type === "rest" ? " Rest Stop" : " Intermediate Stop"}
      </span>
      {(name || alt) && (
        <div className="realtime-stop-name">
          {alt ? (
            <a href={alt} target="_blank" rel="noopener noreferrer">
              {name || alt}
            </a>
          ) : (
            name
          )}
        </div>
      )}
      {address && <div className="realtime-stop-address">{address}</div>}
      {etaInfo && (
        <div
          className={`realtime-stop-hours realtime-stop-hours--${etaInfo.status}`}
        >
          <span className="realtime-stop-dot" />
          <span>{etaInfo.hoursLabel}</span>
          <span> \u2014 ETA {etaInfo.arrivalTime}</span>
          {etaInfo.nearDetail && (
            <span className="realtime-stop-near"> ({etaInfo.nearDetail})</span>
          )}
        </div>
      )}
    </div>
  );
}

