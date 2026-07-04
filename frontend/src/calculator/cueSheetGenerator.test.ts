import { describe, expect, it } from "vitest";
import { formatArrivalTimeWithTz } from "../timeMath";
import type {
  CourseForm,
  CoursePayload,
  DayHoursEntry,
  SegmentForm,
  SplitForm,
} from "../types";
import { processCourse } from "./courseProcessor";
import {
  generateCueSheetHtml,
  generateRacePlanHtml,
  generateRacePlanText,
  type CueSheetData,
  type CueSheetOptions,
  type RacePlanOptions,
} from "./cueSheetGenerator";

const START = "2026-01-01T00:00:00.000Z";
const OPEN_24H: DayHoursEntry = {
  mode: "24h",
  opens: "00:00",
  closes: "24:00",
};

function everyDay(
  entry: DayHoursEntry,
): [
  DayHoursEntry,
  DayHoursEntry,
  DayHoursEntry,
  DayHoursEntry,
  DayHoursEntry,
  DayHoursEntry,
  DayHoursEntry,
] {
  return [entry, entry, entry, entry, entry, entry, entry];
}

function makeSplitForm(): SplitForm {
  return {
    name: "Checkpoint Split",
    distance: "10",
    sub_split_mode: "even",
    sub_split_count: "1",
    sub_split_distance: "",
    last_sub_split_threshold: "",
    sub_split_distances: "",
    rest_stop: {
      enabled: true,
      name: "Main Control",
      address: "",
      alt: "",
      sameHoursEveryDay: true,
      allDays: OPEN_24H,
      perDay: everyDay(OPEN_24H),
    },
    intermediate_stop: {
      enabled: false,
      distance: "",
      name: "",
      address: "",
      alt: "",
      sameHoursEveryDay: true,
      allDays: OPEN_24H,
      perDay: everyDay(OPEN_24H),
    },
    down_time: "30",
    moving_speed: "10",
    adjustment_time: "60",
    differentTimezone: false,
    timezone: "UTC",
    notes: "",
  };
}

function makeSegmentForm(): SegmentForm {
  return {
    name: "Segment 1",
    sleep_time: "0",
    include_end_down_time: true,
    down_time_ratio: "0",
    split_delta: "0",
    moving_speed: "10",
    min_moving_speed: "5",
    splitCount: "1",
    splits: [makeSplitForm()],
    fixed_elapsed_time: "0",
  };
}

function makeForm(): CourseForm {
  return {
    name: "Cue Sheet Test",
    unitSystem: "metric",
    mode: "distance",
    timezone: "UTC",
    sub_split_mode: "even",
    sub_split_count: "1",
    sub_split_distance: "",
    last_sub_split_threshold: "",
    sub_split_distances: "",
    init_moving_speed: "10",
    min_moving_speed: "5",
    down_time_ratio: "0",
    split_delta: "0",
    start_time: START,
    segmentCount: "1",
    segments: [makeSegmentForm()],
  };
}

function makePayload(): CoursePayload {
  return {
    mode: "distance",
    init_moving_speed: 10,
    min_moving_speed: 5,
    down_time_ratio: 0,
    split_delta: 0,
    start_time: START,
    course_timezone: "UTC",
    segments: [
      {
        no_end_down_time: false,
        splits: [
          {
            name: "Checkpoint Split",
            distance: 10,
            sub_split_mode: "even",
            moving_speed: 10,
            down_time: 1800,
            adjustment_time: 3600,
            end_timezone: "UTC",
          },
        ],
      },
    ],
  };
}

function makeOptions(compact: boolean): CueSheetOptions {
  return {
    mileMarkerDirection: "from-start",
    includeSplitDistance: false,
    includeEta: true,
    includeNotes: false,
    compact,
    includeIntermediateStop: false,
    intermediateIncludeHours: false,
    intermediateIncludeEta: false,
    includeRestStop: true,
    restStopIncludeHours: false,
    restStopIncludeEta: true,
    includeControls: false,
    includeElevation: false,
    includeCoursePoints: false,
    selectedCueTypes: new Set<string>(),
    includePois: false,
    selectedPoiTypes: new Set<string>(),
    unitSystem: "metric",
  };
}

function makeData(): CueSheetData {
  const form = makeForm();
  const result = processCourse(makePayload());
  const split = result.segment_details[0].split_details[0];

  return {
    form,
    result,
    splitBoundariesKm: [[split.span]],
    gpxTrack: [],
    rwgpsCoursePoints: [],
    rwgpsPois: [],
    gpxProfiles: null,
    courseTz: "UTC",
  };
}

function makeRacePlanOptions(): RacePlanOptions {
  return {
    mileMarkerDirection: "from-start",
    includeTransitSplits: true,
    includeIntermediateStops: true,
    includeRestStopDetails: true,
    includeSplitNotes: false,
    unitSystem: "metric",
  };
}

function makeRacePlanOptionsWithUnit(
  unitSystem: "metric" | "imperial",
): RacePlanOptions {
  return {
    ...makeRacePlanOptions(),
    unitSystem,
  };
}

describe("generateCueSheetHtml timing labels", () => {
  it("uses arrival ETA for rest stops and labels split end time as depart by in table mode", () => {
    const data = makeData();
    const split = data.result.segment_details[0].split_details[0];
    const html = generateCueSheetHtml(makeOptions(false), data);

    const arrivalEta = formatArrivalTimeWithTz(split.adjustment_start, "UTC");
    const departBy = formatArrivalTimeWithTz(split.end_time, "UTC");

    expect(html).toContain("<th>Depart By</th>");
    expect(html).toContain(`ETA: ${arrivalEta}`);
    expect(html).toContain(departBy);
    expect(html).not.toContain(`ETA: ${departBy}`);
  });

  it("shows separate ETA and depart-by lines for rest stops in compact mode", () => {
    const data = makeData();
    const split = data.result.segment_details[0].split_details[0];
    const html = generateCueSheetHtml(makeOptions(true), data);

    const arrivalEta = formatArrivalTimeWithTz(split.adjustment_start, "UTC");
    const departBy = formatArrivalTimeWithTz(split.end_time, "UTC");

    expect(html).toContain(`ETA: ${arrivalEta}`);
    expect(html).toContain(`Depart By: ${departBy}`);
    expect(html).not.toContain(`ETA: ${departBy}`);
  });
});

describe("race plan export", () => {
  it("renders split/intermediate distance semantics and ETA adjustment in HTML", () => {
    const data = makeData();
    data.form.segments[0].splits[0].intermediate_stop.enabled = true;
    data.form.segments[0].splits[0].intermediate_stop.distance = "4";
    data.form.segments[0].splits[0].intermediate_stop.name = "Amoco";

    const html = generateRacePlanHtml(makeRacePlanOptions(), data);

    expect(html).toContain("0.0:");
    expect(html).toContain("4.0*:");
    expect(html).toContain("Distance: 10.0 (R 0.0)");
    expect(html).toContain("Distance: +4.0 (-6.0, R 6.0)");
    expect(html).toContain("<strong>+ 60 min</strong>");
    expect(html).toContain("Depart:");
  });

  it("renders plain text export with star marker and signed adjustment", () => {
    const data = makeData();
    data.form.segments[0].splits[0].intermediate_stop.enabled = true;
    data.form.segments[0].splits[0].intermediate_stop.distance = "4";
    data.form.segments[0].splits[0].intermediate_stop.name = "Amoco";

    const txt = generateRacePlanText(makeRacePlanOptions(), data);

    expect(txt).toContain("0.0: Checkpoint Split");
    expect(txt).toContain("4.0*: Amoco");
    expect(txt).toContain("Distance: 10.0 (R 0.0)");
    expect(txt).toContain("Distance: +4.0 (-6.0, R 6.0)");
    expect(txt).toContain("+ 60 min");
  });

  it("computes imperial remaining distance from marker boundaries", () => {
    const data = makeData();
    data.form.unitSystem = "imperial";
    data.form.mode = "distance";
    data.result.distance = 1116.9;
    data.splitBoundariesKm = [[[0, 1116.9 * 1.60934]]];
    data.form.segments[0].splits[0].name = "Chicago to Milwaukee";
    data.form.segments[0].splits[0].intermediate_stop.enabled = true;
    data.form.segments[0].splits[0].intermediate_stop.name = "Amoco";
    data.form.segments[0].splits[0].intermediate_stop.distance = "75.8";

    const txt = generateRacePlanText(
      makeRacePlanOptionsWithUnit("imperial"),
      data,
    );

    expect(txt).toContain("75.8*: Amoco");
    expect(txt).toContain("Distance: +75.8 (-1,041.1, R 1,041.1)");
  });
});
