import { describe, expect, it } from "vitest";
import { processCourse } from "./courseProcessor";
import type { CoursePayload, SplitPayload } from "../types";

// ── helpers ──────────────────────────────────────────────────────────────────

const START = "2026-01-01T00:00:00.000Z";

/** Build a minimal single-segment CoursePayload from a list of split overrides. */
function makeCourse(splits: Partial<SplitPayload>[]): CoursePayload {
  return {
    mode: "distance",
    init_moving_speed: 10,
    min_moving_speed: 5,
    down_time_ratio: 0,
    split_delta: 0,
    start_time: START,
    segments: [
      {
        no_end_down_time: false,
        splits: splits.map((s) => ({
          distance: 10,
          sub_split_mode: "even" as const,
          adjustment_time: 0,
          ...s,
        })),
      },
    ],
  };
}

/** Add `seconds` to an ISO string, return ISO string. */
function addSeconds(iso: string, seconds: number): string {
  return new Date(new Date(iso).getTime() + seconds * 1000).toISOString();
}

function splitAt(index = 0) {
  return processCourse(makeCourse([{}])).segment_details[0].split_details[
    index
  ];
}

// ── adjustment_start vs end_time ──────────────────────────────────────────────

describe("adjustment_start and end_time semantics", () => {
  it("adjustment_start equals start_time + moving_time + down_time (no adj)", () => {
    // speed=10, dist=10, dtr=0 → moving = 1 h; adj = 1 h
    // adjustment_start should be start + 1h regardless of adj time
    const result = processCourse(
      makeCourse([{ distance: 10, adjustment_time: 3600 }]),
    );
    const split = result.segment_details[0].split_details[0];

    const expectedAdjStart = addSeconds(START, 3600); // +1 h moving
    expect(split.adjustment_start).toBe(expectedAdjStart);
  });

  it("end_time equals adjustment_start + adjustment_time", () => {
    const adjSeconds = 3600;
    const result = processCourse(
      makeCourse([{ distance: 10, adjustment_time: adjSeconds }]),
    );
    const split = result.segment_details[0].split_details[0];

    const expectedEnd = addSeconds(split.adjustment_start, adjSeconds);
    expect(split.end_time).toBe(expectedEnd);
  });

  it("adjustment_time_hours equals adjustment_time / 3600", () => {
    const adjSeconds = 5400; // 1.5 h
    const result = processCourse(
      makeCourse([{ distance: 10, adjustment_time: adjSeconds }]),
    );
    const split = result.segment_details[0].split_details[0];

    expect(split.adjustment_time_hours).toBeCloseTo(1.5, 6);
  });

  it("adjustment_start equals end_time when adjustment_time is 0", () => {
    const split = splitAt();
    expect(split.adjustment_start).toBe(split.end_time);
  });

  it("adjustment_start equals end_time when adjustment_time is omitted", () => {
    const result = processCourse(
      makeCourse([{ distance: 10, adjustment_time: undefined }]),
    );
    const split = result.segment_details[0].split_details[0];
    expect(split.adjustment_start).toBe(split.end_time);
  });

  it("adjustment_start includes down_time but not adjustment_time", () => {
    // speed=10, dist=10, dtr=0.5 → moving=1h, down=0.5h, split_time=1.5h
    // adj=1h → end_time = start + 2.5h
    const result = processCourse(
      makeCourse([{ distance: 10, adjustment_time: 3600, down_time: 1800 }]),
    );
    const split = result.segment_details[0].split_details[0];

    // adjustment_start = start + moving(1h) + down(0.5h) = start + 5400s
    const expectedAdjStart = addSeconds(START, 1800 + 3600); // moving(1h) + down(0.5h)
    expect(split.adjustment_start).toBe(expectedAdjStart);

    // end_time = adjustment_start + adj(1h)
    const expectedEnd = addSeconds(expectedAdjStart, 3600);
    expect(split.end_time).toBe(expectedEnd);
  });
});

// ── multi-split propagation ───────────────────────────────────────────────────

describe("adjustment time propagates into next split start", () => {
  it("second split start_time equals first split end_time", () => {
    // Split A: dist=10, speed=10, dtr=0, adj=3600 → end = start + 2h
    // Split B: dist=10, speed=10, dtr=0, adj=0    → start should be start + 2h
    const result = processCourse(
      makeCourse([
        { distance: 10, adjustment_time: 3600 },
        { distance: 10, adjustment_time: 0 },
      ]),
    );
    const splits = result.segment_details[0].split_details;
    expect(splits[1].start_time).toBe(splits[0].end_time);
  });

  it("second split end_time is independent of first split adjustment_time when its own adj is 0", () => {
    // With adj on first split the second split still has its own moving_time only
    const result = processCourse(
      makeCourse([
        { distance: 10, adjustment_time: 3600 },
        { distance: 10, adjustment_time: 0 },
      ]),
    );
    const splits = result.segment_details[0].split_details;
    // split B: start = splits[0].end_time, moving = 1h, adj = 0
    // → end_time = splits[0].end_time + 1h
    const expectedEnd = addSeconds(splits[1].start_time, 3600);
    expect(splits[1].end_time).toBe(expectedEnd);
    // split B has no adj so adjustment_start === end_time
    expect(splits[1].adjustment_start).toBe(splits[1].end_time);
  });
});

// ── adjustment_time_hours zero cases ─────────────────────────────────────────

describe("adjustment_time_hours edge cases", () => {
  it("is 0 when adjustment_time is 0", () => {
    const split = splitAt();
    expect(split.adjustment_time_hours).toBe(0);
  });

  it("is 0 when adjustment_time is undefined", () => {
    const result = processCourse(
      makeCourse([{ distance: 10, adjustment_time: undefined }]),
    );
    expect(
      result.segment_details[0].split_details[0].adjustment_time_hours,
    ).toBe(0);
  });
});
