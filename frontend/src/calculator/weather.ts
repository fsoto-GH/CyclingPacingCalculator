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

// ── Open-Meteo ────────────────────────────────────────────────────────────────

const FORECAST_API = "https://api.open-meteo.com/v1/forecast";
const ARCHIVE_API = "https://archive-api.open-meteo.com/v1/archive";

/** How far ahead the forecast API covers (16 days). */
const FORECAST_AHEAD_MS = 16 * 24 * 3_600_000;
/** How many past days the forecast API includes via the `past_days` param. */
const FORECAST_PAST_DAYS = 7;
const FORECAST_PAST_MS = FORECAST_PAST_DAYS * 24 * 3_600_000;

/** Max locations per Open-Meteo batch request. */
const BATCH_SIZE = 50;
/** Courtesy delay between sequential batches (ms). */
const BATCH_DELAY_MS = 200;

const HOURLY_PARAMS =
  "temperature_2m,apparent_temperature,precipitation_probability,precipitation," +
  "rain,weathercode,windspeed_10m,winddirection_10m,windgusts_10m," +
  "relativehumidity_2m,cloudcover,is_day";

/** Archive API does not provide precipitation_probability. */
const ARCHIVE_HOURLY_PARAMS =
  "temperature_2m,apparent_temperature,precipitation,rain,weathercode," +
  "windspeed_10m,winddirection_10m,windgusts_10m,relativehumidity_2m,cloudcover,is_day";

// ── Sunrise / sunset ──

export interface SunriseSunsetEntry {
  type: "sunrise" | "sunset";
  /** UTC milliseconds for this event. */
  ms: number;
}

// ── Internal cache ────────────────────────────────────────────────────────────

interface GHourSlot {
  startMs: number;
  weather: SplitWeather;
}

/** Internal cache type: location key → array of hourly slots. */
type WeatherCache = Map<string, GHourSlot[]>;

const locKey = (lat: number, lon: number) =>
  `${lat.toFixed(2)},${lon.toFixed(2)}`;

/** Parse a time string as UTC milliseconds (appends "Z" if absent). */
function parseTimeMs(t: string): number {
  return new Date(t.endsWith("Z") ? t : t + "Z").getTime();
}

function ssKey(loc: string): string {
  return `om-${loc}`;
}
function getCachedSlots(loc: string): GHourSlot[] | null {
  try {
    const raw = sessionStorage.getItem(ssKey(loc));
    if (!raw) return null;
    return JSON.parse(raw) as GHourSlot[];
  } catch {
    return null;
  }
}

function setCachedSlots(loc: string, slots: GHourSlot[]): void {
  try {
    sessionStorage.setItem(ssKey(loc), JSON.stringify(slots));
  } catch {
    // sessionStorage full or unavailable — skip silently
  }
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function delay(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

// ── Open-Meteo response parsing ───────────────────────────────────────────────

interface OMHourlyData {
  time: string[];
  temperature_2m: (number | null)[];
  apparent_temperature: (number | null)[];
  precipitation_probability?: (number | null)[];
  precipitation: (number | null)[];
  rain: (number | null)[];
  weathercode: (number | null)[];
  windspeed_10m: (number | null)[];
  winddirection_10m: (number | null)[];
  windgusts_10m: (number | null)[];
  relativehumidity_2m: (number | null)[];
  cloudcover: (number | null)[];
  is_day: (0 | 1 | null)[];
}

interface OMResponse {
  hourly: OMHourlyData;
}

function parseOMHourly(data: OMResponse, hasPrecipProb: boolean): GHourSlot[] {
  const h = data.hourly;
  const times = h.time ?? [];
  const slots: GHourSlot[] = [];
  for (let i = 0; i < times.length; i++) {
    // OM returns times without "Z" when timezone=UTC — append it.
    const startMs = new Date(times[i] + "Z").getTime();
    if (!Number.isFinite(startMs)) continue;
    const temp = h.temperature_2m[i] ?? 0;
    slots.push({
      startMs,
      weather: {
        temperature: temp,
        apparentTemperature: h.apparent_temperature[i] ?? temp,
        precipitationProbability: hasPrecipProb
          ? (h.precipitation_probability?.[i] ?? 0)
          : 0,
        precipitationProbabilityAvailable: hasPrecipProb,
        precipitation: h.precipitation[i] ?? 0,
        rain: h.rain[i] ?? 0,
        weatherCode: h.weathercode[i] ?? 0,
        windSpeed: h.windspeed_10m[i] ?? 0,
        windDirection: h.winddirection_10m[i] ?? 0,
        windGusts: h.windgusts_10m[i] ?? 0,
        humidity: h.relativehumidity_2m[i] ?? 0,
        cloudCover: h.cloudcover[i] ?? 0,
        isDay: (h.is_day[i] ?? 1) === 1,
        forecastHour: times[i] + "Z",
      },
    });
  }
  return slots;
}

// ── Batch fetch helpers ───────────────────────────────────────────────────────

interface LocEntry {
  lat: number;
  lon: number;
  key: string;
}

async function fetchForecastBatch(
  locs: LocEntry[],
): Promise<Map<string, GHourSlot[]>> {
  const latStr = locs.map((l) => l.lat).join(",");
  const lonStr = locs.map((l) => l.lon).join(",");
  const url =
    `${FORECAST_API}?latitude=${latStr}&longitude=${lonStr}` +
    `&hourly=${HOURLY_PARAMS}` +
    `&forecast_days=16&past_days=${FORECAST_PAST_DAYS}` +
    `&timezone=UTC`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return new Map();
    const data = (await resp.json()) as OMResponse | OMResponse[];
    const arr = Array.isArray(data) ? data : [data];
    const result = new Map<string, GHourSlot[]>();
    for (let i = 0; i < locs.length; i++) {
      const item = arr[i];
      if (!item?.hourly) continue;
      result.set(locs[i].key, parseOMHourly(item, true));
    }
    return result;
  } catch {
    return new Map();
  }
}

async function fetchArchiveBatch(
  locs: LocEntry[],
  startDate: string,
  endDate: string,
): Promise<Map<string, GHourSlot[]>> {
  const latStr = locs.map((l) => l.lat).join(",");
  const lonStr = locs.map((l) => l.lon).join(",");
  const url =
    `${ARCHIVE_API}?latitude=${latStr}&longitude=${lonStr}` +
    `&hourly=${ARCHIVE_HOURLY_PARAMS}` +
    `&start_date=${startDate}&end_date=${endDate}` +
    `&timezone=UTC`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return new Map();
    const data = (await resp.json()) as OMResponse | OMResponse[];
    const arr = Array.isArray(data) ? data : [data];
    const result = new Map<string, GHourSlot[]>();
    for (let i = 0; i < locs.length; i++) {
      const item = arr[i];
      if (!item?.hourly) continue;
      result.set(locs[i].key, parseOMHourly(item, false));
    }
    return result;
  } catch {
    return new Map();
  }
}

// ── Nearest slot lookup ───────────────────────────────────────────────────────

function findNearestSlot(
  slots: GHourSlot[],
  targetMs: number,
): GHourSlot | null {
  if (slots.length === 0) return null;
  let best: GHourSlot | null = null;
  let bestDiff = Infinity;
  for (const slot of slots) {
    const diff = Math.abs(slot.startMs - targetMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = slot;
    }
  }
  // Accept only if within ±2 hours.
  return bestDiff <= 2 * 3_600_000 ? best : null;
}

// ── Sunrise/sunset ────────────────────────────────────────────────────────────

/**
 * Extracts sunrise/sunset events from a weather cache.
 * Currently returns an empty array; sunrise/sunset are not cached separately.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function extractSunriseSunset(
  _cache: WeatherCache,
): SunriseSunsetEntry[] {
  return [];
}

// ── Main fetch entry point ────────────────────────────────────────────────────

export async function fetchSplitWeather(
  splits: { lat: number; lon: number; endTimeIso: string }[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _usePaidApi = false,
  onBatchComplete?: (
    results: (SplitWeather | null)[],
    cache: WeatherCache,
  ) => void,
): Promise<{
  results: (SplitWeather | null)[];
  cache: WeatherCache;
}> {
  if (splits.length === 0) {
    return { results: [], cache: new Map() };
  }

  const now = Date.now();
  const results: (SplitWeather | null)[] = new Array(splits.length).fill(null);
  const cache: WeatherCache = new Map();

  // ── Collect unique locations and classify by time range ──
  interface LocInfo extends LocEntry {
    needsForecast: boolean;
    needsArchive: boolean;
    archiveMinMs: number;
    archiveMaxMs: number;
  }

  const locMap = new Map<string, LocInfo>();
  for (const s of splits) {
    if (s.lat === 0 && s.lon === 0) continue;
    const key = locKey(s.lat, s.lon);
    const tMs = parseTimeMs(s.endTimeIso);
    if (!Number.isFinite(tMs)) continue;
    const inForecast =
      tMs >= now - FORECAST_PAST_MS && tMs <= now + FORECAST_AHEAD_MS;
    const inArchive = tMs < now - FORECAST_PAST_MS;
    const existing = locMap.get(key);
    if (!existing) {
      locMap.set(key, {
        lat: parseFloat(s.lat.toFixed(2)),
        lon: parseFloat(s.lon.toFixed(2)),
        key,
        needsForecast: inForecast,
        needsArchive: inArchive,
        archiveMinMs: inArchive ? tMs : Infinity,
        archiveMaxMs: inArchive ? tMs : -Infinity,
      });
    } else {
      if (inForecast) existing.needsForecast = true;
      if (inArchive) {
        existing.needsArchive = true;
        if (tMs < existing.archiveMinMs) existing.archiveMinMs = tMs;
        if (tMs > existing.archiveMaxMs) existing.archiveMaxMs = tMs;
      }
    }
  }

  // ── Populate from sessionStorage cache first ──
  const uncachedForecast: LocInfo[] = [];
  const uncachedArchive: LocInfo[] = [];

  for (const loc of locMap.values()) {
    const cached = getCachedSlots(loc.key);
    if (cached) {
      cache.set(loc.key, cached);
      for (let i = 0; i < splits.length; i++) {
        if (locKey(splits[i].lat, splits[i].lon) !== loc.key) continue;
        const nearest = findNearestSlot(
          cached,
          parseTimeMs(splits[i].endTimeIso),
        );
        if (nearest) results[i] = nearest.weather;
      }
    } else {
      if (loc.needsForecast) uncachedForecast.push(loc);
      if (loc.needsArchive) uncachedArchive.push(loc);
    }
  }

  // Fire callback with any cached data before network requests begin.
  if (
    (uncachedForecast.length > 0 || uncachedArchive.length > 0) &&
    onBatchComplete
  ) {
    onBatchComplete([...results], cache);
  }

  // ── Fetch forecast batches (sequential, BATCH_SIZE locations each) ──
  for (let i = 0; i < uncachedForecast.length; i += BATCH_SIZE) {
    if (i > 0) await delay(BATCH_DELAY_MS);
    const batch = uncachedForecast.slice(i, i + BATCH_SIZE);
    const fetched = await fetchForecastBatch(batch);
    for (const [key, slots] of fetched) {
      setCachedSlots(key, slots);
      cache.set(key, slots);
      for (let j = 0; j < splits.length; j++) {
        if (locKey(splits[j].lat, splits[j].lon) !== key) continue;
        const nearest = findNearestSlot(
          slots,
          parseTimeMs(splits[j].endTimeIso),
        );
        if (nearest) results[j] = nearest.weather;
      }
    }
    onBatchComplete?.([...results], cache);
  }

  // ── Fetch archive batches ──
  if (uncachedArchive.length > 0) {
    const archiveMinMs = Math.min(
      ...uncachedArchive.map((l) => l.archiveMinMs),
    );
    const archiveMaxMs = Math.max(
      ...uncachedArchive.map((l) => l.archiveMaxMs),
    );
    const startDate = isoDate(archiveMinMs);
    const endDate = isoDate(archiveMaxMs);

    for (let i = 0; i < uncachedArchive.length; i += BATCH_SIZE) {
      if (i > 0) await delay(BATCH_DELAY_MS);
      const batch = uncachedArchive.slice(i, i + BATCH_SIZE);
      const fetched = await fetchArchiveBatch(batch, startDate, endDate);
      for (const [key, slots] of fetched) {
        setCachedSlots(key, slots);
        cache.set(key, slots);
        for (let j = 0; j < splits.length; j++) {
          if (locKey(splits[j].lat, splits[j].lon) !== key) continue;
          const nearest = findNearestSlot(
            slots,
            parseTimeMs(splits[j].endTimeIso),
          );
          if (nearest) results[j] = nearest.weather;
        }
      }
      onBatchComplete?.([...results], cache);
    }
  }

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
  _usePaidApi = false,
): Promise<SplitWeatherPair[]> {
  if (splits.length === 0) return [];

  // Interleave: [start0, end0, start1, end1, …]
  const flat = splits.flatMap((s) => [
    { lat: s.startLat, lon: s.startLon, endTimeIso: s.startTimeIso },
    { lat: s.endLat, lon: s.endLon, endTimeIso: s.endTimeIso },
  ]);

  const { results, cache } = await fetchSplitWeather(flat);

  return splits.map((s, i) => {
    const start = results[i * 2] ?? null;
    const end = results[i * 2 + 1] ?? null;

    let tempMin: number | undefined;
    let tempMax: number | undefined;
    if (start || end) {
      const startMs = parseTimeMs(s.startTimeIso);
      const endMs = parseTimeMs(s.endTimeIso);
      const temps: number[] = [];
      if (start) temps.push(start.temperature);
      if (end) temps.push(end.temperature);
      // Scan hourly slots for both endpoint locations to capture intermediate temps.
      const seen = new Set<string>();
      for (const k of [
        locKey(s.startLat, s.startLon),
        locKey(s.endLat, s.endLon),
      ]) {
        if (seen.has(k)) continue;
        seen.add(k);
        const slots = cache.get(k);
        if (!slots) continue;
        for (const slot of slots) {
          if (slot.startMs >= startMs && slot.startMs <= endMs) {
            temps.push(slot.weather.temperature);
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
 *   frac  = (h - startMs) / (endMs - startMs)
 *   km    = startKm + frac × (endKm - startKm)
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
 * Fetch weather for a list of hourly course coordinate points, returning the
 * same list with `weather` attached. Points for which no weather is available
 * (outside 16-day window or missing coords) are omitted from the result.
 *
 * Pass `onProgress` to receive incremental updates after each batch completes
 * so the UI can render partial data while the remaining batches load.
 */
export async function fetchHourlyCourseWeather(
  points: HourlyCourseCoord[],
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
    false,
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
