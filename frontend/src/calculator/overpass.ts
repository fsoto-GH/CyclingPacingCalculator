/**
 * Overpass API (OpenStreetMap) query for nearby amenities.
 * No API key required. Uses the public overpass-api.de endpoint.
 */

import type { DayHoursEntry } from "../types";

// Define the fixed-length tuple type
type WeekHours = [
  DayHoursEntry, // Mon
  DayHoursEntry, // Tue
  DayHoursEntry, // Wed
  DayHoursEntry, // Thu
  DayHoursEntry, // Fri
  DayHoursEntry, // Sat
  DayHoursEntry, // Sun
];

export interface NearbyAmenity {
  id: number;
  name: string;
  amenity: string; // e.g. "fuel", "fast_food", "supermarket"
  distanceM: number;
  lat: number;
  lon: number;
  address: string;
  /** Parsed open hours per day (Mon=0 … Sun=6). null if not in OSM. */
  hours: WeekHours | null;
  /** Raw OSM opening_hours string, for display/debugging */
  rawHours: string | null;
}

const AMENITY_TYPES = [
  "fuel",
  "supermarket",
  "convenience",
  "pharmacy",
  "fast_food",
  "cafe",
  "restaurant",
].join("|");

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

/** Haversine distance in metres between two lat/lon pairs */
function distanceM(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── OSM opening_hours → DayHoursEntry ───────────────────────────────────────

/** Day names as they appear in OSM opening_hours strings */
const OSM_DAY_ABBR = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"] as const;
type OsmDay = (typeof OSM_DAY_ABBR)[number];
const DAY_INDEX: Record<OsmDay, number> = {
  Mo: 0,
  Tu: 1,
  We: 2,
  Th: 3,
  Fr: 4,
  Sa: 5,
  Su: 6,
};

function makeDefault(): DayHoursEntry {
  return { mode: "hours", opens: "06:00", closes: "22:00" };
}

/**
 * Very lightweight OSM opening_hours parser.
 * Handles the most common patterns seen in US/EU stores:
 *   "24/7"
 *   "Mo-Fr 08:00-20:00; Sa-Su 09:00-18:00"
 *   "Mo-Su 07:00-22:00"
 *   "off" (closed)
 *
 * Falls back to all-default entries for formats it cannot parse.
 * We intentionally avoid the full opening_hours.js lib here because it
 * requires a DOM environment + nominatim object and adds 130KB gzipped.
 * For the vast majority of stores this simple parser is sufficient.
 */
export function parseOsmHours(raw: string): WeekHours | null {
  if (!raw) return null;

  const result: WeekHours = [
    makeDefault(),
    makeDefault(),
    makeDefault(),
    makeDefault(),
    makeDefault(),
    makeDefault(),
    makeDefault(),
  ];

  const trimmed = raw.trim();

  // 24/7
  if (trimmed === "24/7") {
    return result.map(() => ({
      mode: "24h" as const,
      opens: "00:00",
      closes: "00:00",
    })) as WeekHours;
  }

  // Split on ";", parse each rule
  const rules = trimmed
    .split(";")
    .map((r) => r.trim())
    .filter(Boolean);
  let anyParsed = false;

  for (const rule of rules) {
    // Match: [DaySpec] HH:MM-HH:MM  or  [DaySpec] off
    const match = rule.match(
      /^([A-Za-z,\-\s]+?)?\s*(off|\d{1,2}:\d{2}-\d{1,2}:\d{2})$/i,
    );
    if (!match) continue;

    const daySpec = match[1]?.trim() ?? "";
    const timeSpec = match[2].toLowerCase();

    // Resolve which day indices this rule applies to
    let dayIndices: number[] = [];

    if (!daySpec) {
      // No day spec → applies to all days
      dayIndices = [0, 1, 2, 3, 4, 5, 6];
    } else {
      // Parse comma-separated groups like "Mo-Fr,Sa" or "Mo-Su"
      for (const group of daySpec.split(",")) {
        const g = group.trim();
        const rangeMatch = g.match(/^([A-Z][a-z])-([A-Z][a-z])$/);
        if (rangeMatch) {
          const from = DAY_INDEX[rangeMatch[1] as OsmDay] ?? -1;
          const to = DAY_INDEX[rangeMatch[2] as OsmDay] ?? -1;
          if (from >= 0 && to >= 0) {
            for (let d = from; d <= to; d++) dayIndices.push(d);
          }
        } else {
          const single = DAY_INDEX[g as OsmDay];
          if (single !== undefined) dayIndices.push(single);
        }
      }
    }

    // Parse the time spec
    let entry: DayHoursEntry;
    if (timeSpec === "off") {
      entry = { mode: "closed", opens: "00:00", closes: "00:00" };
    } else {
      const [opens, closes] = timeSpec.split("-").map((t) => {
        const [h, m] = t.split(":").map(Number);
        return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      });
      entry = { mode: "hours", opens, closes };
    }

    for (const d of dayIndices) {
      result[d] = entry;
      anyParsed = true;
    }
  }

  return anyParsed ? result : null;
}

// ── Overpass query ───────────────────────────────────────────────────────────

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements: OverpassElement[];
}

/**
 * Query Overpass API for nearby amenities.
 * @param lat      - Latitude of split endpoint
 * @param lon      - Longitude of split endpoint
 * @param radiusM  - Search radius in metres (default 1000)
 * @param signal   - AbortSignal for cancellation
 */
export async function queryNearbyAmenities(
  lat: number,
  lon: number,
  radiusM = 1610,
  signal?: AbortSignal,
): Promise<NearbyAmenity[]> {
  // Nodes only (no way) + maxsize cap to keep queries light.
  const query = `
[out:json][timeout:10][maxsize:1048576];
node(around:${radiusM},${lat},${lon})[amenity~"${AMENITY_TYPES}"][name];
out;
`.trim();

  const body = `data=${encodeURIComponent(query)}`;

  let lastError: unknown;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal,
      });
      if (!resp.ok) throw new Error(`Overpass error: ${resp.status}`);
      const data: OverpassResponse = await resp.json();

      const results: NearbyAmenity[] = data.elements
        .filter((el) => el.tags?.name)
        .map((el) => {
          const elLat = el.lat ?? el.center?.lat ?? lat;
          const elLon = el.lon ?? el.center?.lon ?? lon;
          const tags = el.tags ?? {};
          const rawHours = tags["opening_hours"] ?? null;
          const hours = rawHours ? parseOsmHours(rawHours) : null;

          // Build a best-effort address from OSM addr:* tags
          const addrParts: string[] = [];
          if (tags["addr:housenumber"] && tags["addr:street"]) {
            addrParts.push(
              `${tags["addr:housenumber"]} ${tags["addr:street"]}`,
            );
          } else if (tags["addr:street"]) {
            addrParts.push(tags["addr:street"]);
          }
          if (tags["addr:city"]) addrParts.push(tags["addr:city"]);
          if (tags["addr:state"]) addrParts.push(tags["addr:state"]);

          return {
            id: el.id,
            name: tags.name ?? "",
            amenity: tags.amenity ?? "",
            distanceM: Math.round(distanceM(lat, lon, elLat, elLon)),
            lat: elLat,
            lon: elLon,
            address: addrParts.join(", "),
            hours,
            rawHours,
          };
        });

      // Sort by distance ascending
      results.sort((a, b) => a.distanceM - b.distanceM);

      return results;
    } catch (err: unknown) {
      if ((err as { name?: string }).name === "AbortError") throw err;
      lastError = err;
      // Try next mirror
    }
  }

  throw lastError ?? new Error("All Overpass endpoints failed");
}
