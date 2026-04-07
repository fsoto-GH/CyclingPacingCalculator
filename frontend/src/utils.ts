import type { UnitSystem } from "./types";

/** Convert minutes (float) to total seconds for the API. Returns undefined if blank. */
export function minutesToSeconds(minutes: string): number | undefined {
  if (minutes.trim() === "") return undefined;
  return parseFloat(minutes) * 60;
}

/** Format minutes (float) into "#h #m #s" display. */
export function minutesToHms(minutes: string): string {
  const val = parseFloat(minutes);
  if (isNaN(val) || val < 0) return "";
  const totalSeconds = Math.round(val * 60);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0 || h > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ");
}

/** Format a local datetime-local string for the datetime-local input. */
export function nowLocalDatetime(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const local = new Date(now.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
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
