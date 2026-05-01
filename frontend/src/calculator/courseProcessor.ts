/**
 * Client-side port of the Python pacing calculator.
 *
 * Input:  CoursePayload  (the same object that was previously sent to the API)
 * Output: CourseDetail   (the same shape that ResultsView already consumes)
 *
 * All duration arithmetic is done in milliseconds. The *_hours fields are
 * derived from that. The string duration fields (moving_time, down_time, …)
 * are human-readable summaries used only by the raw-JSON panel.
 */

import type {
  CoursePayload,
  SegmentPayload,
  SplitPayload,
  CourseDetail,
  SegmentDetail,
  SplitDetail,
  SubSplitDetail,
} from "../types";
import { computeSubSplitDistances } from "./subSplitMode";

// ── Duration helpers ────────────────────────────────────────────────────────

function msToHours(ms: number): number {
  return ms / 3_600_000;
}

/** Produce a compact human-readable duration string from a number of seconds. */
function secondsToString(totalSeconds: number): string {
  const sign = totalSeconds < 0 ? "-" : "";
  const s = Math.abs(Math.round(totalSeconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  parts.push(`${h}h`);
  parts.push(`${m}m`);
  parts.push(`${sec}s`);
  return sign + parts.join(" ");
}

// ── Validation (mirrors course_service.py / course_processor.py) ────────────

export class CalcError extends Error {
  readonly validationErrors: string[];
  constructor(message: string, validationErrors: string[] = []) {
    super(message);
    this.name = "CalcError";
    this.validationErrors = validationErrors;
  }
}

function validatePayload(payload: CoursePayload): string[] {
  const errors: string[] = [];

  const isValidHttpUrl = (value: string): boolean => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  };

  if (payload.down_time_ratio < 0 || payload.down_time_ratio > 1) {
    errors.push(
      `Invalid down_time_ratio '${payload.down_time_ratio}'. Must be between 0 and 1.`,
    );
  }
  if (payload.init_moving_speed <= 0) {
    errors.push(
      `Invalid init_moving_speed '${payload.init_moving_speed}'. Must be > 0.`,
    );
  }
  if (payload.min_moving_speed <= 0) {
    errors.push(
      `Invalid min_moving_speed '${payload.min_moving_speed}'. Must be > 0.`,
    );
  }
  if (payload.init_moving_speed < payload.min_moving_speed) {
    errors.push(
      `init_moving_speed (${payload.init_moving_speed}) is less than min_moving_speed (${payload.min_moving_speed}).`,
    );
  }

  for (let i = 0; i < payload.segments.length; i++) {
    const seg = payload.segments[i];
    if (seg.splits.length === 0) {
      errors.push("Each segment must have at least one split.");
    }

    if (seg.nullified) {
      if (seg.down_time_ratio != null) {
        errors.push(
          `Segment ${i} is nullified (transit): down_time_ratio is not used.`,
        );
      }
      if (seg.split_delta != null) {
        errors.push(
          `Segment ${i} is nullified (transit): split_delta is not used.`,
        );
      }
      if (seg.moving_speed != null) {
        errors.push(
          `Segment ${i} is nullified (transit): moving_speed override is not used.`,
        );
      }
      if (seg.min_moving_speed != null) {
        errors.push(
          `Segment ${i} is nullified (transit): min_moving_speed override is not used.`,
        );
      }

      if (
        seg.fixed_elapsed_time_seconds == null ||
        seg.fixed_elapsed_time_seconds <= 0
      ) {
        errors.push(
          `Segment ${i} is marked as nullified (transit) but has no valid fixed_elapsed_time_seconds set.`,
        );
      }

      if (seg.splits.length !== 1) {
        errors.push(
          `Segment ${i} is marked as nullified (transit) and must contain exactly one split.`,
        );
        continue;
      }

      const split = seg.splits[0];
      if (split.distance <= 0) {
        errors.push(
          `Segment ${i} transit split distance must be greater than 0.`,
        );
      }
      if (split.down_time != null) {
        errors.push(`Segment ${i} transit split cannot set down_time.`);
      }
      if (split.moving_speed != null) {
        errors.push(`Segment ${i} transit split cannot set moving_speed.`);
      }
      if (split.adjustment_time != null && split.adjustment_time !== 0) {
        errors.push(
          `Segment ${i} transit split cannot set non-zero adjustment_time.`,
        );
      }
      if (
        split.sub_split_count != null ||
        split.sub_split_distance != null ||
        split.last_sub_split_threshold != null ||
        split.sub_split_distances != null
      ) {
        errors.push(
          `Segment ${i} transit split cannot set sub-split overrides.`,
        );
      }

      if (split.rest_stop != null) {
        if (!split.rest_stop.name?.trim()) {
          errors.push(`Rest stop (segment ${i}, split 0) must include a name.`);
        }
        if (!split.rest_stop.address?.trim()) {
          errors.push(
            `Rest stop (segment ${i}, split 0) must include an address.`,
          );
        }
        if (
          split.rest_stop.alt != null &&
          split.rest_stop.alt.trim() !== "" &&
          !isValidHttpUrl(split.rest_stop.alt)
        ) {
          errors.push(
            `Rest stop (segment ${i}, split 0) alt must be a valid http/https URL when provided.`,
          );
        }

        const openHours = split.rest_stop.open_hours ?? {};
        const hasFixed = Object.prototype.hasOwnProperty.call(
          openHours,
          "fixed",
        );
        if (hasFixed && Object.keys(openHours).length > 1) {
          errors.push(
            `Rest stop (segment ${i}, split 0) has 'fixed' open hours plus other keys, which is invalid.`,
          );
        } else if (!hasFixed && Object.keys(openHours).length !== 7) {
          errors.push(
            `Rest stop (segment ${i}, split 0) open hours must have keys 0-6 or only 'fixed'.`,
          );
        }
      }
    }
  }

  if (payload.mode === "target_distance") {
    let lastDist = 0;
    for (let si = 0; si < payload.segments.length; si++) {
      for (let sj = 0; sj < payload.segments[si].splits.length; sj++) {
        const d = payload.segments[si].splits[sj].distance;
        if (d <= lastDist) {
          errors.push(
            `In target_distance mode, split distances must be strictly increasing ` +
              `(segment ${si}, split ${sj}: ${d} <= ${lastDist}).`,
          );
        }
        lastDist = d;
      }
    }
  }

  return errors;
}

// ── Normalization (mirrors __normalize_course) ──────────────────────────────

/**
 * In TARGET_DISTANCE mode the split distances are absolute course markers.
 * Convert them to per-split segment distances so the rest of the calculator
 * can treat every course as mode="distance".
 */
function normalizeSplitDistances(payload: CoursePayload): CoursePayload {
  if (payload.mode === "distance") return payload;

  let offset = 0;
  const normalizedSegments: SegmentPayload[] = payload.segments.map((seg) => {
    const markers = [offset, ...seg.splits.map((s) => s.distance)];
    const newSplits: SplitPayload[] = seg.splits.map((split, i) => ({
      ...split,
      distance: markers[i + 1] - markers[i],
    }));
    offset = seg.splits[seg.splits.length - 1].distance;
    return { ...seg, splits: newSplits };
  });

  return { ...payload, mode: "distance", segments: normalizedSegments };
}

// ── Sub-split computation ───────────────────────────────────────────────────

function computeSubSplitDetails(
  split: SplitPayload,
  splitDownTimeMs: number,
  startTimeMs: number,
  movingSpeed: number,
  startDistance: number,
): SubSplitDetail[] {
  // Compute pace (dist/elapsed-hour) for the "hour" sub-split mode so that
  // boundaries fall on wall-clock hour marks, not pure moving-time hours.
  const _movingMs = (split.distance / movingSpeed) * 3_600_000;
  const _effectiveDtr = _movingMs > 0 ? splitDownTimeMs / _movingMs : 0;
  const subDistances = computeSubSplitDistances(
    split,
    movingSpeed,
    _effectiveDtr,
  );
  let downPerSubMs =
    splitDownTimeMs !== 0 ? splitDownTimeMs / subDistances.length : 0;

  const result: SubSplitDetail[] = [];
  let currTimeMs = startTimeMs;
  let currDist = startDistance;
  let remainingDownTimeMs = splitDownTimeMs;

  for (const subDist of subDistances) {
    const movingMs = (subDist / movingSpeed) * 3_600_000;

    if (split.sub_split_mode === "hour") {
      // each sub-split's moving and down time should sum to exactly one elapsed hour by definition, so override any floating-point imprecision
      downPerSubMs = 3_600_000 - movingMs;

      // Case 1: we have less down time allotted to complete the hour
      if (remainingDownTimeMs > 0 && remainingDownTimeMs - downPerSubMs < 0) {
        downPerSubMs = remainingDownTimeMs;
      }
      // if remaining is negative we are in case 2 territory and just set downPerSubMs to 0, but we also need to make sure to not add negative down time if we had some leftover from the previous sub-split
      if (remainingDownTimeMs <= 0) {
        downPerSubMs = 0;
        remainingDownTimeMs = 0;
      }
      remainingDownTimeMs -= downPerSubMs;
    }
    const activeMs = movingMs + downPerSubMs;

    result.push({
      distance: subDist,
      start_time: new Date(currTimeMs).toISOString(),
      end_time: new Date(currTimeMs + activeMs).toISOString(),
      moving_speed: movingSpeed,
      moving_time: secondsToString(movingMs / 1000),
      down_time: secondsToString(downPerSubMs / 1000),
      split_time: secondsToString(activeMs / 1000),
      active_time: secondsToString(activeMs / 1000), // no adjustment on sub-splits
      pace: subDist / msToHours(activeMs),
      start_distance: currDist,
      span: [currDist, currDist + subDist],
      moving_time_hours: msToHours(movingMs),
      down_time_hours: msToHours(downPerSubMs),
      active_time_hours: msToHours(activeMs),
    });

    currTimeMs += activeMs;
    currDist += subDist;
  }

  return result;
}

// ── Split computation ───────────────────────────────────────────────────────

interface SplitResult {
  detail: SplitDetail;
  movingMs: number;
  downMs: number;
  adjustMs: number;
  activeMs: number;
}

function computeSplitDetail(
  split: SplitPayload,
  splitIndex: number,
  totalSplitsInSegment: number,
  startTimeMs: number,
  movingSpeed: number,
  downTimeRatio: number,
  noEndDownTime: boolean,
  startDistance: number,
  startTz: string | null,
): SplitResult {
  const movingMs = (split.distance / movingSpeed) * 3_600_000;

  // Compute down time: ratio-based, then override if split specifies it explicitly
  let downMs = movingMs * downTimeRatio;
  if (split.down_time != null) {
    downMs = split.down_time * 1000;
  }
  // Last split of segment with no_end_down_time suppresses down time
  if (splitIndex === totalSplitsInSegment - 1 && noEndDownTime) {
    downMs = 0;
  }

  const splitMs = movingMs + downMs;
  const adjustMs = (split.adjustment_time ?? 0) * 1000;
  const activeMs = splitMs + adjustMs;

  const adjustmentStartMs = startTimeMs + splitMs;
  const endTimeMs = startTimeMs + activeMs;

  const subSplits = computeSubSplitDetails(
    split,
    downMs,
    startTimeMs,
    movingSpeed,
    startDistance,
  );

  const detail: SplitDetail = {
    name: split.name ?? null,
    start_timezone: startTz,
    end_timezone: split.end_timezone ?? null,
    distance: split.distance,
    start_time: new Date(startTimeMs).toISOString(),
    end_time: new Date(endTimeMs).toISOString(),
    moving_speed: movingSpeed,
    moving_time: secondsToString(movingMs / 1000),
    down_time: secondsToString(downMs / 1000),
    split_time: secondsToString(splitMs / 1000),
    active_time: secondsToString(activeMs / 1000),
    pace: split.distance / msToHours(activeMs),
    start_distance: startDistance,
    span: [startDistance, startDistance + split.distance],
    moving_time_hours: msToHours(movingMs),
    down_time_hours: msToHours(downMs),
    active_time_hours: msToHours(activeMs),
    sub_splits: subSplits,
    adjustment_start: new Date(adjustmentStartMs).toISOString(),
    adjustment_time: secondsToString(adjustMs / 1000),
    adjustment_time_hours: msToHours(adjustMs),
    rest_stop: split.rest_stop
      ? {
          name: split.rest_stop.name,
          address: split.rest_stop.address,
          alt: split.rest_stop.alt ?? null,
        }
      : null,
  };

  return { detail, movingMs, downMs, adjustMs, activeMs };
}

// ── Segment computation ─────────────────────────────────────────────────────

function computeSegmentDetail(
  seg: SegmentPayload,
  startTimeMs: number,
  movingSpeed: number,
  minMovingSpeed: number,
  downTimeRatio: number,
  splitDelta: number,
  startDistance: number,
  startTz: string | null,
): { segDetail: SegmentDetail; endTz: string | null } {
  // ── Nullified (transit) segment: fixed elapsed time, no pace calculation ──
  if (seg.nullified && seg.fixed_elapsed_time_seconds != null) {
    const activeMs = seg.fixed_elapsed_time_seconds * 1000;
    const split = seg.splits[0];
    const splitDist = split?.distance ?? 0;
    const endTimeMs = startTimeMs + activeMs;
    const sleepMs = (seg.sleep_time ?? 0) * 1000;
    const elapsedMs = activeMs + sleepMs;
    const paceVal =
      splitDist > 0 && activeMs > 0 ? splitDist / msToHours(activeMs) : 0;
    const endTz = split?.end_timezone ?? startTz;

    const splitDetail: SplitDetail = {
      name: split?.name ?? null,
      start_timezone: startTz,
      end_timezone: endTz,
      distance: splitDist,
      start_time: new Date(startTimeMs).toISOString(),
      end_time: new Date(endTimeMs).toISOString(),
      moving_speed: movingSpeed,
      moving_time: secondsToString(0),
      down_time: secondsToString(0),
      split_time: secondsToString(0),
      active_time: secondsToString(activeMs / 1000),
      pace: paceVal,
      start_distance: startDistance,
      span: [startDistance, startDistance + splitDist],
      moving_time_hours: 0,
      down_time_hours: 0,
      active_time_hours: msToHours(activeMs),
      sub_splits: [],
      adjustment_start: new Date(startTimeMs).toISOString(),
      adjustment_time: secondsToString(0),
      adjustment_time_hours: 0,
      rest_stop: null,
    };

    return {
      segDetail: {
        split_details: [splitDetail],
        start_time: new Date(startTimeMs).toISOString(),
        end_time: new Date(endTimeMs).toISOString(),
        end_moving_speed: movingSpeed,
        distance: splitDist,
        start_distance: startDistance,
        moving_time: secondsToString(0),
        down_time: secondsToString(0),
        sleep_time: secondsToString(sleepMs / 1000),
        adjustment_time: secondsToString(0),
        elapsed_time: secondsToString(elapsedMs / 1000),
        active_time: secondsToString(activeMs / 1000),
        span: [startDistance, startDistance + splitDist],
        pace: paceVal,
        moving_time_hours: 0,
        down_time_hours: 0,
        adjustment_time_hours: 0,
        elapsed_time_hours: msToHours(elapsedMs),
        active_time_hours: msToHours(activeMs),
        sleep_time_hours: msToHours(sleepMs),
        moving_speed: null,
        adjustment_start: null,
        name: seg.name ?? null,
        nullified: true,
      },
      endTz,
    };
  }

  // Apply segment-level overrides
  let currSpeed = seg.moving_speed ?? movingSpeed;
  const currMin = seg.min_moving_speed ?? minMovingSpeed;
  const currDtr = seg.down_time_ratio ?? downTimeRatio;
  const currDelta = seg.split_delta ?? splitDelta;

  // Only error if the segment explicitly sets a moving speed below its minimum.
  // When speed is inherited from a previous segment's decay, clamp it up instead.
  if (seg.moving_speed != null && currSpeed < currMin) {
    throw new CalcError(
      `Segment moving speed (${currSpeed}) is less than minimum moving speed (${currMin}).`,
    );
  }
  currSpeed = Math.max(currSpeed, currMin);

  const splitDetails: SplitDetail[] = [];
  let currTimeMs = startTimeMs;
  let currDist = startDistance;
  let totalMovingMs = 0;
  let totalDownMs = 0;
  let totalAdjustMs = 0;
  let currTz = startTz;

  for (let i = 0; i < seg.splits.length; i++) {
    const split = seg.splits[i];

    // Split-level speed override mutates currSpeed (affecting subsequent decay)
    if (split.moving_speed != null) {
      currSpeed = split.moving_speed;
    }

    const { detail, movingMs, downMs, adjustMs, activeMs } = computeSplitDetail(
      split,
      i,
      seg.splits.length,
      currTimeMs,
      currSpeed,
      currDtr,
      seg.no_end_down_time,
      currDist,
      currTz,
    );

    splitDetails.push(detail);
    totalMovingMs += movingMs;
    totalDownMs += downMs;
    totalAdjustMs += adjustMs;
    currDist += split.distance;
    currTimeMs += activeMs;
    // Advance current tz: if this split defines an endpoint tz, use it going forward
    if (split.end_timezone) currTz = split.end_timezone;

    // Apply speed delta for the next split, clamped to min
    currSpeed = Math.max(currSpeed + currDelta, currMin);
  }

  const activeMs = currTimeMs - startTimeMs;
  const sleepMs = (seg.sleep_time ?? 0) * 1000;
  const elapsedMs = activeMs + sleepMs;
  const segDist = currDist - startDistance;

  return {
    segDetail: {
      split_details: splitDetails,
      start_time: new Date(startTimeMs).toISOString(),
      end_time: new Date(currTimeMs).toISOString(),
      end_moving_speed: currSpeed,
      distance: segDist,
      start_distance: startDistance,
      moving_time: secondsToString(totalMovingMs / 1000),
      down_time: secondsToString(totalDownMs / 1000),
      sleep_time: secondsToString(sleepMs / 1000),
      adjustment_time: secondsToString(totalAdjustMs / 1000),
      elapsed_time: secondsToString(elapsedMs / 1000),
      active_time: secondsToString(activeMs / 1000),
      span: [startDistance, currDist],
      pace: segDist / msToHours(activeMs),
      moving_time_hours: msToHours(totalMovingMs),
      down_time_hours: msToHours(totalDownMs),
      adjustment_time_hours: msToHours(totalAdjustMs),
      elapsed_time_hours: msToHours(elapsedMs),
      active_time_hours: msToHours(activeMs),
      sleep_time_hours: msToHours(sleepMs),
      moving_speed: null,
      adjustment_start: null,
      name: seg.name ?? null,
    },
    endTz: currTz,
  };
}

// ── Course computation (main entry point) ───────────────────────────────────

/**
 * Compute a full CourseDetail from a CoursePayload.
 *
 * This is a client-side port of the Python `process_course` function and
 * produces an object with exactly the same shape as the API response so that
 * ResultsView can consume it without modification.
 *
 * Throws CalcError on validation failure or invalid segment configuration.
 */
export function processCourse(payload: CoursePayload): CourseDetail {
  const errors = validatePayload(payload);
  if (errors.length > 0) {
    throw new CalcError("Validation failed", errors);
  }

  const normalized = normalizeSplitDistances(payload);
  const startMs = new Date(normalized.start_time).getTime();

  let currTimeMs = startMs;
  let currSpeed = normalized.init_moving_speed;
  let currDist = 0;
  const segmentDetails: SegmentDetail[] = [];
  let totalMovingMs = 0;
  let totalDownMs = 0;
  let totalAdjustMs = 0;
  let totalSleepMs = 0;
  let totalTransitMs = 0;
  let currTz: string | null = normalized.course_timezone ?? null;

  for (const seg of normalized.segments) {
    const { segDetail, endTz } = computeSegmentDetail(
      seg,
      currTimeMs,
      currSpeed,
      normalized.min_moving_speed,
      normalized.down_time_ratio,
      normalized.split_delta,
      currDist,
      currTz,
    );

    segmentDetails.push(segDetail);

    totalMovingMs += segDetail.moving_time_hours * 3_600_000;
    totalDownMs += segDetail.down_time_hours * 3_600_000;
    totalAdjustMs += (segDetail.adjustment_time_hours ?? 0) * 3_600_000;
    if (seg.nullified && seg.fixed_elapsed_time_seconds != null) {
      totalTransitMs += seg.fixed_elapsed_time_seconds * 1000;
    }

    const sleepMs = (seg.sleep_time ?? 0) * 1000;
    totalSleepMs += sleepMs;

    currSpeed = segDetail.end_moving_speed;
    currDist += segDetail.distance;
    currTz = endTz;
    // Advance time past the segment, then add sleep before next segment starts
    currTimeMs = new Date(segDetail.end_time).getTime() + sleepMs;
  }

  const endMs = currTimeMs;
  const elapsedMs = endMs - startMs;

  return {
    segment_details: segmentDetails,
    start_time: new Date(startMs).toISOString(),
    end_time: new Date(endMs).toISOString(),
    elapsed_time: secondsToString(elapsedMs / 1000),
    moving_time: secondsToString(totalMovingMs / 1000),
    down_time: secondsToString(totalDownMs / 1000),
    sleep_time: secondsToString(totalSleepMs / 1000),
    adjustment_time: secondsToString(totalAdjustMs / 1000),
    start_distance: 0,
    distance: currDist,
    adjustment_time_hours: msToHours(totalAdjustMs),
    elapsed_time_hours: msToHours(elapsedMs),
    down_time_hours: msToHours(totalDownMs),
    moving_time_hours: msToHours(totalMovingMs),
    sleep_time_hours: msToHours(totalSleepMs),
    transit_time_hours: msToHours(totalTransitMs),
  };
}
