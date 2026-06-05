// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { computeSplitProfile, parseGpx } from "./gpxParser";
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

describe("parseGpx", () => {
  it("rejects GPX files with no track points", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test">
  <trk>
    <name>Empty</name>
    <trkseg />
  </trk>
</gpx>`;

    expect(() => parseGpx(xml)).toThrow("No track points found in GPX");
  });

  it("rejects GPX files whose track points have no valid coordinates", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test">
  <trk>
    <name>Invalid</name>
    <trkseg>
      <trkpt lat="" lon="" />
    </trkseg>
  </trk>
</gpx>`;

    expect(() => parseGpx(xml)).toThrow("No valid track points found in GPX");
  });

  it("rejects GPX files with only one usable track point", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test">
  <trk>
    <name>Single Point</name>
    <trkseg>
      <trkpt lat="41.7590300" lon="-87.6830900"><ele>184.3</ele></trkpt>
    </trkseg>
  </trk>
</gpx>`;

    expect(() => parseGpx(xml)).toThrow(
      "At least two track points are required in GPX",
    );
  });
});
