import { useEffect, useMemo } from "react";
import {
  MapContainer,
  TileLayer,
  Polyline,
  CircleMarker,
  Popup,
  useMap,
  AttributionControl,
} from "react-leaflet";
import type { LatLngBoundsExpression, LatLngExpression } from "leaflet";
import type { GpxTrackPoint, UnitSystem } from "../types";
import { interpolateLatLon, sliceTrackPoints } from "../calculator/gpxParser";

interface TransitSegmentMapProps {
  gpxTrack: GpxTrackPoint[];
  startKm: number;
  endKm: number;
  unitSystem: UnitSystem;
  segmentColor: string;
}

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
  const last = track[track.length - 1];
  result.push([last.lat, last.lon]);
  return result;
}

function formatDistFromKm(km: number, unitSystem: UnitSystem): string {
  if (unitSystem === "imperial") {
    return `${(km / 1.60934).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} mi`;
  }
  return `${km.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} km`;
}

function FitBounds({ bounds }: { bounds: LatLngBoundsExpression }) {
  const map = useMap();
  useEffect(() => {
    map.fitBounds(bounds, { padding: [24, 24] });
  }, [map, bounds]);
  return null;
}

function MapInvalidator() {
  const map = useMap();
  useEffect(() => {
    map.invalidateSize();
    const container = map.getContainer();
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(container);
    return () => ro.disconnect();
  }, [map]);
  return null;
}

function ScrollWheelActivator() {
  const map = useMap();
  useEffect(() => {
    map.scrollWheelZoom.disable();
    const el = map.getContainer();
    const enable = () => map.scrollWheelZoom.enable();
    const disable = () => map.scrollWheelZoom.disable();
    el.addEventListener("click", enable);
    el.addEventListener("mouseleave", disable);
    return () => {
      el.removeEventListener("click", enable);
      el.removeEventListener("mouseleave", disable);
    };
  }, [map]);
  return null;
}

export default function TransitSegmentMap({
  gpxTrack,
  startKm,
  endKm,
  unitSystem,
  segmentColor,
}: TransitSegmentMapProps) {
  const minKm = Math.min(startKm, endKm);
  const maxKm = Math.max(startKm, endKm);

  const polyline = useMemo(() => {
    const slice = sliceTrackPoints(gpxTrack, minKm, maxKm);
    return decimateTrack(slice);
  }, [gpxTrack, minKm, maxKm]);

  const startPoint =
    interpolateLatLon(gpxTrack, startKm) ??
    (polyline.length > 0 ? { lat: polyline[0][0], lon: polyline[0][1] } : null);
  const endPoint =
    interpolateLatLon(gpxTrack, endKm) ??
    (polyline.length > 0
      ? {
          lat: polyline[polyline.length - 1][0],
          lon: polyline[polyline.length - 1][1],
        }
      : null);

  const bounds = useMemo<LatLngBoundsExpression | null>(() => {
    if (!startPoint || !endPoint) return null;

    const lats = [startPoint.lat, endPoint.lat, ...polyline.map((p) => p[0])];
    const lons = [startPoint.lon, endPoint.lon, ...polyline.map((p) => p[1])];

    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);

    const latPad = Math.max((maxLat - minLat) * 0.08, 0.0015);
    const lonPad = Math.max((maxLon - minLon) * 0.08, 0.0015);

    return [
      [minLat - latPad, minLon - lonPad],
      [maxLat + latPad, maxLon + lonPad],
    ];
  }, [startPoint, endPoint, polyline]);

  if (!startPoint || !endPoint || !bounds) {
    return <div className="map-loading">Transit map unavailable</div>;
  }

  return (
    <div className="transit-segment-map">
      <div className="transit-segment-map-canvas">
        <MapContainer
          bounds={bounds}
          boundsOptions={{ padding: [24, 24] }}
          attributionControl={false}
          style={{ height: "100%", width: "100%" }}
        >
          <AttributionControl position="bottomleft" />
          <MapInvalidator />
          <ScrollWheelActivator />
          <FitBounds bounds={bounds} />
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            maxZoom={19}
          />

          {polyline.length >= 2 && (
            <Polyline
              positions={polyline as LatLngExpression[]}
              pathOptions={{ color: segmentColor, weight: 4, opacity: 0.9 }}
            />
          )}

          <CircleMarker
            center={[startPoint.lat, startPoint.lon]}
            radius={8}
            pathOptions={{
              color: segmentColor,
              weight: 2,
              fillColor: "#ffffff",
              fillOpacity: 1,
            }}
          >
            <Popup>
              <strong>Transit start</strong>
              <br />
              {formatDistFromKm(startKm, unitSystem)}
            </Popup>
          </CircleMarker>

          <CircleMarker
            center={[endPoint.lat, endPoint.lon]}
            radius={8}
            pathOptions={{
              color: "#ffffff",
              weight: 2,
              fillColor: segmentColor,
              fillOpacity: 1,
            }}
          >
            <Popup>
              <strong>Transit end</strong>
              <br />
              {formatDistFromKm(endKm, unitSystem)}
            </Popup>
          </CircleMarker>
        </MapContainer>
      </div>
    </div>
  );
}
