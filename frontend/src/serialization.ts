import type {
  CourseForm,
  CoursePayload,
  SegmentPayload,
  SplitPayload,
  RestStopPayload,
  SplitForm,
  SegmentForm,
  DayHoursEntry,
  SubSplitMode,
} from "./types";
import { tzLocalStringToUtcIso } from "./utils";
import { minutesToSeconds, parseOptionalFloat } from "./utils";

/** Convert HH:MM (24h) to 12h "hh:mm AM/PM" string. */
function to12h(time24: string): string {
  const [hStr, mStr] = time24.split(":");
  let h = parseInt(hStr, 10);
  const ampm = h >= 12 ? "PM" : "AM";
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h.toString().padStart(2, "0")}:${mStr} ${ampm}`;
}

/** Serialize a DayHoursEntry to the API's string format. */
function entryToString(entry: DayHoursEntry): string {
  if (entry.mode === "24h") return "24h";
  if (entry.mode === "closed") return "Closed";
  return `${to12h(entry.opens)} to ${to12h(entry.closes)}`;
}

function serializeRestStop(split: SplitForm): RestStopPayload | null {
  const rs = split.rest_stop;
  if (!rs.enabled) return null;

  const openHours: Record<string, string> = {};
  if (rs.sameHoursEveryDay) {
    openHours["fixed"] = entryToString(rs.allDays);
  } else {
    for (let i = 0; i < 7; i++) {
      openHours[String(i)] = entryToString(rs.perDay[i]);
    }
  }

  return {
    name: rs.name,
    address: rs.address,
    alt: rs.alt || null,
    open_hours: openHours,
  };
}

interface CourseSubSplitDefaults {
  sub_split_mode: SubSplitMode;
  sub_split_count?: string;
  sub_split_distance?: string;
  last_sub_split_threshold?: string;
  sub_split_distances?: string;
}

function serializeSplit(
  split: SplitForm,
  courseDefaults: CourseSubSplitDefaults,
): SplitPayload {
  const effectiveMode: SubSplitMode = split.sub_split_override
    ? split.sub_split_mode
    : courseDefaults.sub_split_mode;
  const effectiveCount = split.sub_split_override
    ? split.sub_split_count
    : (courseDefaults.sub_split_count ?? "1");
  const effectiveDistance = split.sub_split_override
    ? split.sub_split_distance
    : (courseDefaults.sub_split_distance ?? "");
  const effectiveThreshold = split.sub_split_override
    ? split.last_sub_split_threshold
    : (courseDefaults.last_sub_split_threshold ?? "20");
  const effectiveDistances = split.sub_split_override
    ? split.sub_split_distances
    : (courseDefaults.sub_split_distances ?? "");

  const payload: SplitPayload = {
    name: split.name?.trim() || null,
    distance: parseFloat(split.distance),
    sub_split_mode: effectiveMode,
    adjustment_time: minutesToSeconds(split.adjustment_time) ?? 0,
  };

  if (effectiveMode === "even") {
    payload.sub_split_count = parseInt(effectiveCount, 10);
  } else if (effectiveMode === "fixed") {
    payload.sub_split_distance = parseFloat(effectiveDistance);
    payload.last_sub_split_threshold = parseFloat(effectiveThreshold);
  } else if (effectiveMode === "custom") {
    payload.sub_split_distances = effectiveDistances
      .split(",")
      .map((s) => parseFloat(s.trim()));
  }

  const restStop = serializeRestStop(split);
  if (restStop) payload.rest_stop = restStop;

  const downTime = minutesToSeconds(split.down_time);
  if (downTime !== undefined) payload.down_time = downTime;

  const speed = parseOptionalFloat(split.moving_speed);
  if (speed !== null) payload.moving_speed = speed;

  if (split.differentTimezone && split.timezone) {
    payload.end_timezone = split.timezone;
  }

  return payload;
}

function serializeSegment(
  seg: SegmentForm,
  courseDefaults: CourseSubSplitDefaults,
): SegmentPayload {
  const payload: SegmentPayload = {
    name: seg.name?.trim() || null,
    splits: seg.splits.map((s) => serializeSplit(s, courseDefaults)),
    sleep_time: minutesToSeconds(seg.sleep_time) ?? 0,
    no_end_down_time: !seg.include_end_down_time,
  };

  const dtr = parseOptionalFloat(seg.down_time_ratio);
  if (dtr !== null) payload.down_time_ratio = dtr;

  const sd = parseOptionalFloat(seg.split_delta);
  if (sd !== null) payload.split_delta = sd;

  const ms = parseOptionalFloat(seg.moving_speed);
  if (ms !== null) payload.moving_speed = ms;

  const mms = parseOptionalFloat(seg.min_moving_speed);
  if (mms !== null) payload.min_moving_speed = mms;

  return payload;
}

export function serializeCourse(form: CourseForm): CoursePayload {
  const courseDefaults: CourseSubSplitDefaults = {
    sub_split_mode: form.sub_split_mode ?? "hour",
    sub_split_count: form.sub_split_count ?? "1",
    sub_split_distance: form.sub_split_distance ?? "",
    last_sub_split_threshold: form.last_sub_split_threshold ?? "20",
    sub_split_distances: form.sub_split_distances ?? "",
  };
  return {
    segments: form.segments.map((s) => serializeSegment(s, courseDefaults)),
    mode: form.mode,
    init_moving_speed: parseFloat(form.init_moving_speed),
    min_moving_speed: parseFloat(form.min_moving_speed),
    down_time_ratio: parseFloat(form.down_time_ratio),
    split_delta: parseFloat(form.split_delta),
    start_time: tzLocalStringToUtcIso(form.start_time, form.timezone),
    course_timezone: form.timezone,
  };
}
