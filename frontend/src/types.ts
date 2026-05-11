// ── Unit system (display-only toggle) ──
export type UnitSystem = "imperial" | "metric";

// ── GPX / elevation profile types ──

export interface GpxTrackPoint {
  lat: number;
  lon: number;
  ele: number; // metres
  cumDist: number; // km from track start
}

export interface SplitGpxProfile {
  elevGainM: number;
  elevLossM: number;
  avgGradePct: number;
  steepPct: number; // % of distance with grade > 5%
  surface: string; // e.g. "paved" | "gravel" | "unknown"
  startLat: number;
  startLon: number;
  endLat: number;
  endLon: number;
  endTimezone: string; // IANA tz at endpoint
  startKm: number;
  endKm: number;
}

export interface GpxWaypoint {
  name: string;
  lat: number;
  lon: number;
  description?: string;
  symbol: "food";
}

/**
 * Weather data sampled at a specific wall-clock hour along the course.
 * The lat/lon is interpolated along the GPX track based on the fraction of
 * elapsed time within the enclosing split.
 */
export interface HourlyWeatherPoint {
  /** UTC ISO string for this wall-clock hour (e.g. "2025-07-15T14:00:00.000Z"). */
  timeIso: string;
  lat: number;
  lon: number;
  weather: import("./calculator/weather").SplitWeather;
  /** Segment index this point belongs to. */
  segIdx: number;
  /** Split index (within segment) this point belongs to. */
  splitIdx: number;
}

// ── API request types ──
export type Mode = "distance" | "target_distance";
export type SubSplitMode = "even" | "fixed" | "custom" | "hour";

export interface RestStopPayload {
  name: string;
  open_hours: Record<string, string>;
  address: string;
  alt?: string | null;
}

export interface SplitPayload {
  name?: string | null;
  distance: number;
  sub_split_mode: SubSplitMode;
  sub_split_count?: number | null;
  sub_split_distance?: number | null;
  last_sub_split_threshold?: number | null;
  sub_split_distances?: number[] | null;
  rest_stop?: RestStopPayload | null;
  down_time?: number | null; // seconds
  moving_speed?: number | null;
  adjustment_time?: number; // seconds
  end_timezone?: string | null; // IANA tz at split endpoint
}

export interface SegmentPayload {
  name?: string | null;
  splits: SplitPayload[];
  down_time_ratio?: number | null;
  split_delta?: number | null;
  moving_speed?: number | null;
  min_moving_speed?: number | null;
  sleep_time?: number; // seconds
  no_end_down_time: boolean;
  nullified?: boolean;
  fixed_elapsed_time_seconds?: number; // seconds
}

export interface CoursePayload {
  segments: SegmentPayload[];
  mode: Mode;
  init_moving_speed: number;
  min_moving_speed: number;
  down_time_ratio: number;
  split_delta: number;
  start_time: string; // ISO 8601
  course_timezone?: string | null; // IANA tz for the course start
}

// ── Form state types (mirrors form inputs, not API) ──

export type DayHoursMode = "hours" | "24h" | "closed";

export interface DayHoursEntry {
  mode: DayHoursMode;
  opens: string; // HH:MM (24h format for <input type="time">)
  closes: string;
}

export function makeDefaultDayHours(): DayHoursEntry {
  return { mode: "closed", opens: "0:00", closes: "24:00" };
}

export interface RestStopForm {
  enabled: boolean;
  backup: boolean;
  name: string;
  address: string;
  alt: string;
  lat?: number;
  lon?: number;
  sameHoursEveryDay: boolean;
  allDays: DayHoursEntry; // used when sameHoursEveryDay
  perDay: [
    DayHoursEntry,
    DayHoursEntry,
    DayHoursEntry,
    DayHoursEntry,
    DayHoursEntry,
    DayHoursEntry,
    DayHoursEntry,
  ];
}

export interface SplitForm {
  name?: string;
  distance: string;
  sub_split_mode: SubSplitMode;
  sub_split_override?: boolean; // when false/undefined, split inherits course-level mode
  sub_split_count: string;
  sub_split_distance: string;
  last_sub_split_threshold: string;
  sub_split_distances: string; // comma-separated
  rest_stop: RestStopForm;
  down_time: string; // minutes
  moving_speed: string;
  adjustment_time: string; // minutes
  differentTimezone: boolean;
  timezone: string; // IANA timezone override
  tzManuallySet?: boolean; // true when the user explicitly chose the tz (auto-detection will not override)
  notes?: string; // freeform rider notes, displayed in results
}

export interface SegmentForm {
  name?: string;
  sleep_time: string; // minutes
  include_end_down_time: boolean; // inverts to no_end_down_time
  down_time_ratio: string;
  split_delta: string;
  moving_speed: string;
  min_moving_speed: string;
  splitCount: string;
  splits: SplitForm[];
  nullified?: boolean;
  fixed_elapsed_time: string; // minutes
}

export interface CourseForm {
  name?: string;
  gpxFileName?: string; // filename (no .gpx) of the associated GPX, for IDB restore on import
  rwgpsRouteId?: number | null; // RWGPS route ID used to re-fetch route tracks on reload/import
  unitSystem: UnitSystem;
  mode: Mode;
  timezone: string; // IANA timezone
  sub_split_mode: SubSplitMode; // course-level default, splits may override
  sub_split_count?: string;
  sub_split_distance?: string;
  last_sub_split_threshold?: string;
  sub_split_distances?: string; // comma-separated
  init_moving_speed: string;
  min_moving_speed: string;
  down_time_ratio: string;
  split_delta: string;
  start_time: string;
  segmentCount: string;
  segments: SegmentForm[];
}

// ── API response types ──

export interface SubSplitDetail {
  distance: number;
  start_time: string;
  end_time: string;
  moving_speed: number;
  moving_time: string;
  down_time: string;
  split_time: string;
  active_time: string;
  pace: number;
  start_distance: number;
  span: [number, number];
  moving_time_hours: number;
  down_time_hours: number;
  active_time_hours: number;
}

export interface SplitDetail extends SubSplitDetail {
  name?: string | null;
  start_timezone?: string | null;
  end_timezone?: string | null;
  sub_splits: SubSplitDetail[];
  adjustment_start: string;
  adjustment_time: string;
  adjustment_time_hours: number | null;
  rest_stop?: {
    name: string;
    address: string;
    alt?: string | null;
  } | null;
}

export interface SegmentDetail {
  split_details: SplitDetail[];
  start_time: string;
  end_time: string;
  end_moving_speed: number;
  distance: number;
  start_distance: number;
  moving_time: string;
  down_time: string;
  sleep_time: string;
  adjustment_time: string | null;
  elapsed_time: string;
  active_time: string;
  span: [number, number];
  pace: number;
  moving_time_hours: number;
  down_time_hours: number;
  adjustment_time_hours: number | null;
  elapsed_time_hours: number;
  active_time_hours: number;
  sleep_time_hours: number;
  moving_speed: null;
  adjustment_start: null;
  name: string | null;
  nullified?: boolean;
}

export interface CourseDetail {
  segment_details: SegmentDetail[];
  start_time: string;
  end_time: string;
  elapsed_time: string;
  moving_time: string;
  down_time: string;
  sleep_time: string;
  adjustment_time: string;
  start_distance: number;
  distance: number;
  adjustment_time_hours: number;
  elapsed_time_hours: number;
  down_time_hours: number;
  moving_time_hours: number;
  sleep_time_hours: number;
  transit_time_hours: number;
}
