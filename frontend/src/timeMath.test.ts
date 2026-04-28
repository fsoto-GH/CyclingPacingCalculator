import { describe, expect, it } from "vitest";
import type { DayHoursEntry, SegmentForm, SplitGpxProfile } from "./types";
import {
  buildSegmentTimezoneSequence,
  buildDetailedNearDetail,
  checkArrivalVsHoursDetailed,
  checkArrivalVsHoursSimple,
  formatRatioPercent,
  formatRawDualRatio,
  formatRawRatio,
  getSegmentTimezoneAbbreviationShifts,
  hoursLabelForEntry,
  timezoneAbbreviationAt,
} from "./timeMath";

const hours = (opens: string, closes: string): DayHoursEntry => ({
  mode: "hours",
  opens,
  closes,
});

describe("checkArrivalVsHoursSimple", () => {
  it("returns near when inside same-day window close to opening", () => {
    const status = checkArrivalVsHoursSimple(
      "2026-01-01T08:05:00Z",
      hours("08:00", "20:00"),
      "UTC",
    );
    expect(status).toBe("near");
  });

  it("handles overnight windows with near/open/closed correctly", () => {
    const entry = hours("22:00", "02:00");

    expect(
      checkArrivalVsHoursSimple("2026-01-01T21:45:00Z", entry, "UTC"),
    ).toBe("closed");
    expect(
      checkArrivalVsHoursSimple("2026-01-01T22:10:00Z", entry, "UTC"),
    ).toBe("near");
    expect(
      checkArrivalVsHoursSimple("2026-01-02T00:30:00Z", entry, "UTC"),
    ).toBe("open");
    expect(
      checkArrivalVsHoursSimple("2026-01-02T01:45:00Z", entry, "UTC"),
    ).toBe("near");
  });
});

describe("checkArrivalVsHoursDetailed", () => {
  it("returns near-open just before opening", () => {
    const status = checkArrivalVsHoursDetailed(
      "2026-01-01T07:50:00Z",
      hours("08:00", "20:00"),
      "UTC",
      15,
      7,
    );
    expect(status).toBe("near-open");
  });

  it("returns near-close just after closing for overnight window", () => {
    const status = checkArrivalVsHoursDetailed(
      "2026-01-02T02:03:00Z",
      hours("22:00", "02:00"),
      "UTC",
      15,
      7,
    );
    expect(status).toBe("near-close");
  });
});

describe("buildDetailedNearDetail", () => {
  it("reports minutes before opening", () => {
    const detail = buildDetailedNearDetail(
      "near-open",
      "2026-01-01T07:59:00Z",
      hours("08:00", "20:00"),
      "UTC",
    );
    expect(detail).toBe("1 min before opening");
  });

  it("reports minutes after closing", () => {
    const detail = buildDetailedNearDetail(
      "near-close",
      "2026-01-02T02:01:00Z",
      hours("22:00", "02:00"),
      "UTC",
    );
    expect(detail).toBe("1 min after closing");
  });
});

describe("ratio and label formatting", () => {
  it("formats ratio strings", () => {
    expect(formatRawRatio(5.4, 10.2)).toBe("5.4h / 10.2h");
    expect(formatRawDualRatio(5.4, 10.2, 12.5)).toBe(
      "5.4h / 10.2h (5.4h / 12.5h)",
    );
    expect(formatRatioPercent(5, 10)).toBe("50.0%");
    expect(formatRatioPercent(1, 0)).toBe("-");
  });

  it("formats entry labels", () => {
    expect(
      hoursLabelForEntry({ mode: "24h", opens: "00:00", closes: "00:00" }),
    ).toBe("24 hours");
    expect(
      hoursLabelForEntry({ mode: "closed", opens: "00:00", closes: "00:00" }),
    ).toBe("Closed");
    expect(hoursLabelForEntry(hours("06:00", "22:00"))).toBe(
      "6:00 AM - 10:00 PM",
    );
  });
});

describe("timezone sequence helpers", () => {
  it("builds adjacent-deduped timezone abbreviation shifts per split end time", () => {
    const makeSplit = (
      differentTimezone: boolean,
      timezone: string,
    ): SegmentForm["splits"][number] =>
      ({
        differentTimezone,
        timezone,
      }) as SegmentForm["splits"][number];

    const formSeg = {
      splits: [
        makeSplit(false, "UTC"),
        makeSplit(true, "America/Denver"),
        makeSplit(true, "America/Denver"),
      ],
    } as SegmentForm;

    const shifts = getSegmentTimezoneAbbreviationShifts(formSeg, "UTC", [
      "2026-01-01T00:00:00Z",
      "2026-01-01T01:00:00Z",
      "2026-01-01T02:00:00Z",
    ]);

    expect(shifts).toEqual(["UTC", "MST"]);
  });

  it("mirrors segment header tz badges and drops leading course timezone", () => {
    const makeSplit = (
      tzManuallySet: boolean,
      differentTimezone: boolean,
      timezone: string,
    ): SegmentForm["splits"][number] =>
      ({
        tzManuallySet,
        differentTimezone,
        timezone,
      }) as SegmentForm["splits"][number];

    const gpxProfiles = [
      null,
      { endTimezone: "America/Chicago" },
      { endTimezone: "America/Chicago" },
    ] as (SplitGpxProfile | null)[];

    const sequence = buildSegmentTimezoneSequence(
      [
        makeSplit(false, false, "UTC"),
        makeSplit(false, false, "UTC"),
        makeSplit(false, false, "UTC"),
      ],
      "UTC",
      gpxProfiles,
      "2026-06-01T12:00:00Z",
    );

    expect(sequence).toEqual([
      {
        tz: "America/Chicago",
        abbr: timezoneAbbreviationAt("2026-06-01T12:00:00Z", "America/Chicago"),
      },
    ]);
  });
});
