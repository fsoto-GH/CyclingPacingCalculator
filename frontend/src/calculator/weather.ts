export interface SplitWeather {
  /** Temperature in °C */
  temperature: number;
  /** Feels-like temperature in °C */
  apparentTemperature: number;
  /** Precipitation probability (0-100 %). Only available from the forecast API. */
  precipitationProbability: number;
  /** Whether precipitationProbability came from the API (true) or was synthesized (false). */
  precipitationProbabilityAvailable: boolean;
  /** Precipitation in mm */
  precipitation: number;
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
  /** The ISO hour the forecast corresponds to */
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
 * Fetch hourly weather from the Open-Meteo API for split endpoints.
 *
 * Routes each point to the correct API based on time:
 *   - Past dates    → archive-api.open-meteo.com/v1/archive (ERA5 / ECMWF IFS, back to 1940)
 *   - Future dates  → api.open-meteo.com/v1/forecast (16-day window)
 *   - Beyond 16 days in the future → null (no data available)
 *
 * Both APIs support batched lat/lon (comma-separated, up to 50 per request).
 * Locations are deduplicated by rounding to 0.01° (~1 km).
 *
 * Archive API differences vs. forecast:
 *   - Uses start_date / end_date instead of forecast_days.
 *   - No precipitation_probability field → synthesized as 0.
 *   - No is_day field → approximated from UTC hour (06:00-20:00 = day).
 */

// ── Open-Meteo response shape (subset) ──

interface HourlyData {
  time: string[];
  temperature_2m: number[];
  apparent_temperature: number[];
  precipitation_probability: number[];
  precipitation: number[];
  weather_code: number[];
  wind_speed_10m: number[];
  wind_direction_10m: number[];
  wind_gusts_10m: number[];
  relative_humidity_2m: number[];
  cloud_cover: number[];
  is_day: number[];
}

interface OpenMeteoResponse {
  hourly: HourlyData;
}

// ── Shared helpers ──

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

/**
 * The archive API omits precipitation_probability and is_day.
 * Synthesize them so the HourlyData shape is uniform across both APIs.
 * is_day approximation: use the location's longitude to estimate local solar
 * time (1 h per 15° of longitude), then treat 06:00-20:00 solar time as day.
 * This avoids the UTC-offset error that would otherwise flag 3 AM EDT as daytime.
 */
function patchArchiveHourly(
  h: Omit<HourlyData, "precipitation_probability" | "is_day">,
  lonDeg: number,
): HourlyData {
  const len = h.time.length;
  return {
    ...h,
    precipitation_probability: new Array<number>(len).fill(0),
    is_day: h.time.map((t) => {
      const utcHour = new Date(t + "Z").getUTCHours();
      // Shift UTC hour by longitude-based solar offset, then wrap to [0, 24).
      const solarHour = (((utcHour + lonDeg / 15) % 24) + 24) % 24;
      return solarHour >= 6 && solarHour <= 20 ? 1 : 0;
    }),
  } as HourlyData;
}

/** Map one hourly slot to a SplitWeather value. */
function mapHourlySlot(
  h: HourlyData,
  idx: number,
  precipProbAvailable = true,
): SplitWeather {
  return {
    temperature: h.temperature_2m[idx],
    apparentTemperature: h.apparent_temperature[idx],
    precipitationProbability: h.precipitation_probability[idx],
    precipitationProbabilityAvailable: precipProbAvailable,
    precipitation: h.precipitation[idx],
    weatherCode: h.weather_code[idx],
    windSpeed: h.wind_speed_10m[idx],
    windDirection: h.wind_direction_10m[idx],
    windGusts: h.wind_gusts_10m[idx],
    humidity: h.relative_humidity_2m[idx],
    cloudCover: h.cloud_cover[idx],
    isDay: h.is_day[idx] === 1,
    // Append "Z" so the string is unambiguously UTC when parsed by the UI.
    forecastHour: h.time[idx].endsWith("Z") ? h.time[idx] : h.time[idx] + "Z",
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

/** Nearest-hour search: return the index of the hourly slot closest to targetMs (UTC). */
function findBestHour(h: HourlyData, targetMs: number): number {
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
 * Resolve a URL for a batch weather request.
 * When usePaidApi is true, the request goes through the backend proxy at
 * /v1/cycling/forecast so API keys stay server-side.
 */
function forecastUrl(
  lats: string,
  lons: string,
  forecastDays: number,
  usePaidApi: boolean,
): string {
  if (usePaidApi) {
    return (
      `/v1/cycling/forecast` +
      `?lat=${lats}&lon=${lons}&mode=forecast&forecast_days=${forecastDays}`
    );
  }
  return (
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lats}&longitude=${lons}` +
    `&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,relative_humidity_2m,cloud_cover,is_day` +
    `&forecast_days=${forecastDays}` +
    `&timeformat=iso8601`
  );
}

function archiveUrl(
  lats: string,
  lons: string,
  startDate: string,
  endDate: string,
  usePaidApi: boolean,
): string {
  if (usePaidApi) {
    return (
      `/v1/cycling/forecast` +
      `?lat=${lats}&lon=${lons}&mode=archive&start_date=${startDate}&end_date=${endDate}`
    );
  }
  return (
    `https://archive-api.open-meteo.com/v1/archive` +
    `?latitude=${lats}&longitude=${lons}` +
    `&start_date=${startDate}&end_date=${endDate}` +
    `&hourly=temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,relative_humidity_2m,cloud_cover` +
    `&timeformat=iso8601`
  );
}

export async function fetchSplitWeather(
  splits: { lat: number; lon: number; endTimeIso: string }[],
  usePaidApi = false,
): Promise<{
  results: (SplitWeather | null)[];
  cache: Map<string, HourlyData>;
}> {
  if (splits.length === 0) return { results: [], cache: new Map() };

  const now = new Date();
  const maxForecastDate = new Date(now);
  maxForecastDate.setDate(maxForecastDate.getDate() + 16);
  const BATCH = 50;

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
  const allHourly = new Map<string, HourlyData>();

  // ── Forecast path ──
  if (forecastIdx.length > 0) {
    const uniqueLocs = new Map<string, { lat: number; lon: number }>();
    for (const i of forecastIdx) {
      const s = splits[i];
      const key = locKey(s.lat, s.lon);
      if (!uniqueLocs.has(key))
        uniqueLocs.set(key, {
          lat: parseFloat(s.lat.toFixed(2)),
          lon: parseFloat(s.lon.toFixed(2)),
        });
    }
    const locEntries = [...uniqueLocs.entries()];
    const cache = allHourly;

    for (let i = 0; i < locEntries.length; i += BATCH) {
      const batch = locEntries.slice(i, i + BATCH);
      const lats = batch.map(([, v]) => v.lat).join(",");
      const lons = batch.map(([, v]) => v.lon).join(",");
      const url = forecastUrl(lats, lons, 16, usePaidApi);
      try {
        const resp = await fetch(url);
        if (!resp.ok) continue;
        const data = await resp.json();
        if (batch.length === 1) {
          cache.set(batch[0][0], (data as OpenMeteoResponse).hourly);
        } else {
          const arr = data as OpenMeteoResponse[];
          for (let j = 0; j < batch.length; j++) {
            if (arr[j]?.hourly) cache.set(batch[j][0], arr[j].hourly);
          }
        }
      } catch {
        // Network error — skip batch
      }
    }

    for (const i of forecastIdx) {
      const s = splits[i];
      const hourly = cache.get(locKey(s.lat, s.lon));
      if (!hourly) continue;
      const idx = findBestHour(hourly, new Date(s.endTimeIso).getTime());
      if (idx !== -1) results[i] = mapHourlySlot(hourly, idx);
    }
  }

  // ── Historical path (archive API) ──
  if (historicalIdx.length > 0) {
    // Track min/max date per unique location so we request the narrowest range.
    const uniqueLocs = new Map<
      string,
      { lat: number; lon: number; minDate: Date; maxDate: Date }
    >();
    for (const i of historicalIdx) {
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
    const cache = allHourly;

    for (let i = 0; i < locEntries.length; i += BATCH) {
      const batch = locEntries.slice(i, i + BATCH);
      const lats = batch.map(([, v]) => v.lat).join(",");
      const lons = batch.map(([, v]) => v.lon).join(",");
      // Date range spanning all needed dates for this batch of locations.
      let bMin = batch[0][1].minDate;
      let bMax = batch[0][1].maxDate;
      for (const [, v] of batch) {
        if (v.minDate < bMin) bMin = v.minDate;
        if (v.maxDate > bMax) bMax = v.maxDate;
      }
      const url = archiveUrl(
        lats,
        lons,
        toDateStr(bMin),
        toDateStr(bMax),
        usePaidApi,
      );
      type ArchiveResponse = {
        hourly: Omit<HourlyData, "precipitation_probability" | "is_day">;
      };
      try {
        const resp = await fetch(url);
        if (!resp.ok) continue;
        const data = await resp.json();
        if (batch.length === 1) {
          cache.set(
            batch[0][0],
            patchArchiveHourly(
              (data as ArchiveResponse).hourly,
              batch[0][1].lon,
            ),
          );
        } else {
          const arr = data as ArchiveResponse[];
          for (let j = 0; j < batch.length; j++) {
            if (arr[j]?.hourly)
              cache.set(
                batch[j][0],
                patchArchiveHourly(arr[j].hourly, batch[j][1].lon),
              );
          }
        }
      } catch {
        // Network error — skip batch
      }
    }

    for (const i of historicalIdx) {
      const s = splits[i];
      const hourly = cache.get(locKey(s.lat, s.lon));
      if (!hourly) continue;
      const idx = findBestHour(hourly, new Date(s.endTimeIso).getTime());
      if (idx !== -1) results[i] = mapHourlySlot(hourly, idx, false);
    }
  }

  return { results, cache: allHourly };
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
      // Scan hourly slots for both endpoint locations to capture intermediate hours.
      const seen = new Set<string>();
      for (const k of [
        locKey(s.startLat, s.startLon),
        locKey(s.endLat, s.endLon),
      ]) {
        if (seen.has(k)) continue;
        seen.add(k);
        const hourly = cache.get(k);
        if (!hourly) continue;
        for (let j = 0; j < hourly.time.length; j++) {
          const tMs = parseApiTimeMs(hourly.time[j]);
          if (tMs >= startMs && tMs <= endMs) {
            temps.push(hourly.temperature_2m[j]);
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
 * Compute one coordinate per wall-clock hour across the entire course by
 * linearly interpolating along the GPX track within each split.
 *
 * For a given hour `h` that falls within split [startMs, endMs]:
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
  const ONE_HOUR_MS = 3_600_000;

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

      // First wall-clock hour at or after split start
      const firstHourMs = Math.ceil(startMs / ONE_HOUR_MS) * ONE_HOUR_MS;

      for (let h = firstHourMs; h <= endMs; h += ONE_HOUR_MS) {
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
 */
export async function fetchHourlyCourseWeather(
  points: HourlyCourseCoord[],
  usePaidApi = false,
): Promise<import("../types").HourlyWeatherPoint[]> {
  if (points.length === 0) return [];

  const { results } = await fetchSplitWeather(
    points.map((p) => ({ lat: p.lat, lon: p.lon, endTimeIso: p.timeIso })),
    usePaidApi,
  );

  const out: import("../types").HourlyWeatherPoint[] = [];
  for (let i = 0; i < points.length; i++) {
    const w = results[i];
    if (!w) continue;
    out.push({ ...points[i], weather: w });
  }
  return out;
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
