import axios from "axios";
import type { CoursePayload, CourseDetail } from "./types";
import type { AuthUser } from "./AppSettingsContext";

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

// ── Auth ──────────────────────────────────────────────────────────────────────

/** Returns the currently authenticated user or null (never throws on 401). */
export async function getAuthUser(): Promise<AuthUser | null> {
  try {
    const resp = await axios.get<AuthUser>("/v1/auth/me", {
      withCredentials: true,
    });
    return resp.data;
  } catch {
    return null;
  }
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
    { params, signal, withCredentials: true },
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

// ── GPX search / import (RideWithGPS) ─────────────────────────────────────────

export interface RouteSearchResult {
  id: number;
  name: string;
  distance_m: number;
  description: string | null;
  locality: string | null;
  user_name: string | null;
  preview_photo_url: string | null;
}

export async function searchGpxRoutes(
  q: string,
  offset = 0,
  limit = 20,
): Promise<RouteSearchResult[]> {
  const resp = await axios.get<RouteSearchResult[]>("/v1/cycling/gpx/search", {
    params: { q, offset, limit },
    withCredentials: true,
  });
  return resp.data;
}

export interface GpxTrackPointApi {
  lat: number;
  lon: number;
  ele: number;
  cumDist: number;
}

export interface RouteDetail {
  id: number;
  name: string;
  distance_m: number;
  description: string | null;
  locality: string | null;
  track_points: GpxTrackPointApi[];
}

export async function getGpxRoute(id: number): Promise<RouteDetail> {
  const resp = await axios.get<RouteDetail>(`/v1/cycling/gpx/${id}`, {
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
  payload: CoursePayload;
}

export async function listRacePlans(): Promise<RacePlanSummary[]> {
  const resp = await axios.get<RacePlanSummary[]>("/v1/cycling/race_plan", {
    withCredentials: true,
  });
  return resp.data;
}

export async function getRacePlan(id: string): Promise<RacePlanFull> {
  const resp = await axios.get<RacePlanFull>(`/v1/cycling/race_plan/${id}`, {
    withCredentials: true,
  });
  return resp.data;
}

export async function createRacePlan(
  name: string,
  isPublic: boolean,
  payload: CoursePayload,
): Promise<RacePlanFull> {
  const resp = await axios.post<RacePlanFull>(
    "/v1/cycling/race_plan",
    { name, is_public: isPublic, payload },
    { withCredentials: true },
  );
  return resp.data;
}

export async function updateRacePlan(
  id: string,
  patch: Partial<{ name: string; is_public: boolean; payload: CoursePayload }>,
): Promise<RacePlanFull> {
  const resp = await axios.put<RacePlanFull>(
    `/v1/cycling/race_plan/${id}`,
    patch,
    { withCredentials: true },
  );
  return resp.data;
}

export async function deleteRacePlan(id: string): Promise<void> {
  await axios.delete(`/v1/cycling/race_plan/${id}`, {
    withCredentials: true,
  });
}
