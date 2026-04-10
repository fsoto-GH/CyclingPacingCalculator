/**
 * Nominatim reverse-geocoding utility.
 *
 * Nominatim terms of service:
 *   - Max 1 request/second per IP (enforced by the caller queue in CourseForm)
 *   - Must send a descriptive User-Agent header
 *   - https://operations.osmfoundation.org/policies/nominatim/
 */

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse";
const USER_AGENT = "CyclingPacingCalculator/1.0";

// ── Persistent geocode cache ──────────────────────────────────────────────────
// Entries are written to localStorage (prefix "geo:") with a timestamp so they
// can expire and be evicted.  On module load the valid entries are read back
// into the in-memory Map, so getCachedGeocode() stays synchronous/zero-cost.
//
// Limits:
//   TTL_MS      — entries older than 30 days are treated as missing
//   MAX_ENTRIES — if the store exceeds this after a write, the oldest entries
//                 are trimmed until it is back at MAX_ENTRIES
const LS_PREFIX = "geo:";
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_ENTRIES = 500;

interface StoredEntry {
  label: string;
  ts: number;
}

// Module-level cache: "lat4,lon4" → "City, State"
// Keyed at 4 decimal places (~11 m precision) — more than enough for city lookup.
const cache = new Map<string, string>();

// Seed in-memory cache from localStorage on module load, evicting stale entries.
(function seedGeocodeCache() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k?.startsWith(LS_PREFIX)) continue;
      try {
        const raw = localStorage.getItem(k)!;
        const entry = JSON.parse(raw) as StoredEntry;
        if (Date.now() - entry.ts > TTL_MS) {
          localStorage.removeItem(k);
        } else {
          cache.set(k.slice(LS_PREFIX.length), entry.label);
        }
      } catch {
        localStorage.removeItem(k!);
      }
    }
  } catch {
    // localStorage unavailable — operate cache-free
  }
})();

function lsPersist(key: string, label: string): void {
  try {
    const entry: StoredEntry = { label, ts: Date.now() };
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(entry));

    // Evict oldest entries if over the cap.
    if (cache.size > MAX_ENTRIES) {
      const items: { key: string; ts: number }[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k?.startsWith(LS_PREFIX)) continue;
        try {
          const raw = localStorage.getItem(k)!;
          const e = JSON.parse(raw) as StoredEntry;
          items.push({ key: k, ts: e.ts });
        } catch {
          localStorage.removeItem(k!);
        }
      }
      items.sort((a, b) => a.ts - b.ts);
      const excess = items.length - MAX_ENTRIES;
      for (let i = 0; i < excess; i++) {
        const full = items[i].key;
        localStorage.removeItem(full);
        cache.delete(full.slice(LS_PREFIX.length));
      }
    }
  } catch {
    // localStorage full or unavailable — in-memory cache still works
  }
}

function cacheKey(lat: number, lon: number): string {
  return `${lat.toFixed(4)},${lon.toFixed(4)}`;
}

interface NominatimResponse {
  address?: {
    house_number?: string;
    road?: string;
    city?: string;
    town?: string;
    village?: string;
    hamlet?: string;
    county?: string;
    state?: string;
  };
  error?: string;
}

/**
 * Reverse-geocode a coordinate to the nearest city/town/village name.
 * Returns a formatted string like "Milwaukee, Wisconsin" or null on failure.
 * Results are cached in localStorage (30-day TTL, 500-entry cap) and seeded
 * into an in-memory Map on module load, so repeated calls with the same
 * coordinates (within ~11 m) return instantly without a network request.
 */
export async function reverseGeocode(
  lat: number,
  lon: number,
  signal?: AbortSignal,
): Promise<string | null> {
  const key = cacheKey(lat, lon);
  if (cache.has(key)) return cache.get(key)!;

  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("format", "json");
  url.searchParams.set("lat", lat.toFixed(6));
  url.searchParams.set("lon", lon.toFixed(6));
  url.searchParams.set("zoom", "10"); // city-level granularity
  url.searchParams.set("accept-language", "en");

  let data: NominatimResponse;
  try {
    const resp = await fetch(url.toString(), {
      method: "GET",
      headers: { "User-Agent": USER_AGENT },
      signal,
    });
    if (!resp.ok) return null;
    data = (await resp.json()) as NominatimResponse;
  } catch {
    return null;
  }

  if (data.error || !data.address) return null;

  const addr = data.address;
  const place =
    addr.city ?? addr.town ?? addr.village ?? addr.hamlet ?? addr.county;
  if (!place) return null;

  const label = addr.state ? `${place}, ${addr.state}` : place;

  cache.set(key, label);
  lsPersist(key, label);
  return label;
}

/**
 * Return the cached label for a coordinate, or undefined if not cached.
 * Keyed at the same 4dp precision as reverseGeocode.
 */
export function getCachedGeocode(lat: number, lon: number): string | undefined {
  return cache.get(cacheKey(lat, lon));
}

/** Clear the in-memory cache and all persisted localStorage entries. */
export function clearGeocodeCache(): void {
  cache.clear();
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(LS_PREFIX)) toRemove.push(k);
    }
    toRemove.forEach((k) => localStorage.removeItem(k));
  } catch {
    // localStorage unavailable
  }
}

// Separate cache for street-level address lookups (zoom=18)
const addressCache = new Map<string, string>();

/**
 * Reverse-geocode a coordinate to a full street address.
 * Returns a formatted string like "123 Main St, Milwaukee, Wisconsin" or null on failure.
 * Uses zoom=18 for street-level granularity. Results are cached by coordinate.
 */
export async function reverseGeocodeAddress(
  lat: number,
  lon: number,
  signal?: AbortSignal,
): Promise<string | null> {
  const key = cacheKey(lat, lon);
  if (addressCache.has(key)) return addressCache.get(key)!;

  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("format", "json");
  url.searchParams.set("lat", lat.toFixed(6));
  url.searchParams.set("lon", lon.toFixed(6));
  url.searchParams.set("zoom", "18"); // street-level granularity
  url.searchParams.set("accept-language", "en");
  url.searchParams.set("addressdetails", "1");

  let data: NominatimResponse;
  try {
    const resp = await fetch(url.toString(), {
      method: "GET",
      headers: { "User-Agent": USER_AGENT },
      signal,
    });
    if (!resp.ok) return null;
    data = (await resp.json()) as NominatimResponse;
  } catch {
    return null;
  }

  if (data.error || !data.address) return null;

  const addr = data.address;
  const street = [addr.house_number, addr.road].filter(Boolean).join(" ");
  const locality =
    addr.city ?? addr.town ?? addr.village ?? addr.hamlet ?? addr.county ?? "";
  const parts = [street, locality, addr.state].filter(Boolean);
  if (parts.length === 0) return null;

  const label = parts.join(", ");
  addressCache.set(key, label);
  return label;
}
