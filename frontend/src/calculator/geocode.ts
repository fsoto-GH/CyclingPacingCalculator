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

// Module-level cache: "lat4,lon4" → "City, State"
// Keyed at 4 decimal places (~11 m precision) — more than enough for city lookup.
const cache = new Map<string, string>();

function cacheKey(lat: number, lon: number): string {
  return `${lat.toFixed(4)},${lon.toFixed(4)}`;
}

interface NominatimResponse {
  address?: {
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
 * Results are cached for the session — repeated calls with the same
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
  return label;
}

/**
 * Return the cached label for a coordinate, or undefined if not cached.
 * Keyed at the same 4dp precision as reverseGeocode.
 */
export function getCachedGeocode(lat: number, lon: number): string | undefined {
  return cache.get(cacheKey(lat, lon));
}

/** Clear the in-memory cache (e.g. for testing). */
export function clearGeocodeCache(): void {
  cache.clear();
}
