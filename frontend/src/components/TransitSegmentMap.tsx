import { useEffect, useMemo, useRef, useState } from "react";
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
import type { Map as LeafletMap } from "leaflet";
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

function MapInvalidator({ bounds }: { bounds: LatLngBoundsExpression }) {
  const map = useMap();
  useEffect(() => {
    const recenter = () => {
      map.invalidateSize();
      map.fitBounds(bounds, { padding: [24, 24] });
    };

    recenter();
    const container = map.getContainer();
    const ro = new ResizeObserver(() => {
      requestAnimationFrame(recenter);
    });
    ro.observe(container);
    window.addEventListener("resize", recenter);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", recenter);
    };
  }, [map, bounds]);
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
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const minKm = Math.min(startKm, endKm);
  const maxKm = Math.max(startKm, endKm);

  const polyline = useMemo(() => {
    const slice = sliceTrackPoints(gpxTrack, minKm, maxKm);
    return decimateTrack(slice);
  }, [gpxTrack, minKm, maxKm]);

  const startPoint = useMemo(
    () =>
      interpolateLatLon(gpxTrack, startKm) ??
      (polyline.length > 0
        ? { lat: polyline[0][0], lon: polyline[0][1] }
        : null),
    [gpxTrack, startKm, polyline],
  );
  const endPoint = useMemo(
    () =>
      interpolateLatLon(gpxTrack, endKm) ??
      (polyline.length > 0
        ? {
            lat: polyline[polyline.length - 1][0],
            lon: polyline[polyline.length - 1][1],
          }
        : null),
    [gpxTrack, endKm, polyline],
  );

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

  async function toggleFullscreen() {
    const host = canvasRef.current;
    if (!host || !document.fullscreenEnabled) return;
    if (!document.fullscreenElement) {
      await host.requestFullscreen();
      setIsFullscreen(true);
      setTimeout(() => mapRef.current?.invalidateSize(), 0);
    } else {
      await document.exitFullscreen();
      setIsFullscreen(false);
      setTimeout(() => mapRef.current?.invalidateSize(), 0);
    }
  }

  useEffect(() => {
    const onFsChange = () => {
      const host = canvasRef.current;
      const active = !!host && document.fullscreenElement === host;
      setIsFullscreen(active);
      setTimeout(() => mapRef.current?.invalidateSize(), 0);
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  if (!startPoint || !endPoint || !bounds) {
    return <div className="map-loading">Transit map unavailable</div>;
  }

  return (
    <div className="transit-segment-map">
      <div className="transit-segment-map-canvas" ref={canvasRef}>
        <MapContainer
          ref={mapRef}
          bounds={bounds}
          boundsOptions={{ padding: [24, 24] }}
          attributionControl={false}
          style={{ height: "100%", width: "100%" }}
        >
          <AttributionControl position="bottomleft" />
          <MapInvalidator bounds={bounds} />
          <ScrollWheelActivator />
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            maxZoom={19}
          />

          {polyline.length >= 2 && (
            <Polyline
              positions={polyline as LatLngExpression[]}
              pathOptions={{
                color: segmentColor,
                weight: 4,
                opacity: 0.9,
                dashArray: "12 12",
              }}
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

        {document.fullscreenEnabled && (
          <button
            type="button"
            className="split-map-fullscreen-btn"
            onClick={toggleFullscreen}
            title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            aria-label={
              isFullscreen ? "Exit fullscreen" : "View map fullscreen"
            }
          >
            {isFullscreen ? (
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="currentColor"
              >
                <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" />
              </svg>
            ) : (
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="currentColor"
              >
                <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
              </svg>
            )}
          </button>
        )}

        <button
          type="button"
          className="split-map-reset-btn"
          onClick={() =>
            mapRef.current?.fitBounds(bounds, { padding: [24, 24] })
          }
          title="Reset view"
          aria-label="Reset map view"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
            <path d="M15 3l2.3 2.3-2.89 2.87 1.42 1.42L18.7 6.7 21 9V3h-6zM3 9l2.3-2.3 2.87 2.89 1.42-1.42L6.7 5.3 9 3H3v6zm6 12l-2.3-2.3 2.89-2.87-1.42-1.42L5.3 17.3 3 15v6h6zm12-6l-2.3 2.3-2.87-2.89-1.42 1.42 2.89 2.87L15 21h6v-6z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
