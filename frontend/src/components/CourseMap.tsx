import { useMemo } from "react";
import {
  MapContainer,
  TileLayer,
  Polyline,
  CircleMarker,
  Popup,
} from "react-leaflet";
import type { LatLngBoundsExpression, LatLngExpression } from "leaflet";
import type { GpxTrackPoint, UnitSystem } from "../types";
import type { SegmentForm } from "../types";
import { interpolateLatLon } from "../calculator/gpxParser";
import { distanceLabel } from "../utils";

interface RouteMarker {
  lat: number;
  lon: number;
  label: string;
  distanceStr: string;
  role: "start" | "split" | "finish";
}

interface CourseMapProps {
  gpxTrack: GpxTrackPoint[];
  splitBoundariesKm: [number, number][][];
  formSegments: SegmentForm[];
  unitSystem: UnitSystem;
}

/** Keep one point per 50 m of travel — reduces 30k-point tracks to ~2–3k. */
function decimateTrack(track: GpxTrackPoint[]): [number, number][] {
  if (track.length === 0) return [];
  const result: [number, number][] = [[track[0].lat, track[0].lon]];
  const MIN_KM = 0.05;
  let prevKm = track[0].cumDist;
  for (let i = 1; i < track.length; i++) {
    if (track[i].cumDist - prevKm >= MIN_KM) {
      result.push([track[i].lat, track[i].lon]);
      prevKm = track[i].cumDist;
    }
  }
  // Always include the last point
  const last = track[track.length - 1];
  result.push([last.lat, last.lon]);
  return result;
}

const MARKER_COLORS: Record<RouteMarker["role"], string> = {
  start: "#4ade80", // green
  split: "#60a5fa", // blue
  finish: "#f87171", // red
};

export default function CourseMap({
  gpxTrack,
  splitBoundariesKm,
  formSegments,
  unitSystem,
}: CourseMapProps) {
  const dLabel = distanceLabel(unitSystem);
  const toUserDist =
    unitSystem === "imperial"
      ? (km: number) => km / 1.60934
      : (km: number) => km;

  const polyline = useMemo(() => decimateTrack(gpxTrack), [gpxTrack]);

  const bounds = useMemo<LatLngBoundsExpression>(() => {
    let minLat = Infinity,
      maxLat = -Infinity,
      minLon = Infinity,
      maxLon = -Infinity;
    for (const [lat, lon] of polyline) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
    }
    return [
      [minLat, minLon],
      [maxLat, maxLon],
    ];
  }, [polyline]);

  const markers = useMemo<RouteMarker[]>(() => {
    const result: RouteMarker[] = [];

    // Start marker
    const start = gpxTrack[0];
    result.push({
      lat: start.lat,
      lon: start.lon,
      label: "Start",
      distanceStr: `0 ${dLabel}`,
      role: "start",
    });

    // One marker per split end
    let markerCount = 0;
    for (let si = 0; si < splitBoundariesKm.length; si++) {
      const segBounds = splitBoundariesKm[si];
      for (let sj = 0; sj < segBounds.length; sj++) {
        const [, endKm] = segBounds[sj];
        const coord = interpolateLatLon(gpxTrack, endKm);
        if (!coord) continue;

        const splitName = formSegments[si]?.splits[sj]?.name?.trim();
        const segNum = si + 1;
        const splitNum = sj + 1;
        const defaultName =
          formSegments.length > 1
            ? `Seg ${segNum} · Split ${splitNum}`
            : `Split ${splitNum}`;
        const label = splitName || defaultName;
        const distUser = toUserDist(endKm);
        const distanceStr = `${distUser.toFixed(1)} ${dLabel}`;

        markerCount++;
        result.push({
          lat: coord.lat,
          lon: coord.lon,
          label,
          distanceStr,
          role: "split",
        });
      }
    }

    // Re-tag the last marker as finish (if it isn't the start)
    if (result.length > 1) {
      result[result.length - 1].role = "finish";
    }

    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gpxTrack, splitBoundariesKm, formSegments, unitSystem]);

  if (polyline.length < 2) return null;

  return (
    <div className="course-map-container">
      <MapContainer
        bounds={bounds}
        boundsOptions={{ padding: [24, 24] }}
        scrollWheelZoom={true}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          maxZoom={19}
        />
        <Polyline
          positions={polyline as LatLngExpression[]}
          pathOptions={{ color: "#6b8aff", weight: 3, opacity: 0.85 }}
        />
        {markers.map((m, i) => (
          <CircleMarker
            key={i}
            center={[m.lat, m.lon]}
            radius={m.role === "start" || m.role === "finish" ? 9 : 7}
            pathOptions={{
              color: "#1a1a2e",
              weight: 2,
              fillColor: MARKER_COLORS[m.role],
              fillOpacity: 1,
            }}
          >
            <Popup>
              <strong>{m.label}</strong>
              <br />
              {m.distanceStr}
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
