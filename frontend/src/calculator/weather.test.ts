import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchSplitWeather } from "./weather";

const TARGET_TIME = "2026-10-03T12:00:00Z";
const CACHE_TTL_MS = 60 * 60_000;

function forecastResponse(temperature: number) {
  return {
    hourly: {
      time: ["2026-10-03T12:00"],
      temperature_2m: [temperature],
      apparent_temperature: [temperature],
      precipitation_probability: [0],
      precipitation: [0],
      rain: [0],
      weathercode: [0],
      windspeed_10m: [0],
      winddirection_10m: [0],
      windgusts_10m: [0],
      relativehumidity_2m: [50],
      cloudcover: [0],
      is_day: [0],
    },
  };
}

describe("fetchSplitWeather session cache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-25T12:00:00Z"));
    const storage = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("refetches forecast data after the cache expires", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => forecastResponse(10),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => forecastResponse(20),
      });
    vi.stubGlobal("fetch", fetchMock);

    const splits = [{ lat: 43.35, lon: -91.2, endTimeIso: TARGET_TIME }];
    const first = await fetchSplitWeather(splits);
    vi.advanceTimersByTime(CACHE_TTL_MS + 1);
    const second = await fetchSplitWeather(splits);

    expect(first.results[0]?.temperature).toBe(10);
    expect(second.results[0]?.temperature).toBe(20);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
