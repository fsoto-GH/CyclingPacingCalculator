import type { UnitSystem } from "./types";

/** Deterministic per-segment accent colours; cycles if more segments than entries. */
export const SEGMENT_COLORS = [
  "#4361ee", // indigo
  "#f72585", // hot pink
  "#4cc9f0", // sky
  "#06d6a0", // mint
  "#fb8500", // orange
  "#7209b7", // violet
  "#ef233c", // red
  "#80b918", // lime
] as const;

/** Convert minutes (float) to total seconds for the API. Returns undefined if blank. */
export function minutesToSeconds(minutes: string): number | undefined {
  if (minutes.trim() === "") return undefined;
  return parseFloat(minutes) * 60;
}

/** Format minutes (float) into "#h #m #s" display. */
export function minutesToHms(minutes: string): string {
  const val = parseFloat(minutes);
  if (isNaN(val)) return "";
  const sign = val < 0 ? "-" : "";
  const totalSeconds = Math.round(Math.abs(val) * 60);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0 || h > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return sign + parts.join(" ");
}

/** Format a local datetime-local string for the datetime-local input. */
export function nowLocalDatetime(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const local = new Date(now.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
}

/**
 * Convert a datetime-local string ("YYYY-MM-DDTHH:MM") treated as wall-clock
 * time in `tz` to a UTC ISO 8601 string.
 *
 * The browser's `new Date("YYYY-MM-DDTHH:MM")` interprets the value as the
 * browser's *local* timezone. This function instead treats it as belonging to
 * the IANA timezone supplied, so "06:00 America/Los_Angeles" always becomes
 * 13:00 UTC regardless of where the browser is running.
 */
export function tzLocalStringToUtcIso(localStr: string, tz: string): string {
  // Normalise to full ISO (add seconds so sv-SE formatter round-trips cleanly).
  const isoStr = localStr.length === 16 ? localStr + ":00" : localStr;

  // Step 1 — treat the naive datetime as if it were UTC.
  const asUtc = new Date(isoStr + "Z");

  // Step 2 — find what the target TZ reads for that UTC instant.
  // sv-SE gives "YYYY-MM-DD HH:MM:SS" which is easy to re-parse.
  const inTzStr = asUtc.toLocaleString("sv-SE", { timeZone: tz });

  // Step 3 — re-parse that string as UTC to measure the TZ offset.
  const inTzAsUtc = new Date(inTzStr.replace(" ", "T") + "Z");

  // Step 4 — the offset is the amount we need to add to the naive-UTC value.
  // Positive for west-of-UTC zones (e.g. Americas).
  const offsetMs = asUtc.getTime() - inTzAsUtc.getTime();

  // Step 5 — shift the naive-UTC instant by the offset to get real UTC.
  return new Date(asUtc.getTime() + offsetMs).toISOString();
}

/**
 * Return a short display string for a datetime-local value interpreted in `tz`.
 * e.g. "6:00 AM PDT" — used as a hint when the course timezone differs from
 * the browser timezone.
 */
export function formatStartTimeHint(
  localStr: string,
  tz: string,
): string | null {
  if (!localStr) return null;
  try {
    const [datePart, timePart] = localStr.split("T");
    if (!datePart || !timePart) return null;
    const [y, m, d] = datePart.split("-").map(Number);
    const [h, min] = timePart.split(":").map(Number);
    // Build a Date.UTC value with the raw fields to query TZ abbreviation at
    // this calendar date without browser-tz distortion.
    const ref = new Date(Date.UTC(y, m - 1, d, h, min));
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "short",
    }).formatToParts(ref);
    const tzAbbr = parts.find((p) => p.type === "timeZoneName")?.value ?? tz;
    // Format the time fields ourselves (h/min come straight from the input).
    const hour12 = h % 12 || 12;
    const ampm = h < 12 ? "AM" : "PM";
    const minStr = String(min).padStart(2, "0");
    return `${hour12}:${minStr} ${ampm} ${tzAbbr}`;
  } catch {
    return null;
  }
}

/** Speed unit label based on unit system. */
export function speedLabel(unit: UnitSystem): string {
  return unit === "imperial" ? "mph" : "km/h";
}

/** Distance unit label based on unit system. */
export function distanceLabel(unit: UnitSystem): string {
  return unit === "imperial" ? "mi" : "km";
}

/** Parse a float from a string, returning null if empty or invalid. */
export function parseOptionalFloat(val: string): number | null {
  if (val.trim() === "") return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

/**
 * Format decimal hours into a compact duration string.
 * - Only shows the largest significant unit: e.g. "5h 31m 30s" (not "0d 5h …")
 * - Seconds are rounded to whole numbers.
 * - `full` version keeps fractional seconds for the hover tooltip.
 */
export function formatHours(
  hours: number | null | undefined,
  mode: "compact" | "full" = "compact",
): string {
  if (hours == null || isNaN(hours)) return "—";
  const negative = hours < 0;
  const totalSec = Math.abs(hours) * 3600;
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);

  const parts: string[] = [];
  if (mode === "full") {
    const s = totalSec % 60;
    if (d > 0) parts.push(`${d}d`);
    parts.push(`${h}h`, `${m}m`, `${s.toFixed(2)}s`);
  } else {
    const s = Math.round(totalSec % 60);
    if (d > 0) parts.push(`${d}d`);
    if (d > 0 || h > 0) parts.push(`${h}h`);
    if (d > 0 || h > 0 || m > 0) parts.push(`${m}m`);
    parts.push(`${s}s`);
  }
  return (negative ? "-" : "") + parts.join(" ");
}
