import type {
  CourseDetail,
  SplitDetail,
  SegmentForm,
  DayHoursEntry,
  UnitSystem,
} from "../types";
import { distanceLabel, formatHours } from "../utils";

// ── Open-hours helpers (mirrors ResultsView logic, self-contained) ─────────

function timeToMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function checkArrivalVsHours(
  arrivalIso: string,
  entry: DayHoursEntry,
  tz: string,
): "open" | "closed" | "near" | null {
  if (entry.mode === "24h") return "open";
  if (entry.mode === "closed") return "closed";

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
    if (arrMin >= openMin && arrMin <= closeMin) {
      if (arrMin - openMin < MARGIN || closeMin - arrMin < MARGIN)
        return "near";
      return "open";
    }
    return "closed";
  } else {
    if (arrMin >= openMin || arrMin <= closeMin) {
      if (arrMin >= openMin && arrMin - openMin < MARGIN) return "near";
      if (arrMin <= closeMin && closeMin - arrMin < MARGIN) return "near";
      return "open";
    }
    return "closed";
  }
}

function getStopStatus(
  split: SplitDetail,
  formSegments: SegmentForm[],
  segIdx: number,
  splitIdx: number,
  courseTz: string,
): "open" | "closed" | "near" | null {
  const formSplit = formSegments[segIdx]?.splits[splitIdx];
  if (!formSplit?.rest_stop.enabled) return null;

  const rs = formSplit.rest_stop;
  const tz =
    formSplit.differentTimezone && formSplit.timezone
      ? formSplit.timezone
      : courseTz;

  const arrival = new Date(split.end_time);
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
  const entry = rs.sameHoursEveryDay ? rs.allDays : rs.perDay[dayIdx];
  return checkArrivalVsHours(split.end_time, entry, tz);
}

// ── List formatting ───────────────────────────────────────────────────────

function joinList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function fmtTime(iso: string, tz: string): string {
  return new Date(iso).toLocaleString("en-US", {
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
    timeZoneName: "short",
  });
}

/** Return the short timezone abbreviation for an ISO timestamp in a given IANA tz. */
function tzAbbr(iso: string, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    timeZoneName: "short",
  }).formatToParts(new Date(iso));
  return parts.find((p) => p.type === "timeZoneName")?.value ?? tz;
}

/**
 * Collect unique timezone transitions within a segment's splits.
 * Returns pairs like [["CDT", "ET"], ...] for each transition boundary.
 */
function getSegmentTzShifts(
  formSeg: SegmentForm,
  courseTz: string,
  splitEndTimes: string[],
): string[] {
  const abbrs: string[] = [];
  let prev: string | null = null;

  formSeg.splits.forEach((split, i) => {
    const tz =
      split.differentTimezone && split.timezone ? split.timezone : courseTz;
    const endIso = splitEndTimes[i];
    if (!endIso) return;
    const abbr = tzAbbr(endIso, tz);
    if (prev !== null && abbr !== prev) {
      if (!abbrs.includes(prev)) abbrs.push(prev);
      if (!abbrs.includes(abbr)) abbrs.push(abbr);
    }
    prev = abbr;
  });

  return abbrs; // non-empty only when there was at least one transition
}

// ── Component ─────────────────────────────────────────────────────────────

interface StopInfo {
  name: string;
  status: "open" | "near" | "closed";
}

interface CourseSummaryNarrativeProps {
  result: CourseDetail;
  formSegments: SegmentForm[];
  courseTz: string;
  unitSystem: UnitSystem;
  courseName?: string;
}

export default function CourseSummaryNarrative({
  result,
  formSegments,
  courseTz,
  unitSystem,
  courseName,
}: CourseSummaryNarrativeProps) {
  const dLabel = distanceLabel(unitSystem);
  const segCount = result.segment_details.length;

  // Collect stop info per segment
  const segStops: StopInfo[][] = result.segment_details.map((seg, si) =>
    seg.split_details.flatMap((split, pi) => {
      if (!split.rest_stop?.name) return [];
      const status = getStopStatus(split, formSegments, si, pi, courseTz);
      if (!status) return [];
      return [{ name: split.rest_stop.name, status }];
    }),
  );

  const totalStops = segStops.reduce((a, s) => a + s.length, 0);

  // ── Build paragraph nodes ──────────────────────────────────────────────
  const paragraphs: React.ReactNode[] = [];

  // Opening sentence
  const totalDist = result.distance.toLocaleString(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  const startTime = fmtTime(result.start_time, courseTz);

  if (segCount === 1) {
    paragraphs.push(
      <>
        {courseName ? (
          <>
            <strong>{courseName}</strong> — a{" "}
          </>
        ) : (
          <>A </>
        )}
        <strong>
          {totalDist}-{dLabel}
        </strong>{" "}
        course starting <strong>{startTime}</strong>
        {totalStops === 0 ? " with no rest stops configured" : ""}.
      </>,
    );
  } else {
    paragraphs.push(
      <>
        {courseName ? (
          <>
            <strong>{courseName}</strong> — a{" "}
          </>
        ) : (
          <>A </>
        )}
        <strong>
          {totalDist}-{dLabel}
        </strong>{" "}
        course across <strong>{segCount} segments</strong>, starting{" "}
        <strong>{startTime}</strong>.
      </>,
    );
  }

  // Per-segment sentences
  for (let i = 0; i < result.segment_details.length; i++) {
    const seg = result.segment_details[i];
    const formSeg = formSegments[i];
    const stops = segStops[i];
    const dist = seg.distance.toLocaleString(undefined, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });

    // Timezone shift note for this segment
    const splitEndTimes = seg.split_details.map((s) => s.end_time);
    const tzShifts = formSeg
      ? getSegmentTzShifts(formSeg, courseTz, splitEndTimes)
      : [];
    const tzShiftNote: React.ReactNode =
      tzShifts.length >= 2 ? (
        <>
          {" "}
          <span className="narrative-tz">
            (crosses time zones: {tzShifts.join(" → ")})
          </span>
        </>
      ) : null;

    const openStops = stops.filter((s) => s.status === "open");
    const nearStops = stops.filter((s) => s.status === "near");
    const closedStops = stops.filter((s) => s.status === "closed");

    // Status description (inline JSX)
    let statusDesc: React.ReactNode = null;

    if (stops.length > 0) {
      if (closedStops.length === 0 && nearStops.length === 0) {
        // All clear
        const word = stops.length === 1 ? "stop" : "stops";
        statusDesc = (
          <>
            {" "}
            All {stops.length === 1 ? "" : `${stops.length} `}
            {word} {stops.length === 1 ? "is" : "are"} projected to be{" "}
            <span className="narrative-open">open</span>.
          </>
        );
      } else if (closedStops.length > 0 && nearStops.length === 0) {
        // Only closed
        const names = joinList(closedStops.map((s) => s.name));
        const verb = closedStops.length === 1 ? "is" : "are";
        statusDesc = (
          <>
            {" "}
            <span className="narrative-closed">
              {names} {verb} projected to be closed
            </span>{" "}
            at your arrival — you may want to adjust your pacing.
          </>
        );
      } else if (nearStops.length > 0 && closedStops.length === 0) {
        // Only near
        const names = joinList(nearStops.map((s) => s.name));
        const verb = nearStops.length === 1 ? "is" : "are";
        statusDesc = (
          <>
            {" "}
            <span className="narrative-near">
              {names} {verb} near open/close time
            </span>{" "}
            — worth keeping an eye on.
          </>
        );
      } else {
        // Mixed near + closed
        const nearNames = joinList(nearStops.map((s) => s.name));
        const closedNames = joinList(closedStops.map((s) => s.name));
        const nearVerb = nearStops.length === 1 ? "is" : "are";
        const closedVerb = closedStops.length === 1 ? "is" : "are";
        statusDesc = (
          <>
            {openStops.length > 0 && (
              <>
                {" "}
                {openStops.length === 1
                  ? `${openStops[0].name} looks good`
                  : `${openStops.length} stops look fine`}
                {", but "}
              </>
            )}
            {openStops.length === 0 && " "}
            <span className="narrative-near">
              {nearNames} {nearVerb} near closing
            </span>{" "}
            and{" "}
            <span className="narrative-closed">
              {closedNames} {closedVerb} projected closed
            </span>
            .
          </>
        );
      }
    }

    if (segCount === 1) {
      // Single-segment: skip "Segment 1 covers X mi" framing, only mention stops
      if (stops.length > 0) {
        const stopNames = joinList(stops.map((s) => s.name));
        paragraphs.push(
          <>
            {stops.length === 1 ? "One stop" : `${stops.length} stops`} along
            the way: <strong>{stopNames}</strong>.{statusDesc}
            {tzShiftNote}
          </>,
        );
      } else if (tzShiftNote) {
        paragraphs.push(<>{tzShiftNote}</>);
      }
    } else {
      // Multi-segment: full framing per segment
      const segLabel = seg.name ? (
        <strong>{seg.name}</strong>
      ) : (
        <>Segment {i + 1}</>
      );
      if (stops.length === 0) {
        paragraphs.push(
          <>
            {segLabel} covers{" "}
            <strong>
              {dist} {dLabel}
            </strong>{" "}
            with no rest stops.{tzShiftNote}
          </>,
        );
      } else {
        const stopNames = joinList(stops.map((s) => s.name));
        const word = stops.length === 1 ? "stop" : "stops";
        paragraphs.push(
          <>
            {segLabel} covers{" "}
            <strong>
              {dist} {dLabel}
            </strong>{" "}
            with {stops.length} {word} — <strong>{stopNames}</strong>.
            {statusDesc}
            {tzShiftNote}
          </>,
        );
      }
    }

    // Sleep bridge to next segment
    if (i < result.segment_details.length - 1) {
      const sleepHours = seg.sleep_time_hours;
      const nextSeg = result.segment_details[i + 1];
      const nextStart = fmtTime(nextSeg.start_time, courseTz);
      const nextName = nextSeg.name ? (
        <strong>{nextSeg.name}</strong>
      ) : (
        <>Segment {i + 2}</>
      );
      paragraphs.push(
        <>
          After{" "}
          <strong title={formatHours(sleepHours, "full")}>
            {formatHours(sleepHours)} of rest
          </strong>
          , {nextName} begins <strong>{nextStart}</strong>.
        </>,
      );
    }
  }

  // Closing sentence
  const endTime = fmtTime(result.end_time, courseTz);
  const elapsed = formatHours(result.elapsed_time_hours);
  paragraphs.push(
    <>
      Expected finish: <strong>{endTime}</strong> —{" "}
      <span className="narrative-elapsed">{elapsed}</span> total elapsed.
    </>,
  );

  return (
    <div className="narrative">
      {paragraphs.map((p, i) => (
        <p key={i} className="narrative-p">
          {p}
        </p>
      ))}
    </div>
  );
}
