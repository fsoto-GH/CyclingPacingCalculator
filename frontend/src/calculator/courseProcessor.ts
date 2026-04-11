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

  for (const seg of payload.segments) {
    if (seg.splits.length === 0) {
      errors.push("Each segment must have at least one split.");
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
  const subDistances = computeSubSplitDistances(split);
  const downPerSubMs =
    splitDownTimeMs !== 0 ? splitDownTimeMs / subDistances.length : 0;

  const result: SubSplitDetail[] = [];
  let currTimeMs = startTimeMs;
  let currDist = startDistance;

  for (const subDist of subDistances) {
    const movingMs = (subDist / movingSpeed) * 3_600_000;
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
          arrival_date: new Date(endTimeMs).toISOString(),
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
): SegmentDetail {
  // Apply segment-level overrides
  let currSpeed = seg.moving_speed ?? movingSpeed;
  const currMin = seg.min_moving_speed ?? minMovingSpeed;
  const currDtr = seg.down_time_ratio ?? downTimeRatio;
  const currDelta = seg.split_delta ?? splitDelta;

  if (currSpeed < currMin) {
    throw new CalcError(
      `Segment moving speed (${currSpeed}) is less than minimum moving speed (${currMin}).`,
    );
  }

  const splitDetails: SplitDetail[] = [];
  let currTimeMs = startTimeMs;
  let currDist = startDistance;
  let totalMovingMs = 0;
  let totalDownMs = 0;
  let totalAdjustMs = 0;

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
    );

    splitDetails.push(detail);
    totalMovingMs += movingMs;
    totalDownMs += downMs;
    totalAdjustMs += adjustMs;
    currDist += split.distance;
    currTimeMs += activeMs;

    // Apply speed delta for the next split, clamped to min
    currSpeed = Math.max(currSpeed + currDelta, currMin);
  }

  const activeMs = currTimeMs - startTimeMs;
  const sleepMs = (seg.sleep_time ?? 0) * 1000;
  const elapsedMs = activeMs + sleepMs;
  const segDist = currDist - startDistance;

  return {
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

  for (const seg of normalized.segments) {
    const segDetail = computeSegmentDetail(
      seg,
      currTimeMs,
      currSpeed,
      normalized.min_moving_speed,
      normalized.down_time_ratio,
      normalized.split_delta,
      currDist,
    );

    segmentDetails.push(segDetail);

    totalMovingMs += segDetail.moving_time_hours * 3_600_000;
    totalDownMs += segDetail.down_time_hours * 3_600_000;
    totalAdjustMs += (segDetail.adjustment_time_hours ?? 0) * 3_600_000;

    const sleepMs = (seg.sleep_time ?? 0) * 1000;
    totalSleepMs += sleepMs;

    currSpeed = segDetail.end_moving_speed;
    currDist += segDetail.distance;
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
  };
}
