/**
 * GPX parsing and elevation profile computation.
 * No external libraries — uses DOMParser (available in all modern browsers and Vite's build).
 */

import tzlookup from "tz-lookup";
import type { GpxTrackPoint, SplitGpxProfile } from "../types";

// ── Haversine distance ──────────────────────────────────────────────────────

function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── GPX parsing ─────────────────────────────────────────────────────────────

/**
 * Parse a GPX XML string into an array of track points with cumulative
 * distances (in km) from the start of the track.
 */
export function parseGpx(xml: string): GpxTrackPoint[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const parseErr = doc.querySelector("parsererror");
  if (parseErr) throw new Error("Invalid GPX file");

  // getElementsByTagName works regardless of XML namespace (unlike querySelectorAll)
  const rawPts = Array.from(
    doc.getElementsByTagName("trkpt").length > 0
      ? doc.getElementsByTagName("trkpt")
      : doc.getElementsByTagName("rtept"),
  ) as Element[];

  if (rawPts.length === 0) throw new Error("No track points found in GPX");

  const points: GpxTrackPoint[] = [];
  let cumDist = 0;
  let prev: GpxTrackPoint | null = null;

  for (const pt of rawPts) {
    const lat = parseFloat(pt.getAttribute("lat") ?? "");
    const lon = parseFloat(pt.getAttribute("lon") ?? "");
    if (isNaN(lat) || isNaN(lon)) continue;

    const eleEl = pt.getElementsByTagName("ele")[0] ?? null;
    const ele = eleEl ? parseFloat(eleEl.textContent ?? "0") : 0;

    if (prev) {
      cumDist += haversineKm(prev.lat, prev.lon, lat, lon);
    }

    points.push({ lat, lon, ele, cumDist });
    prev = points[points.length - 1];
  }

  return points;
}

/**
 * Try to extract a dominant surface tag from GPX <extensions> elements.
 * Komoot, OsmAnd, and Garmin use varying tag names — we check the most common.
 */
function extractSurface(doc: Document): string {
  const surfaces: Record<string, number> = {};
  // Use getElementsByTagName (namespace-safe) with local tag names only
  for (const tagName of ["surface"]) {
    for (const el of Array.from(doc.getElementsByTagName(tagName))) {
      const val = (el.textContent ?? "").toLowerCase().trim();
      if (val) surfaces[val] = (surfaces[val] ?? 0) + 1;
    }
  }
  const entries = Object.entries(surfaces).sort((a, b) => b[1] - a[1]);
  return entries.length > 0 ? entries[0][0] : "unknown";
}

/** Parse surface tag from raw GPX XML — call once on file load, cache the result. */
export function extractSurfaceFromXml(xml: string): string {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return extractSurface(doc);
}

// ── Elevation gain/loss — gpx.studio algorithm ──────────────────────────────

/**
 * Sliding-window average over a contiguous slice of points, maintained
 * incrementally via a running sum so the outer loop stays O(n).
 *
 * Mirrors the `windowSmoothing` / `distanceWindowSmoothing` helpers from
 * https://github.com/gpxstudio/gpx.studio (MIT licence).
 */
function windowSmoothing(
  left: number,
  right: number, // exclusive upper bound
  distFn: (i1: number, i2: number) => number, // distance in km
  windowKm: number,
  computeFn: (s: number, e: number) => number,
  callbackFn: (value: number, idx: number) => void,
): void {
  let start = left;
  for (let i = left; i < right; i++) {
    while (start + 1 < i && distFn(start, i) > windowKm) start++;
    let end = Math.min(i + 2, right);
    while (end < right && distFn(i, end) <= windowKm) end++;
    callbackFn(computeFn(start, end - 1), i);
  }
}

/**
 * Compute elevation gain and loss using the gpx.studio algorithm:
 *
 *  1. Ramer–Douglas–Peucker simplification (ε = 20 m in elevation-profile
 *     space) to identify significant terrain anchors.
 *  2. Within each pair of adjacent anchors, apply a 100 m distance-window
 *     moving average to the raw elevations, forcing the raw value at each
 *     anchor endpoint.
 *  3. Accumulate gain/loss on the smoothed signal.
 *
 * Produces results that match gpx.studio and are close to Garmin/Strava for
 * typical GPS data.
 *
 * @param points     - Ordered track points with .ele (m) and .cumDist (km)
 * @param rdpEpsM    - RDP perpendicular-distance tolerance in metres (default 20)
 * @param windowKm   - Smoothing window in km (default 0.1 = 100 m)
 */
export function computeElevGainLoss(
  points: { ele: number; cumDist: number }[],
  rdpEpsM = 20,
  windowKm = 0.1,
): { gainM: number; lossM: number } {
  if (points.length < 2) return { gainM: 0, lossM: 0 };

  // ── Step 1: RDP on (cumDist metres, ele metres) 2D plane ──────────────────
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];

  while (stack.length > 0) {
    const [s, e] = stack.pop()!;
    if (e - s < 2) continue;
    const x1 = points[s].cumDist * 1000,
      y1 = points[s].ele;
    const x2 = points[e].cumDist * 1000,
      y2 = points[e].ele;
    const dx = x2 - x1,
      dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    let maxD = 0,
      maxI = s + 1;
    for (let i = s + 1; i < e; i++) {
      const x3 = points[i].cumDist * 1000,
        y3 = points[i].ele;
      const d =
        len === 0
          ? Math.sqrt((x3 - x1) ** 2 + (y3 - y1) ** 2)
          : Math.abs(dy * x3 - dx * y3 + x2 * y1 - y2 * x1) / len;
      if (d > maxD) {
        maxD = d;
        maxI = i;
      }
    }
    if (maxD > rdpEpsM) {
      keep[maxI] = true;
      stack.push([s, maxI]);
      stack.push([maxI, e]);
    }
  }

  const anchors: number[] = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) anchors.push(i);

  // ── Step 2 & 3: per-segment 100 m smoothing + gain/loss accumulation ──────
  let gainM = 0,
    lossM = 0;

  for (let a = 0; a < anchors.length - 1; a++) {
    const segStart = anchors[a];
    const segEnd = anchors[a + 1];

    let cumulEle = 0;
    let currentStart = segStart;
    let currentEnd = segStart;
    let prevSmoothedEle = 0;

    windowSmoothing(
      segStart,
      segEnd + 1,
      (i1, i2) => points[i2].cumDist - points[i1].cumDist,
      windowKm,
      (s, e) => {
        for (let i = currentStart; i < s; i++) cumulEle -= points[i].ele;
        for (let i = currentEnd; i <= e; i++) cumulEle += points[i].ele;
        currentStart = s;
        currentEnd = e + 1;
        return cumulEle / (e - s + 1);
      },
      (smoothedEle, j) => {
        // Force raw GPS value at anchor endpoints
        if (j === segStart) {
          prevSmoothedEle = points[segStart].ele;
          return;
        }
        if (j === segEnd) smoothedEle = points[segEnd].ele;

        const delta = smoothedEle - prevSmoothedEle;
        if (delta > 0) gainM += delta;
        else lossM -= delta;
        prevSmoothedEle = smoothedEle;
      },
    );
  }

  return { gainM, lossM };
}

// ── Split profile computation ────────────────────────────────────────────────

/**
 * Slice the track between startKm and endKm and compute elevation/grade
 * statistics for that segment.
 *
 * @param track   - Full course track (from parseGpx)
 * @param startKm - Distance from track start where this split begins (km)
 * @param endKm   - Distance from track start where this split ends (km)
 * @param surface - Pre-extracted dominant surface tag for the whole track
 */
export function computeSplitProfile(
  track: GpxTrackPoint[],
  startKm: number,
  endKm: number,
  surface: string,
): SplitGpxProfile {
  // Binary search: first index with cumDist >= startKm
  let lo = 0,
    hi = track.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (track[mid].cumDist < startKm) lo = mid + 1;
    else hi = mid;
  }
  const startIdx = lo;

  // Binary search: first index with cumDist > endKm (exclusive upper bound)
  lo = startIdx;
  hi = track.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (track[mid].cumDist <= endKm) lo = mid + 1;
    else hi = mid;
  }
  const endIdx = lo;

  if (endIdx === startIdx) {
    // Degenerate: no points in range — binary search for closest to midpoint
    const midKm = (startKm + endKm) / 2;
    lo = 0;
    hi = track.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (track[mid].cumDist < midKm) lo = mid + 1;
      else hi = mid;
    }
    const ci =
      lo > 0 &&
      lo < track.length &&
      Math.abs(track[lo - 1].cumDist - midKm) <
        Math.abs(track[lo].cumDist - midKm)
        ? lo - 1
        : Math.min(lo, track.length - 1);
    const closest = track[ci];
    return {
      elevGainM: 0,
      elevLossM: 0,
      avgGradePct: 0,
      steepPct: 0,
      surface,
      endLat: closest.lat,
      endLon: closest.lon,
      endTimezone: tzlookup(closest.lat, closest.lon),
    };
  }

  const slice = track.slice(startIdx, endIdx);
  const { gainM: elevGainM, lossM: elevLossM } = computeElevGainLoss(slice);

  // cumDist deltas are pre-computed at parse time — no haversine needed.
  let steepDistKm = 0;
  for (let i = 1; i < slice.length; i++) {
    const dEle = slice[i].ele - slice[i - 1].ele;
    const segDistKm = slice[i].cumDist - slice[i - 1].cumDist;
    if (segDistKm > 0) {
      const gradePct = Math.abs(dEle / (segDistKm * 1000)) * 100;
      if (gradePct > 5) steepDistKm += segDistKm;
    }
  }

  const totalDistKm = slice[slice.length - 1].cumDist - slice[0].cumDist;
  const splitDistKm = Math.max(totalDistKm, 0.001);
  const avgGradePct = (elevGainM / (splitDistKm * 1000)) * 100;
  const steepPct = (steepDistKm / splitDistKm) * 100;

  const endPt = slice[slice.length - 1];

  return {
    elevGainM: Math.round(elevGainM),
    elevLossM: Math.round(elevLossM),
    avgGradePct: Math.round(avgGradePct * 10) / 10,
    steepPct: Math.round(steepPct),
    surface,
    endLat: endPt.lat,
    endLon: endPt.lon,
    endTimezone: tzlookup(endPt.lat, endPt.lon),
  };
}

/**
 * Interpolate a lat/lon coordinate at an arbitrary cumulative distance (km)
 * along the track. Uses binary search + linear interpolation between the two
 * bracketing track points. Returns null if the track is empty or km is
 * outside the track's range.
 */
export function interpolateLatLon(
  track: GpxTrackPoint[],
  km: number,
): { lat: number; lon: number } | null {
  if (track.length === 0) return null;
  if (km <= track[0].cumDist) return { lat: track[0].lat, lon: track[0].lon };
  const last = track[track.length - 1];
  if (km >= last.cumDist) return { lat: last.lat, lon: last.lon };

  // Binary search for the first point with cumDist >= km
  let lo = 0,
    hi = track.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (track[mid].cumDist < km) lo = mid + 1;
    else hi = mid;
  }
  const b = track[lo];
  const a = track[lo - 1];
  const span = b.cumDist - a.cumDist;
  const t = span < 1e-10 ? 0 : (km - a.cumDist) / span;
  return {
    lat: a.lat + t * (b.lat - a.lat),
    lon: a.lon + t * (b.lon - a.lon),
  };
}

/**
 * Slice raw track points between startKm and endKm (inclusive of boundary
 * points). Used for GPX export of individual splits.
 */
export function sliceTrackPoints(
  track: GpxTrackPoint[],
  startKm: number,
  endKm: number,
): GpxTrackPoint[] {
  let lo = 0,
    hi = track.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (track[mid].cumDist < startKm) lo = mid + 1;
    else hi = mid;
  }
  const startIdx = lo;

  lo = startIdx;
  hi = track.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (track[mid].cumDist <= endKm) lo = mid + 1;
    else hi = mid;
  }
  const endIdx = lo;

  return track.slice(startIdx, endIdx);
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Serialize a list of named track segments into a standard GPX 1.1 string.
 * Each entry in `segments` becomes its own <trkseg>.
 */
export function buildGpxString(
  segments: Array<{ name: string; points: GpxTrackPoint[] }>,
  trackName = "Exported Track",
): string {
  const trksegs = segments
    .filter((s) => s.points.length > 0)
    .map((s) => {
      const pts = s.points
        .map(
          (p) =>
            `      <trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}"><ele>${p.ele.toFixed(1)}</ele></trkpt>`,
        )
        .join("\n");
      return `    <trkseg>\n      <!-- ${escapeXml(s.name)} -->\n${pts}\n    </trkseg>`;
    })
    .join("\n");

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<gpx version="1.1" creator="CyclingPacingCalculator" xmlns="http://www.topografix.com/GPX/1/1">\n` +
    `  <trk>\n` +
    `    <name>${escapeXml(trackName)}</name>\n` +
    trksegs +
    `\n  </trk>\n` +
    `</gpx>`
  );
}

/**
 * Compute SplitGpxProfile for every split in a course.
 *
 * @param track         - Full parsed GPX track
 * @param gpxXml        - Original GPX string (for surface tag extraction)
 * @param splitDistances - Per-split distances in course units (miles or km)
 * @param unitSystem    - "imperial" | "metric" (used to convert to km)
 * @param mode          - "distance" | "target_distance"
 *
 * splitDistances should be the normalized per-split distances (same as what
 * courseProcessor uses after normalizing target_distance mode).
 */
export function computeAllProfiles(
  track: GpxTrackPoint[],
  surface: string,
  splitDistances: number[][], // [segIdx][splitIdx] = distance in course units
  unitSystem: "imperial" | "metric",
): SplitGpxProfile[][] {
  const toKm = unitSystem === "imperial" ? 1.60934 : 1;

  const result: SplitGpxProfile[][] = [];
  let cumulativeKm = 0;

  for (const segSplits of splitDistances) {
    const segProfiles: SplitGpxProfile[] = [];
    for (const distCourseUnits of segSplits) {
      const startKm = cumulativeKm;
      const endKm = cumulativeKm + distCourseUnits * toKm;
      segProfiles.push(computeSplitProfile(track, startKm, endKm, surface));
      cumulativeKm = endKm;
    }
    result.push(segProfiles);
  }

  return result;
}
