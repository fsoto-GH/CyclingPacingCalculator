import { getGoogleTileSession } from "../api";

type GoogleMapType = "roadmap" | "satellite" | "terrain" | "dark";

interface CachedSession {
  tileUrlTemplate: string;
  expiry: number;
}

function cacheKey(type: GoogleMapType): string {
  return `google-tile-session-${type}`;
}

function getCached(type: GoogleMapType): string | null {
  try {
    const raw = sessionStorage.getItem(cacheKey(type));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedSession;
    // Require at least 60 seconds of remaining validity
    if (parsed.expiry * 1000 > Date.now() + 60_000)
      return parsed.tileUrlTemplate;
    sessionStorage.removeItem(cacheKey(type));
    return null;
  } catch {
    return null;
  }
}

/**
 * Returns the Google Maps tile URL template for the given map type.
 * Caches the session token in sessionStorage; re-fetches when near expiry.
 * The returned template has `{z}/{x}/{y}` placeholders for Leaflet.
 */
export async function getGoogleTileUrlTemplate(
  type: GoogleMapType,
): Promise<string> {
  const cached = getCached(type);
  if (cached) return cached;

  const { tile_url_template: tileUrlTemplate, expiry } =
    await getGoogleTileSession(type);

  try {
    const entry: CachedSession = { tileUrlTemplate, expiry };
    sessionStorage.setItem(cacheKey(type), JSON.stringify(entry));
  } catch {
    // sessionStorage may be full; continue without caching
  }

  return tileUrlTemplate;
}
