import type {
  CourseForm,
  CoursePayload,
  SegmentPayload,
  SplitPayload,
  RestStopPayload,
  SplitForm,
  SegmentForm,
  DayHoursEntry,
} from "./types";
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

function serializeSplit(split: SplitForm): SplitPayload {
  const payload: SplitPayload = {
    distance: parseFloat(split.distance),
    sub_split_mode: split.sub_split_mode,
    adjustment_time: minutesToSeconds(split.adjustment_time) ?? 0,
  };

  if (split.sub_split_mode === "even") {
    payload.sub_split_count = parseInt(split.sub_split_count, 10);
  } else if (split.sub_split_mode === "fixed") {
    payload.sub_split_distance = parseFloat(split.sub_split_distance);
    payload.last_sub_split_threshold = parseFloat(
      split.last_sub_split_threshold,
    );
  } else if (split.sub_split_mode === "custom") {
    payload.sub_split_distances = split.sub_split_distances
      .split(",")
      .map((s) => parseFloat(s.trim()));
  }

  const restStop = serializeRestStop(split);
  if (restStop) payload.rest_stop = restStop;

  const downTime = minutesToSeconds(split.down_time);
  if (downTime !== undefined) payload.down_time = downTime;

  const speed = parseOptionalFloat(split.moving_speed);
  if (speed !== null) payload.moving_speed = speed;

  return payload;
}

function serializeSegment(seg: SegmentForm): SegmentPayload {
  const payload: SegmentPayload = {
    splits: seg.splits.map(serializeSplit),
    sleep_time: minutesToSeconds(seg.sleep_time) ?? 0,
    no_end_down_time: !seg.include_end_down_time,
  };

  const dtr = parseOptionalFloat(seg.down_time_ratio);
  if (dtr !== null) payload.down_time_ratio = dtr;

  const sd = parseOptionalFloat(seg.split_decay);
  if (sd !== null) payload.split_decay = sd;

  const ms = parseOptionalFloat(seg.moving_speed);
  if (ms !== null) payload.moving_speed = ms;

  const mms = parseOptionalFloat(seg.min_moving_speed);
  if (mms !== null) payload.min_moving_speed = mms;

  return payload;
}

export function serializeCourse(form: CourseForm): CoursePayload {
  return {
    segments: form.segments.map(serializeSegment),
    mode: form.mode,
    init_moving_speed: parseFloat(form.init_moving_speed),
    min_moving_speed: parseFloat(form.min_moving_speed),
    down_time_ratio: parseFloat(form.down_time_ratio),
    split_decay: parseFloat(form.split_decay),
    start_time: new Date(form.start_time).toISOString(),
  };
}
