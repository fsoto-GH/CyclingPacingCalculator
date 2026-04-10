import { useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Polyline,
  CircleMarker,
  Marker,
  Pane,
  Popup,
  useMap,
} from "react-leaflet";
import { divIcon } from "leaflet";
import type {
  LatLngBoundsExpression,
  LatLngExpression,
  Map as LeafletMap,
} from "leaflet";
import type { GpxTrackPoint, UnitSystem, SegmentForm } from "../types";
import type { RestStopForm } from "../types";
import { interpolateLatLon, sliceTrackPoints } from "../calculator/gpxParser";
import { distanceLabel, SEGMENT_COLORS } from "../utils";

interface RouteMarker {
  lat: number;
  lon: number;
  label: string;
  distanceStr: string;
  role: "start" | "split" | "finish" | "stop";
  segIdx: number;
}

interface CourseMapProps {
  gpxTrack: GpxTrackPoint[];
  splitBoundariesKm: [number, number][][];
  formSegments: SegmentForm[];
  unitSystem: UnitSystem;
  showRestStops?: boolean;
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
  stop: "#a855f7", // purple — rest stops
};

/** Forward azimuth in degrees (0 = north, clockwise). */
function computeBearing(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function makeArrowIcon(bearingDeg: number) {
  return divIcon({
    html: `<svg viewBox="0 0 24 24" width="16" height="16" xmlns="http://www.w3.org/2000/svg" style="transform:rotate(${bearingDeg}deg);transform-origin:50% 50%;display:block;overflow:visible"><polygon points="12,2 20,20 12,15 4,20" fill="rgba(255,255,255,0.70)" stroke="rgba(0,0,0,0.40)" stroke-width="1.5" stroke-linejoin="round"/></svg>`,
    className: "",
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

function makeTickIcon(label: string) {
  return divIcon({
    html: `<div class="split-map-tick-label">${label}</div>`,
    className: "",
    iconSize: [0, 0],
    iconAnchor: [0, 9],
  });
}

/**
 * Interval between markers in km, chosen so markers stay readable at
 * the given Leaflet zoom level. Floor is 1 mi (imperial) or 1 km (metric).
 */
function getIntervalKm(zoom: number, unitSystem: UnitSystem): number {
  if (unitSystem === "imperial") {
    const MI = 1.60934;
    if (zoom >= 14) return 1 * MI;
    if (zoom >= 13) return 2 * MI;
    if (zoom >= 12) return 5 * MI;
    if (zoom >= 11) return 10 * MI;
    if (zoom >= 10) return 20 * MI;
    return 50 * MI;
  }
  if (zoom >= 14) return 1;
  if (zoom >= 13) return 2;
  if (zoom >= 12) return 5;
  if (zoom >= 11) return 10;
  if (zoom >= 10) return 25;
  return 50;
}

/**
 * Renders zoom-adaptive distance labels and direction arrows along the track.
 * Lives inside MapContainer so it can call useMap().
 */
function ZoomableMarkers({
  gpxTrack,
  unitSystem,
}: {
  gpxTrack: GpxTrackPoint[];
  unitSystem: UnitSystem;
}) {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());
  const [viewport, setViewport] = useState(() => {
    const b = map.getBounds();
    return { s: b.getSouth(), n: b.getNorth(), w: b.getWest(), e: b.getEast() };
  });

  useEffect(() => {
    const update = () => {
      setZoom(map.getZoom());
      const b = map.getBounds();
      setViewport({
        s: b.getSouth(),
        n: b.getNorth(),
        w: b.getWest(),
        e: b.getEast(),
      });
    };
    map.on("zoomend moveend", update);
    return () => {
      map.off("zoomend moveend", update);
    };
  }, [map]);

  // Stage 1: precompute ALL positions for current interval — reruns only on zoom/unit change
  const allMarkers = useMemo(() => {
    if (gpxTrack.length < 2)
      return {
        dist: [] as Array<{
          km: number;
          lat: number;
          lon: number;
          label: string;
        }>,
        arrow: [] as Array<{
          km: number;
          lat: number;
          lon: number;
          bearing: number;
        }>,
      };
    const intervalKm = getIntervalKm(zoom, unitSystem);
    const totalKm = gpxTrack[gpxTrack.length - 1].cumDist;
    const dLabel = unitSystem === "imperial" ? "mi" : "km";

    const dist: Array<{ km: number; lat: number; lon: number; label: string }> =
      [];
    for (let km = intervalKm; km < totalKm; km += intervalKm) {
      const pt = interpolateLatLon(gpxTrack, km);
      if (!pt) continue;
      const userDist = unitSystem === "imperial" ? km / 1.60934 : km;
      dist.push({
        km,
        lat: pt.lat,
        lon: pt.lon,
        label: `${Math.round(userDist).toLocaleString()} ${dLabel}`,
      });
    }

    const arrow: Array<{
      km: number;
      lat: number;
      lon: number;
      bearing: number;
    }> = [];
    for (let km = intervalKm / 2; km < totalKm; km += intervalKm) {
      const pt = interpolateLatLon(gpxTrack, km);
      const ptAhead = interpolateLatLon(gpxTrack, km + 0.3);
      if (!pt || !ptAhead) continue;
      arrow.push({
        km,
        lat: pt.lat,
        lon: pt.lon,
        bearing: computeBearing(pt.lat, pt.lon, ptAhead.lat, ptAhead.lon),
      });
    }

    return { dist, arrow };
  }, [gpxTrack, zoom, unitSystem]);

  // Stage 2: cheap viewport filter — O(n) bounds check, no interpolation — reruns on pan
  const { distMarkers, arrowMarkers } = useMemo(() => {
    const pad = 0.02; // ~2 km buffer so markers preload just before entering view
    const { s, n, w, e } = viewport;
    const inView = (lat: number, lon: number) =>
      lat >= s - pad && lat <= n + pad && lon >= w - pad && lon <= e + pad;
    return {
      distMarkers: allMarkers.dist.filter((m) => inView(m.lat, m.lon)),
      arrowMarkers: allMarkers.arrow.filter((m) => inView(m.lat, m.lon)),
    };
  }, [allMarkers, viewport]);

  return (
    <>
      {distMarkers.map((m) => (
        <Marker
          key={`tick-${m.km}`}
          position={[m.lat, m.lon]}
          icon={makeTickIcon(m.label)}
          interactive={false}
          pane="route-labels"
        />
      ))}
      {arrowMarkers.map((m) => (
        <Marker
          key={`arrow-${m.km}`}
          position={[m.lat, m.lon]}
          icon={makeArrowIcon(m.bearing)}
          interactive={false}
          pane="route-labels"
        />
      ))}
    </>
  );
}

// Scroll wheel zoom is disabled until the user clicks inside the map,
// re-disabled when the mouse leaves — prevents accidental zoom while scrolling.
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

export default function CourseMap({
  gpxTrack,
  splitBoundariesKm,
  formSegments,
  unitSystem,
  showRestStops = true,
}: CourseMapProps) {
  const dLabel = distanceLabel(unitSystem);
  const toUserDist =
    unitSystem === "imperial"
      ? (km: number) => km / 1.60934
      : (km: number) => km;

  const polyline = useMemo(() => decimateTrack(gpxTrack), [gpxTrack]);

  // Per-segment sliced + decimated polylines for colour coding.
  // splitBoundariesKm[si] = [[startKm, endKm], ...] for each split in segment si.
  // When there are no boundaries yet the ghost handles display; return empty.
  const segmentPolylines = useMemo(() => {
    if (splitBoundariesKm.length === 0) return [];
    return splitBoundariesKm.map((segBounds, si) => {
      const startKm = segBounds[0]?.[0] ?? 0;
      const endKm =
        segBounds[segBounds.length - 1]?.[1] ??
        gpxTrack[gpxTrack.length - 1].cumDist;
      const slice = sliceTrackPoints(gpxTrack, startKm, endKm);
      return { positions: decimateTrack(slice), segIdx: si };
    });
  }, [gpxTrack, splitBoundariesKm]);

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
      segIdx: 0,
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
        const distanceStr = `${distUser.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${dLabel}`;

        markerCount++;
        result.push({
          lat: coord.lat,
          lon: coord.lon,
          label,
          distanceStr,
          segIdx: si,
          role: "split",
        });
      }
    }

    // Re-tag the last marker as finish (if it isn't the start)
    if (result.length > 1) {
      result[result.length - 1].role = "finish";
    }

    // Rest stop markers — placed at split endpoints where a rest stop is enabled
    if (showRestStops) {
      for (let si = 0; si < splitBoundariesKm.length; si++) {
        const segBounds = splitBoundariesKm[si];
        for (let sj = 0; sj < segBounds.length; sj++) {
          const rs: RestStopForm | undefined =
            formSegments[si]?.splits[sj]?.rest_stop;
          if (!rs?.enabled || !rs.name) continue;
          const [, endKm] = segBounds[sj];
          const coord = interpolateLatLon(gpxTrack, endKm);
          if (!coord) continue;
          result.push({
            lat: coord.lat,
            lon: coord.lon,
            label: `🛑 ${rs.name}`,
            distanceStr: `${toUserDist(endKm).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${dLabel}`,
            segIdx: si,
            role: "stop",
          });
        }
      }
    }

    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gpxTrack, splitBoundariesKm, formSegments, unitSystem]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showMarkers, setShowMarkers] = useState(true);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }

  if (polyline.length < 2) return null;

  const legendSegments = formSegments.map((seg, si) => ({
    color: SEGMENT_COLORS[si % SEGMENT_COLORS.length],
    name:
      seg.name?.trim() ||
      (formSegments.length > 1 ? `Segment ${si + 1}` : "Route"),
  }));
  const hasRestStops = markers.some((m) => m.role === "stop");
  const finishMarker = markers.find((m) => m.role === "finish");
  const finishColor = finishMarker
    ? SEGMENT_COLORS[finishMarker.segIdx % SEGMENT_COLORS.length]
    : null;

  return (
    <div className="course-map-outer">
      <div className="course-map-container" ref={containerRef}>
        <button
          className="map-markers-btn"
          onClick={() => setShowMarkers((v) => !v)}
          title={showMarkers ? "Hide mile markers" : "Show mile markers"}
          aria-label={showMarkers ? "Hide mile markers" : "Show mile markers"}
          style={{ opacity: showMarkers ? 1 : 0.5 }}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
          </svg>
        </button>
        <button
          className="map-reset-btn"
          onClick={() =>
            mapRef.current?.fitBounds(bounds, { padding: [24, 24] })
          }
          title="Reset view"
          aria-label="Reset map view"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M15 3l2.3 2.3-2.89 2.87 1.42 1.42L18.7 6.7 21 9V3h-6zM3 9l2.3-2.3 2.87 2.89 1.42-1.42L6.7 5.3 9 3H3v6zm6 12l-2.3-2.3 2.89-2.87-1.42-1.42L5.3 17.3 3 15v6h6zm12-6l-2.3 2.3-2.87-2.89-1.42 1.42 2.89 2.87L15 21h6v-6z" />
          </svg>
        </button>
        <button
          className="map-fullscreen-btn"
          onClick={toggleFullscreen}
          title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          aria-label={isFullscreen ? "Exit fullscreen" : "View map fullscreen"}
        >
          {isFullscreen ? (
            // compress icon
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
              <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" />
            </svg>
          ) : (
            // expand icon
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
              <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
            </svg>
          )}
        </button>
        <MapContainer
          ref={mapRef}
          bounds={bounds}
          boundsOptions={{ padding: [24, 24] }}
          scrollWheelZoom={true}
          style={{ height: "100%", width: "100%" }}
        >
          <Pane name="route-lines" style={{ zIndex: 393 }} />
          <Pane name="route-labels" style={{ zIndex: 397 }} />
          <ScrollWheelActivator />
          {showMarkers && (
            <ZoomableMarkers gpxTrack={gpxTrack} unitSystem={unitSystem} />
          )}
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            maxZoom={19}
          />
          {/* Ghost track — always visible; covers sections with no splits assigned */}
          <Polyline
            positions={polyline as LatLngExpression[]}
            pathOptions={{ color: "#64748b", weight: 3, opacity: 0.6 }}
            pane="route-lines"
          />
          {/* Colored segment overlays — paint over the ghost where splits are defined */}
          {segmentPolylines.map(({ positions, segIdx }) => (
            <Polyline
              key={segIdx}
              positions={positions as LatLngExpression[]}
              pathOptions={{
                color: SEGMENT_COLORS[segIdx % SEGMENT_COLORS.length],
                weight: 3,
                opacity: 0.85,
              }}
              pane="route-lines"
            />
          ))}
          {markers.map((m, i) => (
            <CircleMarker
              key={i}
              center={[m.lat, m.lon]}
              radius={m.role === "start" || m.role === "finish" ? 9 : 7}
              pathOptions={{
                color: "#1a1a2e",
                weight: 2,
                fillColor:
                  m.role === "split" || m.role === "finish"
                    ? SEGMENT_COLORS[m.segIdx % SEGMENT_COLORS.length]
                    : MARKER_COLORS[m.role],
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
      {/* ── Legend ── */}
      <div className="course-map-legend">
        <div className="cml-segments">
          {legendSegments.map((seg, i) => (
            <div key={i} className="cml-item">
              <span className="cml-line" style={{ background: seg.color }} />
              <span className="cml-label">{seg.name}</span>
            </div>
          ))}
        </div>
        <div className="cml-nodes">
          <div className="cml-item">
            <span
              className="cml-dot"
              style={{ background: MARKER_COLORS.start }}
            />
            <span className="cml-label">Start</span>
          </div>
          {finishColor && (
            <div className="cml-item">
              <span className="cml-dot" style={{ background: finishColor }} />
              <span className="cml-label">Finish</span>
            </div>
          )}
          {hasRestStops && (
            <div className="cml-item">
              <span
                className="cml-dot"
                style={{ background: MARKER_COLORS.stop }}
              />
              <span className="cml-label">Rest Stop</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
