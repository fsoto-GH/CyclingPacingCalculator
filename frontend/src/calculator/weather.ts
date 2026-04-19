/**
 * Fetch hourly weather forecasts from the Open-Meteo API for split endpoints.
 *
 * Open-Meteo is free, requires no API key, and supports batched lat/lon.
 * We request hourly data for each split endpoint and match the forecast hour
 * closest to the split's computed end time.
 *
 * Limitations:
 *   - Forecast data is only available up to ~16 days out.
 *   - Splits whose end_time falls outside the forecast window get `null`.
 */

export interface SplitWeather {
  /** Temperature in °C */
  temperature: number;
  /** Feels-like temperature in °C */
  apparentTemperature: number;
  /** Precipitation probability (0-100 %) */
  precipitationProbability: number;
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

/**
 * Fetch weather for a list of (lat, lon, endTimeIso) tuples.
 *
 * Open-Meteo supports batched coordinates (comma-separated).  We group by
 * unique lat/lon (rounded to 2 decimal places for dedup) and batch up to 50
 * locations per request, then match each split to the nearest forecast hour.
 *
 * Returns a flat array parallel to the input, with `null` for splits that
 * have no coordinates or whose time is outside the 16-day forecast window.
 */
export async function fetchSplitWeather(
  splits: { lat: number; lon: number; endTimeIso: string }[],
): Promise<(SplitWeather | null)[]> {
  if (splits.length === 0) return [];

  // Deduplicate locations (round to 0.01° ≈ 1 km)
  const locKey = (lat: number, lon: number) =>
    `${lat.toFixed(2)},${lon.toFixed(2)}`;

  // Determine overall date range needed (clamp to 16 days from today)
  const now = new Date();
  const maxForecastDate = new Date(now);
  maxForecastDate.setDate(maxForecastDate.getDate() + 16);

  const uniqueLocs = new Map<string, { lat: number; lon: number }>();
  for (const s of splits) {
    const key = locKey(s.lat, s.lon);
    if (!uniqueLocs.has(key)) {
      uniqueLocs.set(key, {
        lat: parseFloat(s.lat.toFixed(2)),
        lon: parseFloat(s.lon.toFixed(2)),
      });
    }
  }

  // Batch into groups of up to 50 locations (Open-Meteo limit)
  const locEntries = [...uniqueLocs.entries()];
  const BATCH = 50;
  const cache = new Map<string, HourlyData>();

  for (let i = 0; i < locEntries.length; i += BATCH) {
    const batch = locEntries.slice(i, i + BATCH);
    const lats = batch.map(([, v]) => v.lat).join(",");
    const lons = batch.map(([, v]) => v.lon).join(",");

    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${lats}&longitude=${lons}` +
      `&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,relative_humidity_2m,cloud_cover,is_day` +
      `&forecast_days=16` +
      `&timeformat=iso8601`;

    try {
      const resp = await fetch(url);
      if (!resp.ok) continue;
      const data = await resp.json();

      if (batch.length === 1) {
        // Single location — response is a single object
        cache.set(batch[0][0], (data as OpenMeteoResponse).hourly);
      } else {
        // Multiple locations — response is an array
        const arr = data as OpenMeteoResponse[];
        for (let j = 0; j < batch.length; j++) {
          if (arr[j]?.hourly) cache.set(batch[j][0], arr[j].hourly);
        }
      }
    } catch {
      // Network error — skip this batch
    }
  }

  // Match each split to the nearest forecast hour
  return splits.map((s) => {
    const key = locKey(s.lat, s.lon);
    const hourly = cache.get(key);
    if (!hourly) return null;

    const endDate = new Date(s.endTimeIso);
    if (endDate > maxForecastDate) return null;

    // Find the closest hour index
    let bestIdx = -1;
    let bestDiff = Infinity;
    for (let i = 0; i < hourly.time.length; i++) {
      const diff = Math.abs(
        endDate.getTime() - new Date(hourly.time[i]).getTime(),
      );
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) return null;

    return {
      temperature: hourly.temperature_2m[bestIdx],
      apparentTemperature: hourly.apparent_temperature[bestIdx],
      precipitationProbability: hourly.precipitation_probability[bestIdx],
      precipitation: hourly.precipitation[bestIdx],
      weatherCode: hourly.weather_code[bestIdx],
      windSpeed: hourly.wind_speed_10m[bestIdx],
      windDirection: hourly.wind_direction_10m[bestIdx],
      windGusts: hourly.wind_gusts_10m[bestIdx],
      humidity: hourly.relative_humidity_2m[bestIdx],
      cloudCover: hourly.cloud_cover[bestIdx],
      isDay: hourly.is_day[bestIdx] === 1,
      forecastHour: hourly.time[bestIdx],
    };
  });
}
