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

// ── Auth sync ─────────────────────────────────────────────────────────────────

export interface UserFlagsResponse {
  enable_google_places: boolean;
  enable_google_maps: boolean;
}

export interface SyncUserResponse {
  is_new_user: boolean;
  user: {
    id: string;
    email: string;
    name: string | null;
    avatar_url: string | null;
    is_active: boolean;
    created_at: string;
    last_login_at: string;
  };
  flags: UserFlagsResponse;
}

/**
 * Called immediately after a successful sign-in to upsert the user record
 * in our local database.  The access_token is passed directly so this can
 * be called inside onAuthStateChange before the context has updated.
 */
export async function syncUser(accessToken: string): Promise<SyncUserResponse> {
  const response = await axios.post<SyncUserResponse>("/v1/auth/sync", null, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return response.data;
}

// ── User Settings ─────────────────────────────────────────────────────────────

export async function fetchUserSettings(): Promise<Record<string, unknown>> {
  const resp = await axios.get<{ settings: Record<string, unknown> }>(
    "/v1/user_settings",
    { headers: await authHeader() },
  );
  return resp.data.settings ?? {};
}

export async function putUserSettings(
  settings: Record<string, unknown>,
): Promise<void> {
  await axios.put(
    "/v1/user_settings",
    { settings },
    { headers: await authHeader() },
  );
}

// ── Google Maps tile session ──────────────────────────────────────────────────

export interface GoogleTileSessionResponse {
  tile_url_template: string;
  expiry: number;
}

export async function getGoogleTileSession(
  type: "roadmap" | "satellite" | "terrain" | "dark",
): Promise<GoogleTileSessionResponse> {
  const resp = await axios.get<GoogleTileSessionResponse>(
    "/v1/maps/google-tile-session",
    { params: { type }, headers: await authHeader() },
  );
  return resp.data;
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
  hours?: Array<{ mode: string; opens: string; closes: string }> | null;
  raw_hours?: string | null;
  place_id?: string | null;
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

export async function searchPlacesText(
  query: string,
  lat: number,
  lon: number,
  radiusM: number,
  signal?: AbortSignal,
): Promise<NearbyAmenityResult[]> {
  const resp = await axios.get<NearbyAmenityResult[]>(
    "/v1/cycling/places_text_search",
    {
      params: { query, lat, lon, radius_m: radiusM },
      signal,
      headers: await authHeader(),
    },
  );
  return resp.data;
}

export async function searchAlongRoute(
  query: string,
  encodedPolyline: string,
  signal?: AbortSignal,
  originLat?: number,
  originLon?: number,
): Promise<NearbyAmenityResult[]> {
  const body: Record<string, unknown> = {
    query,
    encoded_polyline: encodedPolyline,
    ...(originLat !== undefined && originLon !== undefined
      ? { origin_lat: originLat, origin_lon: originLon }
      : {}),
  };
  const resp = await axios.post<NearbyAmenityResult[]>(
    "/v1/cycling/places_search_along_route",
    body,
    { signal, headers: await authHeader() },
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
  description?: string | null;
  is_public: boolean;
  created_at: string;
  updated_at: string;
}

export interface RacePlanFull extends RacePlanSummary {
  payload: unknown;
}

export interface RacePlanPage {
  items: RacePlanSummary[];
  total: number;
  page: number;
  per_page: number;
}

export async function listRacePlans(params?: {
  q?: string;
  page?: number;
  per_page?: number;
}): Promise<RacePlanPage> {
  const resp = await axios.get<RacePlanPage>("/v1/cycling/race_plan", {
    headers: await authHeader(),
    params,
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
  description: string | null | undefined,
  payload: unknown,
): Promise<RacePlanFull> {
  const resp = await axios.post<RacePlanFull>(
    "/v1/cycling/race_plan",
    { name, is_public: isPublic, description: description ?? null, payload },
    { headers: await authHeader() },
  );
  return resp.data;
}

export async function updateRacePlan(
  id: string,
  patch: Partial<{
    name: string;
    description: string | null;
    is_public: boolean;
    payload: unknown;
  }>,
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
