import { describe, expect, it } from "vitest";
import { computeSplitProfile } from "./gpxParser";
import type { GpxTrackPoint } from "../types";

function makeTrack(points: Array<[number, number]>): GpxTrackPoint[] {
  return points.map(([cumDist, ele]) => ({
    lat: 0,
    lon: 0,
    ele,
    cumDist,
  }));
}

describe("computeSplitProfile grade extremes", () => {
  it("does not let a single elevation spike dominate min and max grade", () => {
    const track = makeTrack([
      [0.0, 100],
      [0.05, 100],
      [0.1, 100],
      [0.15, 180],
      [0.2, 100],
      [0.25, 100],
      [0.3, 100],
    ]);

    const profile = computeSplitProfile(track, 0, 0.3, "unknown");

    expect(profile.maxGradePct).toBeLessThan(30);
    expect(profile.minGradePct).toBeGreaterThan(-30);
  });

  it("still reports a steady climb as a real positive grade", () => {
    const track = makeTrack([
      [0.0, 100],
      [0.05, 104],
      [0.1, 108],
      [0.15, 112],
      [0.2, 116],
      [0.25, 120],
      [0.3, 124],
    ]);

    const profile = computeSplitProfile(track, 0, 0.3, "unknown");

    expect(profile.maxGradePct).toBeGreaterThan(6);
    expect(profile.maxGradePct).toBeLessThan(10);
    expect(profile.minGradePct).toBeGreaterThan(-1);
  });
});
