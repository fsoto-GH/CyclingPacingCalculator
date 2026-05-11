export interface SplitWeather {
  /** Temperature in °C */
  temperature: number;
  /** Feels-like temperature in °C */
  apparentTemperature: number;
  /** Precipitation probability (0-100 %). */
  precipitationProbability: number;
  /** Whether precipitationProbability came from the API (true) or was synthesized (false). */
  precipitationProbabilityAvailable: boolean;
  /** Total precipitation in mm */
  precipitation: number;
  /** Rain component of precipitation in mm */
  rain: number;
  /** WMO weather code */
  weatherCode: number;
  /** Wind speed in km/h */
  windSpeed: number;
  /** Wind direction in degrees */
  windDirection: number;
  /** Wind gusts in km/h */
  windGusts: number;
  /** Relative humidity (0-100 %) */
  humidity: number;
  /** Cloud cover (0-100 %) */
  cloudCover: number;
  /** Whether it is daytime */
  isDay: boolean;
  /** The ISO 15-minute slot the forecast corresponds to */
  forecastHour: string;
}

/** Human-readable label for a WMO weather code. */
export function weatherCodeLabel(code: number): string {
  const labels: Record<number, string> = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    56: "Light freezing drizzle",
    57: "Dense freezing drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    66: "Light freezing rain",
    67: "Heavy freezing rain",
    71: "Slight snow",
    73: "Moderate snow",
    75: "Heavy snow",
    77: "Snow grains",
    80: "Slight rain showers",
    81: "Moderate rain showers",
    82: "Violent rain showers",
    85: "Slight snow showers",
    86: "Heavy snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm w/ slight hail",
    99: "Thunderstorm w/ heavy hail",
  };
  return labels[code] ?? `Code ${code}`;
}

/** Emoji for a WMO weather code. */
export function weatherCodeIcon(code: number, isDay: boolean): string {
  if (code === 0) return isDay ? "☀️" : "🌙";
  if (code <= 3) return isDay ? "⛅" : "☁️";
  if (code <= 48) return "🌫️";
  if (code <= 57) return "🌦️";
  if (code <= 65) return "🌧️";
  if (code <= 67) return "🥶";
  if (code <= 77) return "🌨️";
  if (code <= 82) return "🌧️";
  if (code <= 86) return "🌨️";
  return "⛈️";
}

/** Compass label for a wind direction in degrees. */
export function windDirectionLabel(deg: number): string {
  const dirs = [
    "N",
    "NNE",
    "NE",
    "ENE",
    "E",
    "ESE",
    "SE",
    "SSE",
    "S",
    "SSW",
    "SW",
    "WSW",
    "W",
    "WNW",
    "NW",
    "NNW",
  ];
  return dirs[Math.round(deg / 22.5) % 16];
}

/**
 * Fetch 15-minute weather from the Open-Meteo API for split endpoints.
 *
 * Routes each point to the correct API based on time:
 *   - Past dates    → historical-forecast-api.open-meteo.com/v1/forecast
 *   - Future dates  → api.open-meteo.com/v1/forecast (16-day window)
 *   - Beyond 16 days in the future → null (no data available)
 *
 * Both APIs use the same request shape:
 *   minutely_15: temperature, apparent_temperature, precipitation, rain,
 *                weather_code, wind fields
 *   hourly: precipitation_probability, cloud_cover, is_day, relative_humidity_2m
 *
 * Locations are deduplicated by rounding to 0.01° (~1 km), up to 50 per batch.
 */

// ── Open-Meteo response shapes ──

// ── Sunrise / sunset ──

export interface SunriseSunsetEntry {
  type: "sunrise" | "sunset";
  /** UTC milliseconds for this event. */
  ms: number;
}

interface DailyData {
  time: string[];
  sunrise: string[];
  sunset: string[];
}

interface Minutely15Data {
  time: string[];
  temperature_2m: number[];
  apparent_temperature: number[];
  precipitation: number[];
  rain: number[];
  weather_code: number[];
  wind_speed_10m: number[];
  wind_direction_10m: number[];
  wind_gusts_10m: number[];
}

interface HourlyData {
  time: string[];
  precipitation_probability: number[];
  cloud_cover: number[];
  is_day: number[];
  relative_humidity_2m: number[];
}

interface WeatherCacheEntry {
  minutely15: Minutely15Data;
  hourly: HourlyData;
  daily?: DailyData;
}

interface OpenMeteoResponse {
  minutely_15: Minutely15Data;
  hourly: HourlyData;
  daily?: DailyData;
}

// ── Shared helpers ──

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

const _MINUTELY_15_FIELDS =
  "temperature_2m,apparent_temperature,precipitation,rain," +
  "weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m";

const _HOURLY_FIELDS =
  "precipitation_probability,cloud_cover,is_day,relative_humidity_2m";

/** Map one minutely_15 + hourly slot pair to a SplitWeather value. */
function mapWeatherSlot(
  m: Minutely15Data,
  mi: number,
  h: HourlyData,
  hi: number,
): SplitWeather {
  return {
    temperature: m.temperature_2m[mi],
    apparentTemperature: m.apparent_temperature[mi],
    precipitation: m.precipitation[mi],
    rain: m.rain[mi],
    weatherCode: m.weather_code[mi],
    windSpeed: m.wind_speed_10m[mi],
    windDirection: m.wind_direction_10m[mi],
    windGusts: m.wind_gusts_10m[mi],
    precipitationProbability: h.precipitation_probability[hi] ?? 0,
    precipitationProbabilityAvailable: true,
    cloudCover: h.cloud_cover[hi] ?? 0,
    isDay: (h.is_day[hi] ?? 1) === 1,
    humidity: h.relative_humidity_2m[hi] ?? 0,
    // Append "Z" so the string is unambiguously UTC when parsed by the UI.
    forecastHour: m.time[mi].endsWith("Z") ? m.time[mi] : m.time[mi] + "Z",
  };
}

/**
 * Parse an Open-Meteo time string as UTC milliseconds.
 * The API returns ISO 8601 strings without a timezone offset (e.g. "2025-07-15T07:00").
 * Without an explicit offset, JavaScript treats them as LOCAL time — appending "Z"
 * forces UTC interpretation, which is what the API actually returns.
 */
function parseApiTimeMs(t: string): number {
  return new Date(t.endsWith("Z") ? t : t + "Z").getTime();
}

/** Nearest-slot search over minutely_15 data. */
function findBestMinutely15(m: Minutely15Data, targetMs: number): number {
  let bestIdx = -1;
  let bestDiff = Infinity;
  for (let i = 0; i < m.time.length; i++) {
    const diff = Math.abs(targetMs - parseApiTimeMs(m.time[i]));
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/** Nearest-slot search over hourly supplement data. */
function findBestHourly(h: HourlyData, targetMs: number): number {
  let bestIdx = -1;
  let bestDiff = Infinity;
  for (let i = 0; i < h.time.length; i++) {
    const diff = Math.abs(targetMs - parseApiTimeMs(h.time[i]));
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    }
  }
  return bestIdx;
}

// ── Main entry point ──

const locKey = (lat: number, lon: number) =>
  `${lat.toFixed(2)},${lon.toFixed(2)}`;

/**
 * Build an Open-Meteo URL for a batch weather request.
 *
 * usePast=true  → historical-forecast-api.open-meteo.com (past dates, ECMWF reanalysis)
 * usePast=false → api.open-meteo.com (up to 16 days ahead)
 *
 * When usePaidApi is true the request is proxied through /v1/cycling/forecast
 * so API keys stay server-side.
 */
function buildOpenMeteoUrl(
  lats: string,
  lons: string,
  startDate: string,
  endDate: string,
  usePast: boolean,
  usePaidApi: boolean,
): string {
  if (usePaidApi) {
    const mode = usePast ? "historical" : "forecast";
    return (
      `/v1/cycling/forecast` +
      `?lat=${lats}&lon=${lons}&mode=${mode}` +
      `&start_date=${startDate}&end_date=${endDate}`
    );
  }
  const host = usePast
    ? "historical-forecast-api.open-meteo.com"
    : "api.open-meteo.com";
  return (
    `https://${host}/v1/forecast` +
    `?latitude=${lats}&longitude=${lons}` +
    `&minutely_15=${_MINUTELY_15_FIELDS}` +
    `&hourly=${_HOURLY_FIELDS}` +
    `&daily=sunrise,sunset` +
    `&models=best_match` +
    `&start_date=${startDate}&end_date=${endDate}` +
    `&timeformat=iso8601`
  );
}

export async function fetchSplitWeather(
  splits: { lat: number; lon: number; endTimeIso: string }[],
  usePaidApi = false,
  onBatchComplete?: (
    results: (SplitWeather | null)[],
    cache: Map<string, WeatherCacheEntry>,
  ) => void,
): Promise<{
  results: (SplitWeather | null)[];
  cache: Map<string, WeatherCacheEntry>;
}> {
  if (splits.length === 0) return { results: [], cache: new Map() };

  const now = new Date();
  const maxForecastDate = new Date(now);
  maxForecastDate.setDate(maxForecastDate.getDate() + 16);
  const BATCH = 50;

  /** Fetch with automatic retry on 429 (respects Retry-After). */
  async function fetchWithRetry(url: string): Promise<Response | null> {
    for (let attempt = 0; attempt < 3; attempt++) {
      let resp: Response;
      try {
        resp = await fetch(url);
      } catch {
        return null; // network error
      }
      if (resp.status !== 429) return resp;
      const retryAfter = parseInt(resp.headers.get("Retry-After") ?? "65", 10);
      await new Promise<void>((r) =>
        setTimeout(r, Math.min(retryAfter, 120) * 1000),
      );
    }
    return null;
  }

  // Partition into historical (past), forecast (within window), or beyond window.
  // Zero-coordinate entries are skipped (no location data — remain null).
  const historicalIdx: number[] = [];
  const forecastIdx: number[] = [];
  for (let i = 0; i < splits.length; i++) {
    const s = splits[i];
    if (s.lat === 0 && s.lon === 0) continue;
    const d = new Date(s.endTimeIso);
    if (d < now) historicalIdx.push(i);
    else if (d <= maxForecastDate) forecastIdx.push(i);
    // beyond maxForecastDate → stays null
  }

  const results: (SplitWeather | null)[] = new Array(splits.length).fill(null);
  const cache = new Map<string, WeatherCacheEntry>();

  // ── Shared batch processor ──
  async function processBatch(indices: number[], usePast: boolean) {
    if (indices.length === 0) return;

    const uniqueLocs = new Map<
      string,
      { lat: number; lon: number; minDate: Date; maxDate: Date }
    >();
    for (const i of indices) {
      const s = splits[i];
      const key = locKey(s.lat, s.lon);
      const d = new Date(s.endTimeIso);
      const existing = uniqueLocs.get(key);
      if (!existing) {
        uniqueLocs.set(key, {
          lat: parseFloat(s.lat.toFixed(2)),
          lon: parseFloat(s.lon.toFixed(2)),
          minDate: d,
          maxDate: d,
        });
      } else {
        if (d < existing.minDate) existing.minDate = d;
        if (d > existing.maxDate) existing.maxDate = d;
      }
    }
    const locEntries = [...uniqueLocs.entries()];

    for (let i = 0; i < locEntries.length; i += BATCH) {
      const batch = locEntries.slice(i, i + BATCH);
      const lats = batch.map(([, v]) => v.lat).join(",");
      const lons = batch.map(([, v]) => v.lon).join(",");
      let bMin = batch[0][1].minDate;
      let bMax = batch[0][1].maxDate;
      for (const [, v] of batch) {
        if (v.minDate < bMin) bMin = v.minDate;
        if (v.maxDate > bMax) bMax = v.maxDate;
      }
      const url = buildOpenMeteoUrl(
        lats,
        lons,
        toDateStr(bMin),
        toDateStr(bMax),
        usePast,
        usePaidApi,
      );
      const resp = await fetchWithRetry(url);
      if (resp?.ok) {
        const data = await resp.json();
        if (batch.length === 1) {
          const r = data as OpenMeteoResponse;
          if (r?.minutely_15 && r?.hourly)
            cache.set(batch[0][0], {
              minutely15: r.minutely_15,
              hourly: r.hourly,
              daily: r.daily,
            });
        } else {
          const arr = data as OpenMeteoResponse[];
          for (let j = 0; j < batch.length; j++) {
            if (arr[j]?.minutely_15 && arr[j]?.hourly)
              cache.set(batch[j][0], {
                minutely15: arr[j].minutely_15,
                hourly: arr[j].hourly,
                daily: arr[j].daily,
              });
          }
        }
      }

      // Map results for indices whose location was in this batch.
      const batchKeys = new Set(batch.map(([k]) => k));
      for (const idx of indices) {
        if (results[idx] !== null) continue; // already mapped
        const s = splits[idx];
        const key = locKey(s.lat, s.lon);
        if (!batchKeys.has(key)) continue;
        const entry = cache.get(key);
        if (!entry) continue;
        const targetMs = new Date(s.endTimeIso).getTime();
        const mi = findBestMinutely15(entry.minutely15, targetMs);
        const hi = findBestHourly(entry.hourly, targetMs);
        if (mi !== -1 && hi !== -1)
          results[idx] = mapWeatherSlot(entry.minutely15, mi, entry.hourly, hi);
      }

      onBatchComplete?.(results, cache);

      // Small courtesy delay between batches to avoid burst rate-limiting.
      if (i + BATCH < locEntries.length) {
        await new Promise<void>((r) => setTimeout(r, 500));
      }
    }
  }

  await Promise.all([
    processBatch(historicalIdx, true),
    processBatch(forecastIdx, false),
  ]);

  return { results, cache };
}

// ── Pair (start + end) weather per split ──

/**
 * Weather at both the start and end point of a split.
 * Either entry is `null` when coordinates are missing or outside the 16-day
 * forecast window.
 */
export interface SplitWeatherPair {
  start: SplitWeather | null;
  end: SplitWeather | null;
  /** Min temperature (°C) across all hourly slots within the split span. */
  tempMin?: number;
  /** Max temperature (°C) across all hourly slots within the split span. */
  tempMax?: number;
}

/**
 * Fetch start-point and end-point weather for a list of splits in one pass.
 *
 * Interleaves start and end entries into a single flat array, delegates to
 * `fetchSplitWeather` (which handles deduplication and batching), then pairs
 * the results back. Also computes the temperature range across all hourly
 * slots between each split's start and end time.
 */
export async function fetchSplitWeatherPairs(
  splits: {
    startLat: number;
    startLon: number;
    startTimeIso: string;
    endLat: number;
    endLon: number;
    endTimeIso: string;
  }[],
  usePaidApi = false,
): Promise<SplitWeatherPair[]> {
  if (splits.length === 0) return [];

  // Interleave: [start0, end0, start1, end1, …]
  const flat = splits.flatMap((s) => [
    { lat: s.startLat, lon: s.startLon, endTimeIso: s.startTimeIso },
    { lat: s.endLat, lon: s.endLon, endTimeIso: s.endTimeIso },
  ]);

  const { results, cache } = await fetchSplitWeather(flat, usePaidApi);

  return splits.map((s, i) => {
    const start = results[i * 2] ?? null;
    const end = results[i * 2 + 1] ?? null;

    let tempMin: number | undefined;
    let tempMax: number | undefined;
    if (start || end) {
      const startMs = parseApiTimeMs(s.startTimeIso);
      const endMs = parseApiTimeMs(s.endTimeIso);
      const temps: number[] = [];
      if (start) temps.push(start.temperature);
      if (end) temps.push(end.temperature);
      // Scan minutely_15 slots for both endpoint locations to capture intermediate temps.
      const seen = new Set<string>();
      for (const k of [
        locKey(s.startLat, s.startLon),
        locKey(s.endLat, s.endLon),
      ]) {
        if (seen.has(k)) continue;
        seen.add(k);
        const entry = cache.get(k);
        if (!entry) continue;
        const m = entry.minutely15;
        for (let j = 0; j < m.time.length; j++) {
          const tMs = parseApiTimeMs(m.time[j]);
          if (tMs >= startMs && tMs <= endMs) {
            temps.push(m.temperature_2m[j]);
          }
        }
      }
      if (temps.length > 0) {
        tempMin = Math.min(...temps);
        tempMax = Math.max(...temps);
      }
    }

    return { start, end, tempMin, tempMax };
  });
}

// ── Hourly course weather ─────────────────────────────────────────────────────

/**
 * Intermediate shape: hourly point without weather data yet attached.
 * @internal
 */
interface HourlyCourseCoord {
  timeIso: string;
  lat: number;
  lon: number;
  segIdx: number;
  splitIdx: number;
}

/**
 * Compute one coordinate per 15-minute wall-clock interval across the entire
 * course by linearly interpolating along the GPX track within each split.
 *
 * For a given slot `h` that falls within split [startMs, endMs]:
 *   frac  = (h − startMs) / (endMs − startMs)
 *   km    = startKm + frac × (endKm − startKm)
 *   latlon = interpolateLatLon(track, km)
 *
 * The first and last point of each split are always included (at their exact
 * boundary times) so the course has no gaps.
 */
export function computeHourlyCoursePoints(
  result: import("../types").CourseDetail,
  gpxProfiles: import("../types").SplitGpxProfile[][],
  gpxTrack: import("../types").GpxTrackPoint[],
  interpolate: (
    track: import("../types").GpxTrackPoint[],
    km: number,
  ) => { lat: number; lon: number } | null,
): HourlyCourseCoord[] {
  const points: HourlyCourseCoord[] = [];

  for (let si = 0; si < result.segment_details.length; si++) {
    const seg = result.segment_details[si];
    for (let sj = 0; sj < seg.split_details.length; sj++) {
      const split = seg.split_details[sj];
      const profile = gpxProfiles[si]?.[sj];
      if (!profile) continue;

      const startMs = new Date(split.start_time).getTime();
      const endMs = new Date(split.end_time).getTime();
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
      const durationMs = endMs - startMs;
      if (durationMs <= 0) continue;

      const { startKm, endKm } = profile;

      const getLatLon = (ms: number): { lat: number; lon: number } | null => {
        const frac = (ms - startMs) / durationMs;
        const km = startKm + frac * (endKm - startKm);
        return interpolate(gpxTrack, km);
      };

      // First 15-minute mark at or after split start
      const FIFTEEN_MIN_MS = 900_000;
      const firstSlotMs = Math.ceil(startMs / FIFTEEN_MIN_MS) * FIFTEEN_MIN_MS;

      for (let h = firstSlotMs; h <= endMs; h += FIFTEEN_MIN_MS) {
        const ll = getLatLon(h);
        if (!ll) continue;
        points.push({
          timeIso: new Date(h).toISOString(),
          lat: ll.lat,
          lon: ll.lon,
          segIdx: si,
          splitIdx: sj,
        });
      }
    }
  }

  return points;
}

/**
 * Extract all sunrise and sunset events from a weather cache, sorted by time.
 *
 * Each cached location carries a `daily` block with UTC-based sunrise/sunset
 * ISO strings (Open-Meteo returns daily times matching the per-request timezone;
 * since we use no timezone param, they are in UTC).  All locations are merged
 * and deduplicated by calendar day + event type so overlapping batch ranges
 * don't produce duplicate lines on the chart.
 */
export function extractSunriseSunset(
  cache: Map<string, WeatherCacheEntry>,
): SunriseSunsetEntry[] {
  const seen = new Set<string>(); // "sunrise-2025-07-15" etc.
  const entries: SunriseSunsetEntry[] = [];
  for (const entry of cache.values()) {
    const d = entry.daily;
    if (!d) continue;
    for (let i = 0; i < d.time.length; i++) {
      const day = d.time[i]; // "YYYY-MM-DD"
      for (const type of ["sunrise", "sunset"] as const) {
        const raw = type === "sunrise" ? d.sunrise[i] : d.sunset[i];
        if (!raw) continue;
        const key = `${type}-${day}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const ms = new Date(raw.endsWith("Z") ? raw : raw + "Z").getTime();
        if (Number.isFinite(ms)) entries.push({ type, ms });
      }
    }
  }
  entries.sort((a, b) => a.ms - b.ms);
  return entries;
}

/**
 * Fetch weather for a list of hourly course coordinate points, returning the
 * same list with `weather` attached. Points for which no weather is available
 * (outside 16-day window or missing coords) are omitted from the result.
 *
 * Pass `onProgress` to receive incremental updates after each batch completes
 * so the UI can render partial data while the remaining batches load.
 */
export async function fetchHourlyCourseWeather(
  points: HourlyCourseCoord[],
  usePaidApi = false,
  onProgress?: (
    partial: import("../types").HourlyWeatherPoint[],
    ss: SunriseSunsetEntry[],
  ) => void,
): Promise<{
  points: import("../types").HourlyWeatherPoint[];
  sunriseSunset: SunriseSunsetEntry[];
}> {
  if (points.length === 0) return { points: [], sunriseSunset: [] };

  function mapResults(
    results: (SplitWeather | null)[],
  ): import("../types").HourlyWeatherPoint[] {
    const out: import("../types").HourlyWeatherPoint[] = [];
    for (let i = 0; i < points.length; i++) {
      const w = results[i];
      if (w) out.push({ ...points[i], weather: w });
    }
    return out;
  }

  const { results, cache } = await fetchSplitWeather(
    points.map((p) => ({ lat: p.lat, lon: p.lon, endTimeIso: p.timeIso })),
    usePaidApi,
    onProgress
      ? (partialResults, partialCache) => {
          const partial = mapResults(partialResults);
          if (partial.length > 0)
            onProgress(partial, extractSunriseSunset(partialCache));
        }
      : undefined,
  );

  const out = mapResults(results);
  return { points: out, sunriseSunset: extractSunriseSunset(cache) };
}

/**
 * Derive `SplitWeatherPair[][]` (keyed by [segIdx][splitIdx]) from a flat
 * array of `HourlyWeatherPoint`s.  This replaces the original `fetchSplitWeatherPairs`
 * call — no additional network requests are made.
 *
 * For each split the function picks:
 *   - `start` — the earliest hourly point in the split
 *   - `end`   — the latest hourly point in the split
 *   - `tempMin` / `tempMax` — min/max temperature across all hourly points
 */
export function deriveWeatherPairsFromHourly(
  hourly: import("../types").HourlyWeatherPoint[],
  segmentCount: number,
  splitCountsPerSegment: number[],
): (SplitWeatherPair | null)[][] {
  // Build nested structure with empty rows first
  const result: (SplitWeatherPair | null)[][] = Array.from(
    { length: segmentCount },
    (_, si) =>
      Array.from({ length: splitCountsPerSegment[si] ?? 0 }, () => null),
  );

  // Group hourly points by [segIdx][splitIdx]
  const grouped = new Map<string, import("../types").HourlyWeatherPoint[]>();
  for (const pt of hourly) {
    const key = `${pt.segIdx}:${pt.splitIdx}`;
    let arr = grouped.get(key);
    if (!arr) {
      arr = [];
      grouped.set(key, arr);
    }
    arr.push(pt);
  }

  for (const [key, pts] of grouped) {
    const [si, sj] = key.split(":").map(Number);
    if (!result[si] || result[si][sj] === undefined) continue;

    // pts are in insertion order which is already chronological
    const start = pts[0].weather;
    const end = pts[pts.length - 1].weather;
    const temps = pts.map((p) => p.weather.temperature);
    result[si][sj] = {
      start,
      end,
      tempMin: Math.min(...temps),
      tempMax: Math.max(...temps),
    };
  }

  return result;
}
