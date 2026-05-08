import axios from "axios";
import type { CoursePayload, CourseDetail } from "./types";
import { supabase } from "./supabaseClient";

// ── Auth helpers ──────────────────────────────────────────────────────────────

/**
 * Returns the current Supabase access token, or null if not signed in.
 * Use this to attach Authorization: Bearer <token> to authenticated requests.
 */
async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/** Returns Authorization header object, or empty object if not signed in. */
async function authHeader(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ── Calculator ────────────────────────────────────────────────────────────────

export async function calculateCourse(
  payload: CoursePayload,
): Promise<CourseDetail> {
  const response = await axios.post<CourseDetail>(
    "/v1/cycling/calculator",
    payload,
  );
  return response.data;
}

// ── Nearby stops ──────────────────────────────────────────────────────────────

export interface NearbyAmenityResult {
  id: number;
  name: string;
  amenity: string;
  distance_m: number;
  lat: number;
  lon: number;
  address: string;
  street_line: string;
  has_locality: boolean;
  hours?: Record<string, unknown> | null;
  raw_hours?: string | null;
}

export async function getNearbyStops(
  lat: number,
  lon: number,
  radiusM: number,
  amenityFilter?: string[],
  signal?: AbortSignal,
): Promise<NearbyAmenityResult[]> {
  const params: Record<string, string | number> = {
    lat,
    lon,
    radius_m: radiusM,
  };
  if (amenityFilter && amenityFilter.length > 0) {
    params.amenity_filter = amenityFilter.join(",");
  }
  const resp = await axios.get<NearbyAmenityResult[]>(
    "/v1/cycling/nearby_stops",
    { params, signal, headers: await authHeader() },
  );
  return resp.data;
}

// ── Weather (proxy) ───────────────────────────────────────────────────────────

export async function getForecast(
  lats: string,
  lons: string,
  mode: "forecast" | "archive",
  options?: {
    forecastDays?: number;
    startDate?: string;
    endDate?: string;
  },
): Promise<unknown> {
  const params: Record<string, string | number> = {
    lat: lats,
    lon: lons,
    mode,
  };
  if (mode === "forecast" && options?.forecastDays) {
    params.forecast_days = options.forecastDays;
  }
  if (mode === "archive" && options?.startDate && options?.endDate) {
    params.start_date = options.startDate;
    params.end_date = options.endDate;
  }
  const resp = await axios.get<unknown>("/v1/cycling/forecast", {
    params,
    withCredentials: true,
  });
  return resp.data;
}

// ── Race plans ────────────────────────────────────────────────────────────────

export interface RacePlanSummary {
  id: string;
  user_id: string;
  name: string;
  is_public: boolean;
  created_at: string;
  updated_at: string;
}

export interface RacePlanFull extends RacePlanSummary {
  payload: unknown;
}

export async function listRacePlans(): Promise<RacePlanSummary[]> {
  const resp = await axios.get<RacePlanSummary[]>("/v1/cycling/race_plan", {
    headers: await authHeader(),
  });
  return resp.data;
}

export async function getRacePlan(id: string): Promise<RacePlanFull> {
  const resp = await axios.get<RacePlanFull>(`/v1/cycling/race_plan/${id}`, {
    headers: await authHeader(),
  });
  return resp.data;
}

export async function createRacePlan(
  name: string,
  isPublic: boolean,
  payload: unknown,
): Promise<RacePlanFull> {
  const resp = await axios.post<RacePlanFull>(
    "/v1/cycling/race_plan",
    { name, is_public: isPublic, payload },
    { headers: await authHeader() },
  );
  return resp.data;
}

export async function updateRacePlan(
  id: string,
  patch: Partial<{ name: string; is_public: boolean; payload: unknown }>,
): Promise<RacePlanFull> {
  const resp = await axios.put<RacePlanFull>(
    `/v1/cycling/race_plan/${id}`,
    patch,
    { headers: await authHeader() },
  );
  return resp.data;
}

export async function deleteRacePlan(id: string): Promise<void> {
  await axios.delete(`/v1/cycling/race_plan/${id}`, {
    headers: await authHeader(),
  });
}
