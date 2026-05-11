import type { DayHoursEntry, SegmentForm, SplitGpxProfile } from "./types";

const WEEKDAY_INDEX: Record<string, number> = {
  Monday: 0,
  Tuesday: 1,
  Wednesday: 2,
  Thursday: 3,
  Friday: 4,
  Saturday: 5,
  Sunday: 6,
};

export function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function formatTime24To12h(time24: string): string {
  const [hStr, mStr] = time24.split(":");
  let h = parseInt(hStr, 10);
  const ampm = h >= 12 ? "PM" : "AM";
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${mStr} ${ampm}`;
}

export function dayNameInTimezone(iso: string, tz: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: tz,
    weekday: "long",
  });
}

export function dayIndexInTimezone(iso: string, tz: string): number {
  return WEEKDAY_INDEX[dayNameInTimezone(iso, tz)] ?? 0;
}

export function hoursLabelForEntry(entry: DayHoursEntry): string {
  if (entry.mode === "24h") return "24 hours";
  if (entry.mode === "closed") return "Closed";
  return `${formatTime24To12h(entry.opens)} - ${formatTime24To12h(entry.closes)}`;
}

export function formatIsoInTzShort(iso: string, tz: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
    timeZoneName: "short",
  });
}

export function timezoneAbbreviationAt(iso: string, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    timeZoneName: "short",
  }).formatToParts(new Date(iso));
  return parts.find((p) => p.type === "timeZoneName")?.value ?? tz;
}

export function checkArrivalVsHoursSimple(
  arrivalIso: string,
  entry: DayHoursEntry,
  tz: string,
  margin = 30,
): "open" | "closed" | "near" | null {
  if (entry.mode === "24h") return "open";
  if (entry.mode === "closed") return "closed";

  const arrivalStr = new Date(arrivalIso).toLocaleTimeString("en-US", {
    timeZone: tz,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
  const arrMin = timeToMinutes(arrivalStr);
  const openMin = timeToMinutes(entry.opens);
  const closeMin = timeToMinutes(entry.closes);

  if (closeMin > openMin) {
    if (arrMin >= openMin && arrMin <= closeMin) {
      if (arrMin - openMin < margin || closeMin - arrMin < margin)
        return "near";
      return "open";
    }
    return "closed";
  }

  if (arrMin >= openMin || arrMin <= closeMin) {
    if (arrMin >= openMin && arrMin - openMin < margin) return "near";
    if (arrMin <= closeMin && closeMin - arrMin < margin) return "near";
    return "open";
  }
  return "closed";
}

export function checkArrivalVsHoursDetailed(
  arrivalIso: string,
  entry: DayHoursEntry,
  tz: string,
  marginOpen = 15,
  marginClose = 7,
): "open" | "closed" | "near-open" | "near-close" | null {
  if (entry.mode === "24h") return "open";
  if (entry.mode === "closed") return "closed";

  const arrivalStr = new Date(arrivalIso).toLocaleTimeString("en-US", {
    timeZone: tz,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
  const arrMin = timeToMinutes(arrivalStr);
  const openMin = timeToMinutes(entry.opens);
  const closeMin = timeToMinutes(entry.closes);

  const dOpen = Math.min(
    (arrMin - openMin + 1440) % 1440,
    (openMin - arrMin + 1440) % 1440,
  );
  const dClose = Math.min(
    (arrMin - closeMin + 1440) % 1440,
    (closeMin - arrMin + 1440) % 1440,
  );

  if (dClose <= marginClose) return "near-close";
  if (dOpen <= marginOpen) return "near-open";

  if (closeMin > openMin) {
    return arrMin >= openMin && arrMin <= closeMin ? "open" : "closed";
  }
  return arrMin >= openMin || arrMin <= closeMin ? "open" : "closed";
}

export function buildDetailedNearDetail(
  status: "near-open" | "near-close",
  arrivalIso: string,
  entry: DayHoursEntry,
  tz: string,
): string | null {
  if (entry.mode !== "hours") return null;

  const arrivalStr = new Date(arrivalIso).toLocaleTimeString("en-US", {
    timeZone: tz,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
  const arrMin = timeToMinutes(arrivalStr);
  const openMin = timeToMinutes(entry.opens);
  const closeMin = timeToMinutes(entry.closes);

  if (status === "near-open") {
    const minsAfterOpen = (arrMin - openMin + 1440) % 1440;
    const minsBeforeOpen = (openMin - arrMin + 1440) % 1440;
    if (minsAfterOpen <= minsBeforeOpen) {
      if (minsAfterOpen === 0) return "Arriving exactly at opening";
      if (minsAfterOpen === 1) return "1 min after opening";
      return `${minsAfterOpen} min after opening`;
    }
    if (minsBeforeOpen === 1) return "1 min before opening";
    return `${minsBeforeOpen} min before opening`;
  }

  const minsBeforeClose = (closeMin - arrMin + 1440) % 1440;
  const minsAfterClose = (arrMin - closeMin + 1440) % 1440;
  if (minsBeforeClose <= minsAfterClose) {
    if (minsBeforeClose === 0) return "Arriving exactly at closing";
    if (minsBeforeClose === 1) return "1 min before closing";
    return `${minsBeforeClose} min before closing`;
  }
  if (minsAfterClose === 1) return "1 min after closing";
  return `${minsAfterClose} min after closing`;
}

export function formatArrivalTimeWithTz(
  arrivalIso: string,
  tz: string,
): string {
  const arrival = new Date(arrivalIso);
  const time = arrival.toLocaleTimeString("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${time} ${timezoneAbbreviationAt(arrivalIso, tz)}`;
}

export function formatRawHours(hours: number): string {
  return `${hours.toFixed(1)}h`;
}

export function formatRawRatio(numerator: number, denominator: number): string {
  return `${formatRawHours(numerator)} / ${formatRawHours(denominator)}`;
}

export function formatRawDualRatio(
  numerator: number,
  activeDenominator: number,
  elapsedDenominator: number,
): string {
  return `${formatRawRatio(numerator, activeDenominator)} (${formatRawRatio(numerator, elapsedDenominator)})`;
}

export function formatRatioPercent(
  numerator: number,
  denominator: number,
): string {
  return denominator > 0
    ? `${((numerator / denominator) * 100).toFixed(1)}%`
    : "-";
}

export interface TimezoneSequenceItem {
  tz: string;
  abbr: string;
}

/**
 * Build ordered, adjacent-deduplicated TZ abbreviation shifts for a segment,
 * using each split's configured/effective timezone at that split end time.
 */
export function getSegmentTimezoneAbbreviationShifts(
  formSeg: SegmentForm,
  courseTz: string,
  splitEndTimes: string[],
): string[] {
  const result: string[] = [];
  let prev: string | null = null;

  formSeg.splits.forEach((split, i) => {
    const tz =
      split.differentTimezone && split.timezone ? split.timezone : courseTz;
    const endIso = splitEndTimes[i];
    if (!endIso) return;
    const abbr = timezoneAbbreviationAt(endIso, tz);
    if (abbr !== prev) {
      result.push(abbr);
      prev = abbr;
    }
  });

  return result;
}

/**
 * Build the display sequence of timezone badges for a segment header.
 * Mirrors SplitForm auto-detection logic and drops a leading course-TZ entry.
 */
export function buildSegmentTimezoneSequence(
  splits: SegmentForm["splits"],
  courseTz: string,
  gpxProfiles?: (SplitGpxProfile | null)[] | null,
  referenceIso = new Date().toISOString(),
): TimezoneSequenceItem[] {
  const courseTzAbbr = timezoneAbbreviationAt(referenceIso, courseTz);

  const result: TimezoneSequenceItem[] = [];
  let prevAbbr: string | null = null;

  splits.forEach((split, j) => {
    let tz: string;
    if (split.tzManuallySet) {
      tz =
        split.differentTimezone && split.timezone ? split.timezone : courseTz;
    } else {
      const detectedTz = gpxProfiles?.[j]?.endTimezone ?? null;
      tz = detectedTz && detectedTz !== courseTz ? detectedTz : courseTz;
    }

    const abbr = timezoneAbbreviationAt(referenceIso, tz);
    if (abbr !== prevAbbr) {
      result.push({ tz, abbr });
      prevAbbr = abbr;
    }
  });

  if (result.length > 0 && result[0].abbr === courseTzAbbr) {
    return result.slice(1);
  }

  return result;
}
