import { useState, useEffect, lazy, Suspense } from "react";
import type {
  CourseDetail,
  SegmentDetail,
  SplitDetail,
  SubSplitDetail,
  UnitSystem,
  SegmentForm,
  DayHoursEntry,
  GpxTrackPoint,
  SplitGpxProfile,
} from "../types";
import { speedLabel, distanceLabel, formatHours } from "../utils";
import CourseSummaryNarrative from "./CourseSummaryNarrative";
import type { SplitWeather } from "../calculator/weather";
import {
  fetchSplitWeather,
  weatherCodeLabel,
  weatherCodeIcon,
  windDirectionLabel,
} from "../calculator/weather";
const GpxExportModal = lazy(() => import("./GpxExportModal"));

/** Convert HH:MM to minutes since midnight. */
function timeToMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Check if a given arrival UTC ISO string falls within the open hours
 * specified by a DayHoursEntry, considering the rest stop's timezone.
 * Returns "open" | "closed" | "near" (within 30 min of open/close) | null (no data).
 */
function checkArrivalVsHours(
  arrivalIso: string,
  entry: DayHoursEntry,
  tz: string,
): "open" | "closed" | "near" | null {
  if (entry.mode === "24h") return "open";
  if (entry.mode === "closed") return "closed";

  // Get arrival time in the rest stop's timezone
  const arrival = new Date(arrivalIso);
  const arrivalStr = arrival.toLocaleTimeString("en-US", {
    timeZone: tz,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
  const arrMin = timeToMin(arrivalStr);
  const openMin = timeToMin(entry.opens);
  const closeMin = timeToMin(entry.closes);

  const MARGIN = 30;

  if (closeMin > openMin) {
    // Same-day range (e.g. 06:00-22:00)
    if (arrMin >= openMin && arrMin <= closeMin) {
      if (arrMin - openMin < MARGIN || closeMin - arrMin < MARGIN)
        return "near";
      return "open";
    }
    return "closed";
  } else {
    // Overnight range (e.g. 05:30-02:00 = open 05:30→midnight, midnight→02:00)
    if (arrMin >= openMin || arrMin <= closeMin) {
      if (arrMin >= openMin && arrMin - openMin < MARGIN) return "near";
      if (arrMin <= closeMin && closeMin - arrMin < MARGIN) return "near";
      return "open";
    }
    return "closed";
  }
}

/**
 * Get the ETA status for a split's rest stop against form open hours.
 */
function getEtaStatus(
  arrivalIso: string,
  formSegments: SegmentForm[],
  segIdx: number,
  splitIdx: number,
  courseTz: string,
): { status: "open" | "closed" | "near"; label: string } | null {
  const seg = formSegments[segIdx];
  if (!seg) return null;
  const split = seg.splits[splitIdx];
  if (!split || !split.rest_stop.enabled) return null;

  const rs = split.rest_stop;
  const tz =
    split.differentTimezone && split.timezone ? split.timezone : courseTz;

  // Get arrival day-of-week in rest stop timezone (0=Mon..6=Sun)
  const arrival = new Date(arrivalIso);
  const dayName = arrival.toLocaleDateString("en-US", {
    timeZone: tz,
    weekday: "long",
  });
  const dayMap: Record<string, number> = {
    Monday: 0,
    Tuesday: 1,
    Wednesday: 2,
    Thursday: 3,
    Friday: 4,
    Saturday: 5,
    Sunday: 6,
  };
  const dayIdx = dayMap[dayName] ?? 0;

  const entry: DayHoursEntry = rs.sameHoursEveryDay
    ? rs.allDays
    : rs.perDay[dayIdx];

  const status = checkArrivalVsHours(arrivalIso, entry, tz);
  if (!status) return null;

  const labels: Record<string, string> = {
    open: "Open at ETA",
    near: "Near open/close time",
    closed: "Closed at ETA",
  };

  return { status, label: labels[status] };
}

/** Format a HH:MM (24h) string to 12h display. */
function fmt12h(time24: string): string {
  const [hStr, mStr] = time24.split(":");
  let h = parseInt(hStr, 10);
  const ampm = h >= 12 ? "PM" : "AM";
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${mStr} ${ampm}`;
}

/** Get a human-readable hours string for the arrival day. */
function getArrivalDayHours(
  arrivalIso: string,
  formSegments: SegmentForm[],
  segIdx: number,
  splitIdx: number,
  courseTz: string,
): { dayLabel: string; hoursLabel: string } | null {
  const seg = formSegments[segIdx];
  if (!seg) return null;
  const split = seg.splits[splitIdx];
  if (!split || !split.rest_stop.enabled) return null;

  const rs = split.rest_stop;
  const tz =
    split.differentTimezone && split.timezone ? split.timezone : courseTz;

  const arrival = new Date(arrivalIso);
  const dayName = arrival.toLocaleDateString("en-US", {
    timeZone: tz,
    weekday: "long",
  });
  const dayMap: Record<string, number> = {
    Monday: 0,
    Tuesday: 1,
    Wednesday: 2,
    Thursday: 3,
    Friday: 4,
    Saturday: 5,
    Sunday: 6,
  };
  const dayIdx = dayMap[dayName] ?? 0;

  const entry: DayHoursEntry = rs.sameHoursEveryDay
    ? rs.allDays
    : rs.perDay[dayIdx];

  let hoursLabel: string;
  if (entry.mode === "24h") hoursLabel = "24 hours";
  else if (entry.mode === "closed") hoursLabel = "Closed";
  else hoursLabel = `${fmt12h(entry.opens)} – ${fmt12h(entry.closes)}`;

  return { dayLabel: dayName, hoursLabel };
}

interface ResultsViewProps {
  result: CourseDetail;
  unitSystem: UnitSystem;
  formSegments: SegmentForm[];
  courseTz: string;
  courseName?: string;
  cityLabels?: (string | null)[][];
  gpxTrack?: GpxTrackPoint[] | null;
  splitBoundariesKm?: [number, number][][] | null;
  gpxProfiles?: SplitGpxProfile[][] | null;
}

export default function ResultsView({
  result,
  unitSystem,
  formSegments,
  courseTz,
  courseName,
  cityLabels,
  gpxTrack,
  splitBoundariesKm,
  gpxProfiles,
}: ResultsViewProps) {
  const [showJson, setShowJson] = useState(false);
  const [copied, setCopied] = useState(false);
  const [narrativeExpanded, setNarrativeExpanded] = useState(false);
  const sLabel = speedLabel(unitSystem);
  const dLabel = distanceLabel(unitSystem);

  // ── Weather data fetch ──
  const [weatherData, setWeatherData] = useState<
    (SplitWeather | null)[][] | null
  >(null);

  useEffect(() => {
    if (!gpxProfiles || !result) {
      setWeatherData(null);
      return;
    }

    let cancelled = false;

    // Build a flat list of { lat, lon, endTimeIso } for all splits that have
    // GPX profile data, then unflatten the response back to [seg][split].
    const flatSplits: { lat: number; lon: number; endTimeIso: string }[] = [];
    const segLengths: number[] = [];

    for (let si = 0; si < result.segment_details.length; si++) {
      const seg = result.segment_details[si];
      segLengths.push(seg.split_details.length);
      for (let sj = 0; sj < seg.split_details.length; sj++) {
        const profile = gpxProfiles[si]?.[sj];
        if (profile) {
          flatSplits.push({
            lat: profile.endLat,
            lon: profile.endLon,
            endTimeIso: seg.split_details[sj].end_time,
          });
        } else {
          // Placeholder so indices stay aligned
          flatSplits.push({ lat: 0, lon: 0, endTimeIso: "" });
        }
      }
    }

    // Only fetch if we have real coordinates
    const hasCoords = flatSplits.some((s) => s.lat !== 0 || s.lon !== 0);
    if (!hasCoords) {
      setWeatherData(null);
      return;
    }

    fetchSplitWeather(
      flatSplits.filter((s) => s.lat !== 0 || s.lon !== 0),
    ).then((flat) => {
      if (cancelled) return;
      // Unflatten: map back using the original indices
      let fi = 0;
      const nested: (SplitWeather | null)[][] = [];
      let idx = 0;
      for (const len of segLengths) {
        const row: (SplitWeather | null)[] = [];
        for (let j = 0; j < len; j++) {
          const s = flatSplits[idx];
          if (s.lat !== 0 || s.lon !== 0) {
            row.push(flat[fi] ?? null);
            fi++;
          } else {
            row.push(null);
          }
          idx++;
        }
        nested.push(row);
      }
      setWeatherData(nested);
    });

    return () => {
      cancelled = true;
    };
  }, [result, gpxProfiles]);

  return (
    <div className="results-view">
      <div className="results-view-inner">
        {/* Narrative with collapse/expand */}
        <div className="narrative-wrapper">
          <div
            className={`narrative-section${narrativeExpanded ? " narrative-section--expanded" : ""}`}
          >
            <CourseSummaryNarrative
              result={result}
              formSegments={formSegments}
              courseTz={courseTz}
              unitSystem={unitSystem}
              courseName={courseName}
            />
          </div>
          <button
            type="button"
            className="results-expand-btn"
            onClick={() => setNarrativeExpanded((v) => !v)}
          >
            {narrativeExpanded ? "▲ Show less" : "▼ Show more"}
          </button>
        </div>

        {/* Course Summary */}
        <div className="course-summary">
          <h3>Course Summary</h3>
          <dl className="summary-grid">
            <div>
              <dt>Total Distance</dt>
              <dd>
                {result.distance.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{" "}
                {dLabel}
              </dd>
            </div>
            <div>
              <dt>Start Time</dt>
              <dd>
                {new Date(result.start_time).toLocaleString(undefined, {
                  weekday: "short",
                  month: "numeric",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                  timeZone: courseTz,
                  timeZoneName: "short",
                })}
              </dd>
            </div>
            <div>
              <dt>End Time</dt>
              <dd>
                {new Date(result.end_time).toLocaleString(undefined, {
                  weekday: "short",
                  month: "numeric",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                  timeZone: courseTz,
                  timeZoneName: "short",
                })}
              </dd>
            </div>
            <div>
              <dt>Elapsed Time</dt>
              <dd title={formatHours(result.elapsed_time_hours, "full")}>
                {formatHours(result.elapsed_time_hours)}
              </dd>
            </div>
            <div>
              <dt>Moving Time</dt>
              <dd title={formatHours(result.moving_time_hours, "full")}>
                {formatHours(result.moving_time_hours)}
              </dd>
            </div>
            <div>
              <dt>Down Time</dt>
              <dd title={formatHours(result.down_time_hours, "full")}>
                {formatHours(result.down_time_hours)}
              </dd>
            </div>
            <div>
              <dt>Sleep Time</dt>
              <dd title={formatHours(result.sleep_time_hours, "full")}>
                {formatHours(result.sleep_time_hours)}
              </dd>
            </div>
            <div>
              <dt>Adjustment Time</dt>
              <dd title={formatHours(result.adjustment_time_hours, "full")}>
                {formatHours(result.adjustment_time_hours)}
              </dd>
            </div>
          </dl>
        </div>

        {/* Segments */}
        {result.segment_details.map((seg, i) => (
          <SegmentSection
            key={i}
            segment={seg}
            index={i}
            sLabel={sLabel}
            dLabel={dLabel}
            formSegments={formSegments}
            courseTz={courseTz}
            cityLabels={cityLabels?.[i]}
            gpxTrack={gpxTrack}
            splitBoundariesKm={splitBoundariesKm}
            gpxProfiles={gpxProfiles}
            unitSystem={unitSystem}
            splitWeather={weatherData?.[i] ?? null}
          />
        ))}

        {/* Raw JSON */}
        <div className="json-section">
          <div className="json-controls">
            <button type="button" onClick={() => setShowJson(!showJson)}>
              {showJson ? "Hide" : "Show"} Raw JSON
            </button>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(JSON.stringify(result, null, 2));
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? "Copied!" : "Copy JSON"}
            </button>
          </div>
          {showJson && (
            <pre className="json-block">{JSON.stringify(result, null, 2)}</pre>
          )}
        </div>
      </div>
    </div>
  );
}

function SegmentSection({
  segment,
  index,
  sLabel,
  dLabel,
  unitSystem,
  formSegments,
  courseTz,
  cityLabels,
  gpxTrack,
  splitBoundariesKm,
  gpxProfiles,
  splitWeather,
}: {
  segment: SegmentDetail;
  index: number;
  sLabel: string;
  dLabel: string;
  unitSystem: UnitSystem;
  formSegments: SegmentForm[];
  courseTz: string;
  cityLabels?: (string | null)[];
  gpxTrack?: GpxTrackPoint[] | null;
  splitBoundariesKm?: [number, number][][] | null;
  gpxProfiles?: SplitGpxProfile[][] | null;
  splitWeather?: (SplitWeather | null)[] | null;
}) {
  const [collapsed, setCollapsed] = useState(true);
  const [showExportModal, setShowExportModal] = useState(false);

  return (
    <div className="segment-result">
      <div
        className="segment-result-header"
        onClick={() => setCollapsed(!collapsed)}
      >
        <span className="collapse-icon">{collapsed ? "▶" : "▼"}</span>
        <h3>
          {segment.name ?? `Segment ${index + 1}`} —{" "}
          {segment.distance.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}{" "}
          {dLabel}, {formatHours(segment.elapsed_time_hours)}
        </h3>
      </div>
      {!collapsed && (
        <>
          {/* Rearranged: Distance/Span/Pace · Start/End/Elapsed · Active/Moving/Down · Sleep */}
          <dl className="summary-grid segment-summary-grid">
            <div>
              <dt>Distance</dt>
              <dd>
                {segment.distance.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{" "}
                {dLabel}
              </dd>
            </div>
            <div>
              <dt>Span</dt>
              <dd>
                {segment.span[0].toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{" "}
                –{" "}
                {segment.span[1].toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{" "}
                {dLabel}
              </dd>
            </div>
            <div>
              <dt>Pace</dt>
              <dd>
                {segment.pace.toFixed(2)} {sLabel}
              </dd>
            </div>
            <div>
              <dt>Start</dt>
              <dd>
                {new Date(segment.start_time).toLocaleString(undefined, {
                  weekday: "short",
                  month: "numeric",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                  timeZone: courseTz,
                  timeZoneName: "short",
                })}
              </dd>
            </div>
            <div>
              <dt>End</dt>
              <dd>
                {new Date(segment.end_time).toLocaleString(undefined, {
                  weekday: "short",
                  month: "numeric",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                  timeZone: courseTz,
                  timeZoneName: "short",
                })}
              </dd>
            </div>
            <div>
              <dt>Elapsed</dt>
              <dd title={formatHours(segment.elapsed_time_hours, "full")}>
                {formatHours(segment.elapsed_time_hours)}
              </dd>
            </div>
            <div>
              <dt>Active</dt>
              <dd title={formatHours(segment.active_time_hours, "full")}>
                {formatHours(segment.active_time_hours)}
              </dd>
            </div>
            <div>
              <dt>Moving</dt>
              <dd title={formatHours(segment.moving_time_hours, "full")}>
                {formatHours(segment.moving_time_hours)}
              </dd>
            </div>
            <div>
              <dt>Down</dt>
              <dd title={formatHours(segment.down_time_hours, "full")}>
                {formatHours(segment.down_time_hours)}
              </dd>
            </div>
            <div>
              <dt>Sleep</dt>
              <dd title={formatHours(segment.sleep_time_hours, "full")}>
                {formatHours(segment.sleep_time_hours)}
              </dd>
            </div>
          </dl>

          <div className="detail-table-wrapper">
            <table className="detail-table">
              <thead>
                <tr>
                  <th title="Split number">#</th>
                  <th title="Split distance and span (start – end)">
                    Distance ({dLabel})
                  </th>
                  <th title="Start to end time with active duration">
                    Time Span ({sLabel})
                  </th>
                  <th title="Average pace including decay">Pace ({sLabel})</th>
                </tr>
              </thead>
              <tbody>
                {segment.split_details.map((split, j) => (
                  <SplitRow
                    key={j}
                    split={split}
                    splitNumber={j + 1}
                    dLabel={dLabel}
                    sLabel={sLabel}
                    segIdx={index}
                    splitIdx={j}
                    formSegments={formSegments}
                    courseTz={courseTz}
                    nearbyCity={cityLabels?.[j] ?? null}
                    weather={splitWeather?.[j] ?? null}
                    unitSystem={unitSystem}
                  />
                ))}
              </tbody>
            </table>
          </div>
          {gpxTrack && (
            <div className="segment-export-footer">
              <button
                type="button"
                className="segment-export-btn"
                onClick={() => setShowExportModal(true)}
              >
                Export GPX splits
              </button>
            </div>
          )}
        </>
      )}
      {gpxTrack && showExportModal && (
        <Suspense fallback={null}>
          <GpxExportModal
            open={showExportModal}
            onClose={() => setShowExportModal(false)}
            segIndex={index}
            segName={formSegments[index]?.name}
            splits={formSegments[index]?.splits ?? []}
            gpxTrack={gpxTrack}
            splitBoundariesKm={splitBoundariesKm?.[index] ?? []}
            gpxProfiles={gpxProfiles?.[index] ?? []}
            unitSystem={unitSystem}
          />
        </Suspense>
      )}
    </div>
  );
}

function SplitRow({
  split,
  splitNumber,
  dLabel,
  sLabel,
  segIdx,
  splitIdx,
  formSegments,
  courseTz,
  nearbyCity,
  weather,
  unitSystem,
}: {
  split: SplitDetail;
  splitNumber: number;
  dLabel: string;
  sLabel: string;
  segIdx: number;
  splitIdx: number;
  formSegments: SegmentForm[];
  courseTz: string;
  nearbyCity?: string | null;
  weather?: SplitWeather | null;
  unitSystem: UnitSystem;
}) {
  const [expanded, setExpanded] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const splitTimeHours = split.moving_time_hours + split.down_time_hours;

  const formSplit = formSegments[segIdx]?.splits[splitIdx];
  const splitEndTz =
    split.end_timezone ||
    (formSplit?.differentTimezone && formSplit.timezone
      ? formSplit.timezone
      : null);
  const splitStartTz = split.start_timezone || null;

  const etaInfo = split.rest_stop?.arrival_date
    ? getEtaStatus(
        split.rest_stop.arrival_date,
        formSegments,
        segIdx,
        splitIdx,
        courseTz,
      )
    : null;

  const arrivalHours = split.rest_stop?.arrival_date
    ? getArrivalDayHours(
        split.rest_stop.arrival_date,
        formSegments,
        segIdx,
        splitIdx,
        courseTz,
      )
    : null;

  const dateOpts: Intl.DateTimeFormatOptions = {
    weekday: "short",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  };

  function handleCopy(text: string, field: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1500);
    });
  }

  /** Format a date in a given timezone with short TZ name. */
  function fmtInTz(iso: string, tz: string) {
    return new Date(iso).toLocaleString(undefined, {
      ...dateOpts,
      timeZone: tz,
      timeZoneName: "short",
    });
  }

  /** Format a date compactly (no weekday, short month) in course timezone. */
  function fmtSpanDate(iso: string) {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: courseTz,
    });
  }

  const timeSpan = `${fmtSpanDate(split.start_time)}\u2009—\u2009${fmtSpanDate(split.end_time)} (${split.active_time_hours.toFixed(2)}h)`;

  return (
    <>
      <tr
        className={`split-row${etaInfo ? ` split-row-${etaInfo.status}` : ""}`}
        onClick={() => setExpanded(!expanded)}
      >
        <td className="num-col">
          <span className="collapse-icon-sm">{expanded ? "▼" : "▶"}</span>
          {splitNumber}
        </td>
        <td>
          {split.name && (
            <span className="split-name-label">{split.name} — </span>
          )}
          {split.distance.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}{" "}
          (
          {split.span[0].toLocaleString(undefined, {
            minimumFractionDigits: 1,
            maximumFractionDigits: 1,
          })}{" "}
          –{" "}
          {split.span[1].toLocaleString(undefined, {
            minimumFractionDigits: 1,
            maximumFractionDigits: 1,
          })}
          )
        </td>
        <td className="time-span-cell">
          {timeSpan}
          {weather && (
            <span
              className="weather-hint"
              title={`${weatherCodeLabel(weather.weatherCode)}, ${unitSystem === "imperial" ? Math.round((weather.temperature * 9) / 5 + 32) + "°F" : Math.round(weather.temperature) + "°C"}, Wind ${unitSystem === "imperial" ? Math.round(weather.windSpeed * 0.621371) + " mph" : Math.round(weather.windSpeed) + " km/h"} ${windDirectionLabel(weather.windDirection)}`}
            >
              {weatherCodeIcon(weather.weatherCode, weather.isDay)}{" "}
              {unitSystem === "imperial"
                ? `${Math.round((weather.temperature * 9) / 5 + 32)}°`
                : `${Math.round(weather.temperature)}°`}
            </span>
          )}
        </td>
        <td>{split.pace.toFixed(2)}</td>
      </tr>
      {expanded && (
        <tr className="split-detail-row">
          <td colSpan={5}>
            <dl className="summary-grid split-summary-grid">
              <div>
                <dt>Moving Time</dt>
                <dd title={formatHours(split.moving_time_hours, "full")}>
                  {formatHours(split.moving_time_hours)}
                </dd>
              </div>
              <div>
                <dt>Down Time</dt>
                <dd title={formatHours(split.down_time_hours, "full")}>
                  {formatHours(split.down_time_hours)}
                </dd>
              </div>
              <div>
                <dt>Split Time</dt>
                <dd title={formatHours(splitTimeHours, "full")}>
                  {formatHours(splitTimeHours)}
                </dd>
              </div>
              {split.adjustment_time_hours != null &&
                split.adjustment_time_hours !== 0 && (
                  <div>
                    <dt>Adjustment</dt>
                    <dd
                      title={formatHours(split.adjustment_time_hours, "full")}
                    >
                      {formatHours(split.adjustment_time_hours)}
                    </dd>
                  </div>
                )}
              <div>
                <dt>Speed</dt>
                <dd>
                  {split.moving_speed.toFixed(2)} {sLabel}
                </dd>
              </div>
              <div>
                <dt>Start</dt>
                <dd>
                  {fmtInTz(split.start_time, splitStartTz ?? courseTz)}
                  {splitStartTz && splitStartTz !== courseTz && (
                    <span className="split-end-tz">
                      {fmtInTz(split.start_time, courseTz)}
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt>End</dt>
                <dd>
                  {fmtInTz(split.end_time, splitEndTz ?? courseTz)}
                  {splitEndTz && splitEndTz !== courseTz && (
                    <span className="split-end-tz">
                      {fmtInTz(split.end_time, courseTz)}
                    </span>
                  )}
                </dd>
              </div>
              {nearbyCity && (
                <div>
                  <dt>Nearest City</dt>
                  <dd>{nearbyCity}</dd>
                </div>
              )}
            </dl>
            <div className="split-detail-panel">
              <div className="split-detail-left">
                <h4>Sub-Splits</h4>
                {split.sub_splits.length > 0 ? (
                  <table className="sub-split-table">
                    <thead>
                      <tr>
                        <th title="Sub-split number">#</th>
                        <th title="Sub-split distance and span (start – end)">
                          Distance ({dLabel})
                        </th>
                        <th title="Moving time">Moving</th>
                        <th title="Down time">Down</th>
                        <th title="Moving time + down time">Split</th>
                      </tr>
                    </thead>
                    <tbody>
                      {split.sub_splits.map((sub, k) => (
                        <SubSplitRow key={k} sub={sub} index={k + 1} />
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="muted">No sub-splits</p>
                )}
              </div>
              <div className="split-detail-right">
                <h4>Rest Stop</h4>
                {split.rest_stop ? (
                  <dl className="rest-stop-info">
                    <div>
                      <dt>Name</dt>
                      <dd>{split.rest_stop.name}</dd>
                    </div>
                    <div>
                      <dt>Address</dt>
                      <dd className="url-display">
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(split.rest_stop.address)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Open in Google Maps"
                        >
                          {split.rest_stop.address}
                        </a>
                        <button
                          type="button"
                          className="copy-btn"
                          onClick={() =>
                            handleCopy(split.rest_stop!.address, "address")
                          }
                          title="Copy address"
                        >
                          {copiedField === "address" ? "✓" : "📋"}
                        </button>
                      </dd>
                    </div>
                    {split.rest_stop.alt && (
                      <div>
                        <dt>URL</dt>
                        <dd className="url-display">
                          <a
                            href={split.rest_stop.alt}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={split.rest_stop.alt}
                          >
                            {split.rest_stop.alt}
                          </a>
                          <button
                            type="button"
                            className="copy-btn"
                            onClick={() =>
                              handleCopy(split.rest_stop!.alt!, "url")
                            }
                            title="Copy URL"
                          >
                            {copiedField === "url" ? "✓" : "📋"}
                          </button>
                        </dd>
                      </div>
                    )}
                    {split.rest_stop.arrival_date && (
                      <div>
                        <dt>ETA</dt>
                        <dd>
                          {etaInfo && (
                            <span
                              className={`eta-badge eta-${etaInfo.status}`}
                              title={etaInfo.label}
                            >
                              {etaInfo.status === "open" && "✓ Open"}
                              {etaInfo.status === "near" && "⚠ Near close"}
                              {etaInfo.status === "closed" && "✗ Closed"}
                            </span>
                          )}
                          {fmtInTz(
                            split.rest_stop.arrival_date,
                            splitEndTz ?? courseTz,
                          )}
                        </dd>
                      </div>
                    )}
                    {arrivalHours && (
                      <div>
                        <dt>{arrivalHours.dayLabel} Hours</dt>
                        <dd>{arrivalHours.hoursLabel}</dd>
                      </div>
                    )}
                  </dl>
                ) : (
                  <p className="muted">No rest stop</p>
                )}
              </div>
            </div>
            {weather && (
              <div className="split-weather-section">
                <h4>
                  {weatherCodeIcon(weather.weatherCode, weather.isDay)} Weather
                  at Endpoint
                </h4>
                <dl className="summary-grid weather-grid">
                  <div>
                    <dt>Conditions</dt>
                    <dd>{weatherCodeLabel(weather.weatherCode)}</dd>
                  </div>
                  <div>
                    <dt>Temperature</dt>
                    <dd>
                      {unitSystem === "imperial"
                        ? `${Math.round((weather.temperature * 9) / 5 + 32)}°F`
                        : `${Math.round(weather.temperature)}°C`}
                    </dd>
                  </div>
                  <div>
                    <dt>Feels Like</dt>
                    <dd>
                      {unitSystem === "imperial"
                        ? `${Math.round((weather.apparentTemperature * 9) / 5 + 32)}°F`
                        : `${Math.round(weather.apparentTemperature)}°C`}
                    </dd>
                  </div>
                  <div>
                    <dt>Wind</dt>
                    <dd>
                      {unitSystem === "imperial"
                        ? `${Math.round(weather.windSpeed * 0.621371)} mph`
                        : `${Math.round(weather.windSpeed)} km/h`}{" "}
                      {windDirectionLabel(weather.windDirection)}
                    </dd>
                  </div>
                  <div>
                    <dt>Gusts</dt>
                    <dd>
                      {unitSystem === "imperial"
                        ? `${Math.round(weather.windGusts * 0.621371)} mph`
                        : `${Math.round(weather.windGusts)} km/h`}
                    </dd>
                  </div>
                  <div>
                    <dt>Precip. Chance</dt>
                    <dd>{weather.precipitationProbability}%</dd>
                  </div>
                  <div>
                    <dt>Humidity</dt>
                    <dd>{weather.humidity}%</dd>
                  </div>
                  <div>
                    <dt>Cloud Cover</dt>
                    <dd>{weather.cloudCover}%</dd>
                  </div>
                </dl>
              </div>
            )}
            {formSegments[segIdx]?.splits[splitIdx]?.notes?.trim() && (
              <div className="split-notes-result">
                <h4>Notes</h4>
                <p className="split-notes-result-text">
                  {formSegments[segIdx].splits[splitIdx].notes!.trim()}
                </p>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function SubSplitRow({ sub, index }: { sub: SubSplitDetail; index: number }) {
  const subSplitTime = sub.moving_time_hours + sub.down_time_hours;
  return (
    <tr>
      <td className="num-col">{index}</td>
      <td>
        {sub.distance.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}{" "}
        (
        {sub.span[0].toLocaleString(undefined, {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        })}{" "}
        –
        {sub.span[1].toLocaleString(undefined, {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        })}
        )
      </td>
      <td title={formatHours(sub.moving_time_hours, "full")}>
        {formatHours(sub.moving_time_hours)}
      </td>
      <td title={formatHours(sub.down_time_hours, "full")}>
        {formatHours(sub.down_time_hours)}
      </td>
      <td title={formatHours(subSplitTime, "full")}>
        {formatHours(subSplitTime)}
      </td>
    </tr>
  );
}
