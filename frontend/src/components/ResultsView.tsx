import { useState } from "react";
import type {
  CourseDetail,
  SegmentDetail,
  SplitDetail,
  SubSplitDetail,
  UnitSystem,
  SegmentForm,
  DayHoursEntry,
} from "../types";
import { speedLabel, distanceLabel, formatHours } from "../utils";

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

/** Compact time cell with full-precision hover tooltip. */
function TimeCell({ hours }: { hours: number | null | undefined }) {
  return (
    <td title={formatHours(hours, "full")}>{formatHours(hours, "compact")}</td>
  );
}

interface ResultsViewProps {
  result: CourseDetail;
  unitSystem: UnitSystem;
  formSegments: SegmentForm[];
  courseTz: string;
}

export default function ResultsView({
  result,
  unitSystem,
  formSegments,
  courseTz,
}: ResultsViewProps) {
  const [showJson, setShowJson] = useState(false);
  const sLabel = speedLabel(unitSystem);
  const dLabel = distanceLabel(unitSystem);

  return (
    <div className="results-view">
      <h2>Results</h2>

      {/* Course Summary */}
      <div className="course-summary">
        <h3>Course Summary</h3>
        <dl className="summary-grid">
          <div>
            <dt>Total Distance</dt>
            <dd>
              {result.distance.toFixed(2)} {dLabel}
            </dd>
          </div>
          <div>
            <dt>Start Time</dt>
            <dd>{new Date(result.start_time).toLocaleString()}</dd>
          </div>
          <div>
            <dt>End Time</dt>
            <dd>{new Date(result.end_time).toLocaleString()}</dd>
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
        />
      ))}

      {/* Raw JSON */}
      <div className="json-section">
        <button type="button" onClick={() => setShowJson(!showJson)}>
          {showJson ? "Hide" : "Show"} Raw JSON
        </button>
        {showJson && (
          <pre className="json-block">{JSON.stringify(result, null, 2)}</pre>
        )}
      </div>
    </div>
  );
}

function SegmentSection({
  segment,
  index,
  sLabel,
  dLabel,
  formSegments,
  courseTz,
}: {
  segment: SegmentDetail;
  index: number;
  sLabel: string;
  dLabel: string;
  formSegments: SegmentForm[];
  courseTz: string;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="segment-result">
      <div
        className="segment-result-header"
        onClick={() => setCollapsed(!collapsed)}
      >
        <span className="collapse-icon">{collapsed ? "▶" : "▼"}</span>
        <h3>
          {segment.name ?? `Segment ${index + 1}`} —{" "}
          {segment.distance.toFixed(2)} {dLabel},{" "}
          {formatHours(segment.elapsed_time_hours)}
        </h3>
      </div>
      {!collapsed && (
        <>
          {/* Rearranged: Distance/Span/Pace · Start/End/Elapsed · Active/Moving/Down · Sleep */}
          <dl className="summary-grid segment-summary-grid">
            <div>
              <dt>Distance</dt>
              <dd>
                {segment.distance.toFixed(2)} {dLabel}
              </dd>
            </div>
            <div>
              <dt>Span</dt>
              <dd>
                {segment.span[0].toFixed(2)} – {segment.span[1].toFixed(2)}{" "}
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
              <dd>{new Date(segment.start_time).toLocaleString()}</dd>
            </div>
            <div>
              <dt>End</dt>
              <dd>{new Date(segment.end_time).toLocaleString()}</dd>
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

          <table className="detail-table">
            <thead>
              <tr>
                <th title="Split distance and span (start – end)">
                  Distance ({dLabel})
                </th>
                <th title="Moving speed for this split">Speed ({sLabel})</th>
                <th title="Average pace including decay">Pace ({sLabel})</th>
                <th title="Split time + adjustment time">Active Time</th>
              </tr>
            </thead>
            <tbody>
              {segment.split_details.map((split, j) => (
                <SplitRow
                  key={j}
                  split={split}
                  dLabel={dLabel}
                  segIdx={index}
                  splitIdx={j}
                  formSegments={formSegments}
                  courseTz={courseTz}
                />
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function SplitRow({
  split,
  dLabel,
  segIdx,
  splitIdx,
  formSegments,
  courseTz,
}: {
  split: SplitDetail;
  dLabel: string;
  segIdx: number;
  splitIdx: number;
  formSegments: SegmentForm[];
  courseTz: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const splitTimeHours = split.moving_time_hours + split.down_time_hours;

  const formSplit = formSegments[segIdx]?.splits[splitIdx];
  const splitTz =
    formSplit?.differentTimezone && formSplit.timezone
      ? formSplit.timezone
      : null;

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

  return (
    <>
      <tr
        className={`split-row${etaInfo ? ` split-row-${etaInfo.status}` : ""}`}
        onClick={() => setExpanded(!expanded)}
      >
        <td>
          <span className="collapse-icon-sm">{expanded ? "▼" : "▶"}</span>
          {split.distance.toFixed(2)} ({split.span[0].toFixed(1)} –{" "}
          {split.span[1].toFixed(1)})
        </td>
        <td>{split.moving_speed.toFixed(2)}</td>
        <td>{split.pace.toFixed(2)}</td>
        <TimeCell hours={split.active_time_hours} />
      </tr>
      {expanded && (
        <tr className="split-detail-row">
          <td colSpan={4}>
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
                <dt>Start</dt>
                <dd>
                  {splitTz
                    ? fmtInTz(split.start_time, courseTz)
                    : new Date(split.start_time).toLocaleString(
                        undefined,
                        dateOpts,
                      )}
                </dd>
              </div>
              <div>
                <dt>End</dt>
                <dd>
                  {splitTz
                    ? fmtInTz(split.end_time, courseTz)
                    : new Date(split.end_time).toLocaleString(
                        undefined,
                        dateOpts,
                      )}
                </dd>
              </div>
              {splitTz && (
                <div>
                  <dt>End ({splitTz.split("/").pop()?.replace(/_/g, " ")})</dt>
                  <dd>{fmtInTz(split.end_time, splitTz)}</dd>
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
                        <th title="Sub-split distance">Distance ({dLabel})</th>
                        <th title="Start – end position along the course">
                          Span
                        </th>
                        <th title="Moving time + down time">Split Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {split.sub_splits.map((sub, k) => (
                        <SubSplitRow key={k} sub={sub} />
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
                          {splitTz
                            ? fmtInTz(split.rest_stop.arrival_date, splitTz)
                            : new Date(
                                split.rest_stop.arrival_date,
                              ).toLocaleString(undefined, dateOpts)}
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
          </td>
        </tr>
      )}
    </>
  );
}

function SubSplitRow({ sub }: { sub: SubSplitDetail }) {
  const subSplitTime = sub.moving_time_hours + sub.down_time_hours;
  return (
    <tr>
      <td>{sub.distance.toFixed(2)}</td>
      <td>
        {sub.span[0].toFixed(2)} – {sub.span[1].toFixed(2)}
      </td>
      <td title={formatHours(subSplitTime, "full")}>
        {formatHours(subSplitTime)}
      </td>
    </tr>
  );
}
