import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  useTransition,
  lazy,
  Suspense,
} from "react";
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
import type {
  GpxTrackPoint,
  HourlyWeatherPoint,
  UnitSystem,
  SegmentForm,
  SplitGpxProfile,
  Mode,
} from "../types";
import type { RestStopForm, IntermediateRestStopForm } from "../types";
import { interpolateLatLon, sliceTrackPoints } from "../calculator/gpxParser";
import { distanceLabel, SEGMENT_COLORS } from "../utils";
import { MapVisibilityInvalidator } from "../calculator/mapUtils";
import {
  MAP_TILE_LAYERS,
  MapTileLayerKey,
  GOOGLE_TILE_LAYER_KEYS,
} from "../calculator/mapTileLayers";
import { getGoogleTileUrlTemplate } from "../calculator/googleTileSession";
import { useAppSettings } from "../AppSettingsContext";
import type { SunriseSunsetEntry } from "../calculator/weather";
const ElevationProfile = lazy(() => import("./ElevationProfile"));
const TemperatureChart = lazy(() => import("./TemperatureChart"));

interface RouteMarker {
  lat: number;
  lon: number;
  label: string;
  distanceStr: string;
  role: "start" | "split" | "finish" | "stop" | "intermediate";
  segIdx: number;
  splitIdx: number;
  notes?: string;
  googlePlaceId?: string | null;
  mapLink?: string;
}

function googleMapsSearchUrl(
  name: string,
  lat: number,
  lon: number,
  placeId?: string | null,
): string {
  if (placeId) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}&query_place_id=${placeId}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lon}`)}`;
}

interface CourseMapProps {
  gpxTrack: GpxTrackPoint[];
  splitBoundariesKm: [number, number][][];
  formSegments: SegmentForm[];
  unitSystem: UnitSystem;
  gpxProfiles?: SplitGpxProfile[][] | null;
  /** Called when the user clicks the "Go to split" button in a popup */
  onMarkerClick?: (segIdx: number, splitIdx: number) => void;
  /** Display name shown in the elevation panel header. */
  courseName?: string;
  /** When set, zoom the map to the given segment (or split within it). */
  zoomTarget?: { segIdx: number; splitIdx?: number; rev: number } | null;
  /** Hourly weather points for the wind overlay and temperature chart. */
  hourlyWeather?: HourlyWeatherPoint[] | null;
  /** IANA timezone of the course start — forwarded to TemperatureChart. */
  courseTz?: string;
  /** ISO end-times of each segment — used for boundary lines in TemperatureChart. */
  segmentBoundaryTimes?: string[];
  /** Sunrise and sunset events for the course date range. */
  sunriseSunset?: SunriseSunsetEntry[];
  /** Course calculation mode — needed to resolve intermediate stop positions. */
  mode?: Mode;
}

/** Keep one point per 50 m of travel — reduces 30k-point tracks to ~2-3k. */
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
  intermediate: "#f59e0b", // amber — intermediate stops
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

function makeEndpointPinIcon(
  role: Exclude<RouteMarker["role"], "stop">,
  color: string,
) {
  const sizeClass = role === "split" ? "" : " route-endpoint-pin--lg";
  return divIcon({
    html: `<div class="route-endpoint-pin${sizeClass}" style="--marker-color:${color}"><i class="fa-solid fa-location-pin"></i></div>`,
    className: "",
    iconSize: [22, 30],
    iconAnchor: [11, 29],
    popupAnchor: [0, -26],
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
    if (zoom >= 8) return 20 * MI;
    if (zoom > 4) return 150 * MI;
    return (20 - zoom) * 15 * MI;
  }
  if (zoom >= 14) return 1;
  if (zoom >= 13) return 2;
  if (zoom >= 12) return 5;
  if (zoom >= 11) return 10;
  if (zoom >= 9) return 20;
  if (zoom >= 8) return 25;
  if (zoom > 4) return 250;
  return (20 - zoom) * 25;
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

function SplitMarker({
  m,
  color,
  onMarkerClick,
}: {
  m: RouteMarker;
  color: string;
  onMarkerClick?: (segIdx: number, splitIdx: number) => void;
}) {
  const map = useMap();
  const canNav = onMarkerClick != null && m.splitIdx >= 0;
  const icon = useMemo(
    () => makeEndpointPinIcon(m.role as "start" | "split" | "finish", color),
    [m.role, color],
  );
  return (
    <Marker position={[m.lat, m.lon]} icon={icon}>
      <Popup>
        <strong>{m.label}</strong>
        <br />
        {m.distanceStr}
        <br />
        <div className="split-map-popup-links">
          <a
            href={googleMapsSearchUrl(m.label, m.lat, m.lon, m.googlePlaceId)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Google Maps ↗
          </a>
        </div>
        {m.notes && (
          <>
            <br />
            <em style={{ color: "#999", fontSize: "0.85em" }}>{m.notes}</em>
          </>
        )}
        {canNav && (
          <>
            <br />
            <button
              className="split-map-popup-btn split-map-popup-btn--grow"
              onClick={() => {
                map.closePopup();
                onMarkerClick(m.segIdx, m.splitIdx);
              }}
            >
              <i className="fa-solid fa-arrow-down" aria-hidden="true" /> Go to
              split
            </button>
          </>
        )}
      </Popup>
    </Marker>
  );
}

function StopMarkerBase({
  m,
  pinClass,
  onMarkerClick,
}: {
  m: RouteMarker;
  pinClass: string;
  onMarkerClick?: (segIdx: number, splitIdx: number) => void;
}) {
  const map = useMap();
  const icon = useMemo(
    () =>
      divIcon({
        html: `<div class="${pinClass}"><i class="fa-solid fa-location-dot"></i></div>`,
        className: "",
        iconSize: [20, 28],
        iconAnchor: [10, 27],
        popupAnchor: [0, -24],
      }),
    [pinClass],
  );
  const canNav = onMarkerClick != null && m.splitIdx >= 0;
  return (
    <Marker position={[m.lat, m.lon]} icon={icon}>
      <Popup>
        {m.mapLink ? (
          <a
            href={m.mapLink}
            target="_blank"
            rel="noopener noreferrer"
            className="split-map-popup-name-link"
          >
            <strong>{m.label}</strong>
          </a>
        ) : (
          <strong>{m.label}</strong>
        )}
        <br />
        {m.distanceStr}
        <br />
        <div className="split-map-popup-links">
          <a
            href={googleMapsSearchUrl(m.label, m.lat, m.lon, m.googlePlaceId)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Google Maps ↗
          </a>
        </div>
        {canNav && (
          <>
            <br />
            <button
              className="split-map-popup-btn split-map-popup-btn--grow"
              onClick={() => {
                map.closePopup();
                onMarkerClick(m.segIdx, m.splitIdx);
              }}
            >
              <i className="fa-solid fa-arrow-down" aria-hidden="true" /> Go to
              split
            </button>
          </>
        )}
      </Popup>
    </Marker>
  );
}

function StopMarker({
  m,
  onMarkerClick,
}: {
  m: RouteMarker;
  onMarkerClick?: (segIdx: number, splitIdx: number) => void;
}) {
  return (
    <StopMarkerBase
      m={m}
      pinClass="split-rest-stop-pin"
      onMarkerClick={onMarkerClick}
    />
  );
}

function IntermediateStopMarker({
  m,
  onMarkerClick,
}: {
  m: RouteMarker;
  onMarkerClick?: (segIdx: number, splitIdx: number) => void;
}) {
  return (
    <StopMarkerBase
      m={m}
      pinClass="split-intermediate-stop-pin"
      onMarkerClick={onMarkerClick}
    />
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
  gpxProfiles,
  onMarkerClick,
  courseName,
  zoomTarget,
  hourlyWeather,
  courseTz,
  segmentBoundaryTimes,
  sunriseSunset,
  mode = "distance",
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
      return {
        positions: decimateTrack(slice),
        segIdx: si,
        isTransit: !!formSegments[si]?.nullified,
      };
    });
  }, [gpxTrack, splitBoundariesKm, formSegments]);

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
      splitIdx: -1,
      role: "start",
    });

    // One marker per split end
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

        result.push({
          lat: coord.lat,
          lon: coord.lon,
          label,
          distanceStr,
          segIdx: si,
          splitIdx: sj,
          role: "split",
          notes: formSegments[si]?.splits[sj]?.notes || undefined,
        });
      }
    }

    // Re-tag the last marker as finish (if it isn't the start)
    if (result.length > 1) {
      result[result.length - 1].role = "finish";
    }

    // Rest stop markers — use the stop's own coordinates when available,
    // otherwise fall back to the split endpoint position on the GPX track.
    for (let si = 0; si < splitBoundariesKm.length; si++) {
      const segBounds = splitBoundariesKm[si];
      for (let sj = 0; sj < segBounds.length; sj++) {
        const rs: RestStopForm | undefined =
          formSegments[si]?.splits[sj]?.rest_stop;
        if (!rs?.enabled || !rs.name) continue;
        const [, endKm] = segBounds[sj];
        const hasOwnCoords = rs.lat != null && rs.lon != null;
        const coord = hasOwnCoords
          ? { lat: rs.lat!, lon: rs.lon! }
          : interpolateLatLon(gpxTrack, endKm);
        if (!coord) continue;
        result.push({
          lat: coord.lat,
          lon: coord.lon,
          label: `${rs.name}`,
          distanceStr: `${toUserDist(endKm).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${dLabel}`,
          segIdx: si,
          splitIdx: sj,
          role: "stop",
          googlePlaceId: rs.googlePlaceId,
          mapLink:
            rs.alt ||
            googleMapsSearchUrl(
              rs.name,
              coord.lat,
              coord.lon,
              rs.googlePlaceId,
            ),
        });
      }
    }

    // Intermediate stop markers
    const KM_PER_MI = 1.60934;
    for (let si = 0; si < splitBoundariesKm.length; si++) {
      const segBounds = splitBoundariesKm[si];
      for (let sj = 0; sj < segBounds.length; sj++) {
        const iStop: IntermediateRestStopForm | undefined =
          formSegments[si]?.splits[sj]?.intermediate_stop;
        if (!iStop?.enabled || !iStop.name) continue;
        const [startKm] = segBounds[sj];
        const hasOwnCoords = iStop.lat != null && iStop.lon != null;
        let posKm: number | null = null;
        if (!hasOwnCoords) {
          const d = parseFloat(iStop.distance);
          if (!isNaN(d)) {
            const dKm = d * (unitSystem === "imperial" ? KM_PER_MI : 1);
            posKm = mode === "target_distance" ? dKm : startKm + dKm;
          }
        }
        const coord = hasOwnCoords
          ? { lat: iStop.lat!, lon: iStop.lon! }
          : posKm != null
            ? interpolateLatLon(gpxTrack, posKm)
            : null;
        if (!coord) continue;
        const distStr =
          posKm != null
            ? `${toUserDist(posKm).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${dLabel}`
            : iStop.address || `Seg ${si + 1} · Split ${sj + 1}`;
        result.push({
          lat: coord.lat,
          lon: coord.lon,
          label: `${iStop.name}`,
          distanceStr: distStr,
          segIdx: si,
          splitIdx: sj,
          role: "intermediate",
          googlePlaceId: iStop.googlePlaceId,
          mapLink:
            iStop.alt ||
            googleMapsSearchUrl(
              iStop.name,
              coord.lat,
              coord.lon,
              iStop.googlePlaceId,
            ),
        });
      }
    }

    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gpxTrack, splitBoundariesKm, formSegments, unitSystem, mode]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showMarkers, setShowMarkers] = useState(true);
  const [showSplitMarkers, setShowSplitMarkers] = useState(true);
  const [showRestStops, setShowRestStops] = useState(false);
  const [showIntermediateStops, setShowIntermediateStops] = useState(false);
  const [showWindOverlay, setShowWindOverlay] = useState(false);
  const { enableGoogleMaps, userSettings } = useAppSettings();
  const [mapStyle, setMapStyle] = useState<MapTileLayerKey>(() => {
    const def = userSettings.defaultMapStyle ?? "osm";
    return GOOGLE_TILE_LAYER_KEYS.has(def) && !enableGoogleMaps ? "osm" : def;
  });
  const [resolvedGoogleUrl, setResolvedGoogleUrl] = useState<string | null>(
    null,
  );
  const [selectedSegIdx, setSelectedSegIdx] = useState<number | null>(null);
  const [hoverKm, setHoverKm] = useState<number | null>(null);
  const [hoverWeatherPt, setHoverWeatherPt] =
    useState<HourlyWeatherPoint | null>(null);
  const [elevZoomRange, setElevZoomRange] = useState<[number, number] | null>(
    null,
  );
  const [tempZoomKey, setTempZoomKey] = useState<{
    segIdx: number;
    splitIdx?: number;
  } | null>(null);
  const [, startSelectionTransition] = useTransition();

  // Throttle hover updates to one per animation frame — mousemove fires at
  // ~200 Hz but we only need ~60 fps for the map marker.
  const rafId = useRef<number | null>(null);
  const handleHoverKm = useCallback((km: number | null) => {
    if (rafId.current !== null) cancelAnimationFrame(rafId.current);
    rafId.current = requestAnimationFrame(() => {
      rafId.current = null;
      setHoverKm(km);
    });
  }, []);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  useEffect(() => {
    if (!GOOGLE_TILE_LAYER_KEYS.has(mapStyle)) {
      setResolvedGoogleUrl(null);
      return;
    }
    const type =
      mapStyle === "googleRoadmap"
        ? "roadmap"
        : mapStyle === "googleSatellite"
          ? "satellite"
          : mapStyle === "googleDark"
            ? "dark"
            : "terrain";
    setResolvedGoogleUrl(null);
    let cancelled = false;
    getGoogleTileUrlTemplate(type)
      .then((url) => {
        if (!cancelled) setResolvedGoogleUrl(url);
      })
      .catch(() => {
        if (!cancelled) setMapStyle("osm");
      });
    return () => {
      cancelled = true;
    };
  }, [mapStyle]);

  // When a segment is deleted the selected segment index may no longer be
  // valid — reset it so handleClickKm doesn't accumulate stale state.
  useEffect(() => {
    if (selectedSegIdx !== null && selectedSegIdx >= formSegments.length) {
      setSelectedSegIdx(null);
      setElevZoomRange(null);
    }
  }, [formSegments.length, selectedSegIdx]);

  // React to external zoom requests from SegmentForm / SplitForm buttons.
  const lastZoomRevRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!zoomTarget || zoomTarget.rev === lastZoomRevRef.current) return;
    lastZoomRevRef.current = zoomTarget.rev;
    startSelectionTransition(() => setSelectedSegIdx(zoomTarget.segIdx));
    requestAnimationFrame(() => {
      if (zoomTarget.splitIdx != null) {
        fitToSplit(zoomTarget.segIdx, zoomTarget.splitIdx);
        // Zoom elevation profile to the split's km range
        const prof = gpxProfiles?.[zoomTarget.segIdx]?.[zoomTarget.splitIdx];
        if (prof) {
          setElevZoomRange([prof.startKm, prof.endKm]);
        }
      } else {
        fitToSegment(zoomTarget.segIdx);
        // Zoom elevation profile to the segment's km range
        const segProfiles = gpxProfiles?.[zoomTarget.segIdx];
        if (segProfiles && segProfiles.length > 0) {
          setElevZoomRange([
            segProfiles[0].startKm,
            segProfiles[segProfiles.length - 1].endKm,
          ]);
        }
      }
      setTempZoomKey(
        zoomTarget.splitIdx != null
          ? { segIdx: zoomTarget.segIdx, splitIdx: zoomTarget.splitIdx }
          : { segIdx: zoomTarget.segIdx },
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomTarget]);

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }

  function fitToSegment(si: number) {
    const seg = segmentPolylines.find((p) => p.segIdx === si);
    if (!seg || seg.positions.length === 0 || !mapRef.current) return;
    let minLat = Infinity,
      maxLat = -Infinity,
      minLon = Infinity,
      maxLon = -Infinity;
    for (const [lat, lon] of seg.positions) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
    }
    mapRef.current.fitBounds(
      [
        [minLat, minLon],
        [maxLat, maxLon],
      ],
      { padding: [32, 32] },
    );
  }

  function flyToPoint(lat: number, lon: number) {
    mapRef.current?.flyTo([lat, lon], 13);
  }

  function fitToSplit(segIdx: number, splitIdx: number) {
    const profile = gpxProfiles?.[segIdx]?.[splitIdx];
    if (!profile || !mapRef.current) return;
    const slice = sliceTrackPoints(gpxTrack, profile.startKm, profile.endKm);
    if (slice.length < 2) return;
    let minLat = Infinity,
      maxLat = -Infinity,
      minLon = Infinity,
      maxLon = -Infinity;
    for (const { lat, lon } of slice) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
    }
    mapRef.current.fitBounds(
      [
        [minLat, minLon],
        [maxLat, maxLon],
      ],
      { padding: [40, 40] },
    );
  }

  const handleClickKm = useCallback(
    (km: number) => {
      if (!gpxProfiles) return;
      for (let si = 0; si < gpxProfiles.length; si++) {
        for (let sj = 0; sj < gpxProfiles[si].length; sj++) {
          const p = gpxProfiles[si][sj];
          if (km >= p.startKm - 0.001 && km <= p.endKm + 0.001) {
            // Mark as low-priority so the current frame paints first.
            startSelectionTransition(() => {
              setSelectedSegIdx(si);
            });
            // Zoom elevation profile and forecast chart to this split.
            setElevZoomRange([p.startKm, p.endKm]);
            setTempZoomKey({ segIdx: si, splitIdx: sj });
            // Defer the expensive sliceTrackPoints call to after paint.
            requestAnimationFrame(() => fitToSplit(si, sj));
            return;
          }
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gpxProfiles],
  );

  if (polyline.length < 2) return null;

  const legendSegments = formSegments.map((seg, si) => ({
    color: SEGMENT_COLORS[si % SEGMENT_COLORS.length],
    name:
      seg.name?.trim() ||
      (formSegments.length > 1 ? `Segment ${si + 1}` : "Route"),
  }));
  const finishMarker = markers.find((m) => m.role === "finish");
  const finishColor = finishMarker
    ? SEGMENT_COLORS[finishMarker.segIdx % SEGMENT_COLORS.length]
    : null;

  const activeTileUrl = GOOGLE_TILE_LAYER_KEYS.has(mapStyle)
    ? resolvedGoogleUrl
    : MAP_TILE_LAYERS[mapStyle].url;

  return (
    <div className="course-map-outer">
      <div className="course-map-container" ref={containerRef}>
        <div className="map-controls-stack">
          <select
            className="map-tile-select"
            value={mapStyle}
            onChange={(e) => setMapStyle(e.target.value as MapTileLayerKey)}
            title="Map style"
            aria-label="Map style"
          >
            {(Object.keys(MAP_TILE_LAYERS) as MapTileLayerKey[])
              .filter(
                (key) => !GOOGLE_TILE_LAYER_KEYS.has(key) || enableGoogleMaps,
              )
              .map((key) => (
                <option key={key} value={key}>
                  {MAP_TILE_LAYERS[key].label}
                </option>
              ))}
          </select>
          {document.fullscreenEnabled && (
            <button
              className="map-fullscreen-btn"
              onClick={toggleFullscreen}
              title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
              aria-label={
                isFullscreen ? "Exit fullscreen" : "View map fullscreen"
              }
            >
              {isFullscreen ? (
                // compress icon
                <svg
                  viewBox="0 0 24 24"
                  width="16"
                  height="16"
                  fill="currentColor"
                >
                  <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" />
                </svg>
              ) : (
                // expand icon
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
            className="map-markers-btn"
            onClick={() => setShowMarkers((v) => !v)}
            title={showMarkers ? "Hide mile markers" : "Show mile markers"}
            aria-label={showMarkers ? "Hide mile markers" : "Show mile markers"}
            style={{ opacity: showMarkers ? 1 : 0.5 }}
          >
            <i className="fa-solid fa-map-location-dot" />
          </button>
          <button
            className="map-split-markers-btn"
            onClick={() => setShowSplitMarkers((v) => !v)}
            title={
              showSplitMarkers ? "Hide split endpoints" : "Show split endpoints"
            }
            aria-label={
              showSplitMarkers ? "Hide split endpoints" : "Show split endpoints"
            }
            style={{ opacity: showSplitMarkers ? 1 : 0.5 }}
          >
            <i className="fa-solid fa-location-pin" />
          </button>
          <button
            className="map-stop-btn"
            onClick={() => setShowRestStops((v) => !v)}
            title={
              showRestStops
                ? "Hide rest stop markers"
                : "Show rest stop markers"
            }
            aria-label={
              showRestStops
                ? "Hide rest stop markers"
                : "Show rest stop markers"
            }
            style={{ opacity: showRestStops ? 1 : 0.5, color: "#a855f7" }}
          >
            <i className="fa-solid fa-location-dot" />
          </button>
          <button
            className="map-stop-btn"
            onClick={() => setShowIntermediateStops((v) => !v)}
            title={
              showIntermediateStops
                ? "Hide intermediate stop markers"
                : "Show intermediate stop markers"
            }
            aria-label={
              showIntermediateStops
                ? "Hide intermediate stop markers"
                : "Show intermediate stop markers"
            }
            style={{
              opacity: showIntermediateStops ? 1 : 0.5,
              color: "#f59e0b",
            }}
          >
            <i className="fa-solid fa-location-dot" />
          </button>
          {hourlyWeather && hourlyWeather.length > 0 && (
            <button
              className="map-wind-btn"
              onClick={() => setShowWindOverlay((v) => !v)}
              title={
                showWindOverlay ? "Hide wind overlay" : "Show wind overlay"
              }
              aria-label={
                showWindOverlay ? "Hide wind overlay" : "Show wind overlay"
              }
              style={{ opacity: showWindOverlay ? 1 : 0.5 }}
            >
              <i className="fa-solid fa-wind" />
            </button>
          )}
        </div>
        <MapContainer
          ref={mapRef}
          bounds={bounds}
          boundsOptions={{ padding: [24, 24] }}
          scrollWheelZoom={true}
          style={{ height: "100%", width: "100%" }}
        >
          <Pane name="route-lines" style={{ zIndex: 393 }} />
          <Pane name="route-labels" style={{ zIndex: 397 }} />
          <MapVisibilityInvalidator />
          <ScrollWheelActivator />
          {showMarkers && (
            <ZoomableMarkers gpxTrack={gpxTrack} unitSystem={unitSystem} />
          )}
          {activeTileUrl != null && (
            <TileLayer
              key={mapStyle}
              url={activeTileUrl}
              attribution={MAP_TILE_LAYERS[mapStyle].attribution}
              maxZoom={MAP_TILE_LAYERS[mapStyle].maxZoom}
            />
          )}
          {/* Ghost track — always visible; covers sections with no splits assigned */}
          <Polyline
            positions={polyline as LatLngExpression[]}
            pathOptions={{ color: "#64748b", weight: 3, opacity: 0.6 }}
            pane="route-lines"
          />
          {/* Colored segment overlays — paint over the ghost where splits are defined */}
          {segmentPolylines.map(({ positions, segIdx, isTransit }) => (
            <Polyline
              key={segIdx}
              positions={positions as LatLngExpression[]}
              pathOptions={{
                color: SEGMENT_COLORS[segIdx % SEGMENT_COLORS.length],
                weight: 3,
                opacity: 0.85,
                dashArray: isTransit ? "12 12" : undefined,
              }}
              pane="route-lines"
            />
          ))}
          {markers.map((m, i) =>
            m.role === "stop" ? (
              showRestStops ? (
                <StopMarker key={i} m={m} onMarkerClick={onMarkerClick} />
              ) : null
            ) : m.role === "intermediate" ? (
              showIntermediateStops ? (
                <IntermediateStopMarker
                  key={i}
                  m={m}
                  onMarkerClick={onMarkerClick}
                />
              ) : null
            ) : showSplitMarkers ? (
              <SplitMarker
                key={i}
                m={m}
                color={
                  m.role === "split" || m.role === "finish"
                    ? SEGMENT_COLORS[m.segIdx % SEGMENT_COLORS.length]
                    : MARKER_COLORS[m.role]
                }
                onMarkerClick={onMarkerClick}
              />
            ) : null,
          )}
          {hoverKm !== null &&
            (() => {
              const pt = interpolateLatLon(gpxTrack, hoverKm);
              return pt ? (
                <CircleMarker
                  center={[pt.lat, pt.lon]}
                  radius={7}
                  pathOptions={{
                    color: "#fff",
                    weight: 2.5,
                    fillColor: "#f97316",
                    fillOpacity: 1,
                  }}
                  interactive={false}
                  pane="route-labels"
                />
              ) : null;
            })()}
          {/* Temperature chart hover dot */}
          {hoverWeatherPt !== null && (
            <CircleMarker
              center={[hoverWeatherPt.lat, hoverWeatherPt.lon]}
              radius={7}
              pathOptions={{
                color: "#fff",
                weight: 2.5,
                fillColor: "#60a5fa",
                fillOpacity: 1,
              }}
              interactive={false}
              pane="route-labels"
            />
          )}
          {/* Wind overlay — one arrow per hourly sample */}
          {showWindOverlay &&
            hourlyWeather &&
            hourlyWeather.map((pt, i) => {
              // ── Scale constants — adjust these to taste ──────────────────
              /** px at 0 km/h wind */
              const ARROW_MIN = 12;
              /** px at max wind */
              const ARROW_MAX = 64;
              /** wind speed (km/h) that maps to ARROW_MAX */
              const SPEED_AT_MAX = 60;
              // ─────────────────────────────────────────────────────────────
              const sz = Math.round(
                ARROW_MIN +
                  (ARROW_MAX - ARROW_MIN) *
                    Math.min(pt.weather.windSpeed / SPEED_AT_MAX, 1),
              );
              const half = sz / 2;
              // Arrow drawn in a 0 0 10 20 viewBox: shaft + arrowhead
              // Shaft runs from (5,18) up to (5,8); head is a triangle at the top
              const arrowSvg = `<svg viewBox="0 0 10 20" width="${sz}" height="${sz}" xmlns="http://www.w3.org/2000/svg" style="transform:rotate(${
                (pt.weather.windDirection + 180) % 360
              }deg);transform-origin:50% 50%;display:block;overflow:visible"><line x1="5" y1="18" x2="5" y2="9" stroke="rgba(255,255,255,0.9)" stroke-width="2.5" stroke-linecap="round"/><line x1="5" y1="18" x2="5" y2="9" stroke="#111827" stroke-width="1" stroke-linecap="round"/><polygon points="5,1 9,10 5,7 1,10" fill="#111827" stroke="rgba(255,255,255,0.9)" stroke-width="1.2" stroke-linejoin="round"/></svg>`;
              return (
                <Marker
                  key={i}
                  position={[pt.lat, pt.lon]}
                  icon={divIcon({
                    html: arrowSvg,
                    className: "",
                    iconSize: [sz, sz],
                    iconAnchor: [half, half],
                  })}
                  pane="route-labels"
                >
                  <Popup>
                    <div style={{ fontSize: "0.75rem", lineHeight: 1.5 }}>
                      <strong>
                        {new Date(pt.timeIso).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </strong>
                      <br />
                      Wind:{" "}
                      {unitSystem === "imperial"
                        ? Math.round(pt.weather.windSpeed / 1.60934)
                        : Math.round(pt.weather.windSpeed)}{" "}
                      {unitSystem === "imperial" ? "mph" : "km/h"} from{" "}
                      {
                        [
                          "N",
                          "NNE",
                          "NE",
                          "ENE",
                          "E",
                          "ESE",
                          "SE",
                          "SSE",
                          "S",
                          "SSW",
                          "SW",
                          "WSW",
                          "W",
                          "WNW",
                          "NW",
                          "NNW",
                        ][Math.round(pt.weather.windDirection / 22.5) % 16]
                      }
                      {pt.weather.windGusts > pt.weather.windSpeed
                        ? ` (gusts ${unitSystem === "imperial" ? Math.round(pt.weather.windGusts / 1.60934) : Math.round(pt.weather.windGusts)} ${unitSystem === "imperial" ? "mph" : "km/h"})`
                        : ""}
                      <br />
                      Temp:{" "}
                      {unitSystem === "imperial"
                        ? Math.round((pt.weather.temperature * 9) / 5 + 32)
                        : Math.round(pt.weather.temperature)}
                      {unitSystem === "imperial" ? "°F" : "°C"}
                    </div>
                  </Popup>
                </Marker>
              );
            })}
        </MapContainer>
      </div>
      {/* ── Legend ── */}
      <div className="course-map-legend">
        <div className="cml-nodes">
          <div
            className="cml-item cml-item--clickable"
            onClick={() => flyToPoint(gpxTrack[0].lat, gpxTrack[0].lon)}
            title="Zoom to course start"
          >
            <span
              className="cml-dot"
              style={{ background: MARKER_COLORS.start }}
            />
            <span className="cml-label">Course Start</span>
          </div>
          {finishMarker && (
            <div
              className="cml-item cml-item--clickable"
              onClick={() => flyToPoint(finishMarker.lat, finishMarker.lon)}
              title="Zoom to last configured split"
            >
              <span
                className="cml-dot"
                style={{ background: finishColor ?? MARKER_COLORS.finish }}
              />
              <span className="cml-label">Segment Finish</span>
            </div>
          )}
          <div
            className="cml-item cml-item--clickable"
            onClick={() => {
              const last = gpxTrack[gpxTrack.length - 1];
              flyToPoint(last.lat, last.lon);
            }}
            title="Zoom to end of GPX track"
          >
            <span className="cml-dot" style={{ background: "#f87171" }} />
            <span className="cml-label">Course Finish</span>
          </div>
          <div
            className="cml-item cml-item--clickable"
            title="If a stop is configured at a split, a marker will appear here. Click it to zoom to the split and configure the stop details."
          >
            <span className="cml-dot" style={{ background: "#a855f7" }} />
            <span className="cml-label">Rest Stop</span>
          </div>
        </div>
        <div className="cml-segments">
          {legendSegments.map((seg, i) => (
            <div
              key={i}
              className={`cml-item cml-item--clickable${selectedSegIdx === i ? " cml-item--active" : ""}`}
              onClick={() => {
                fitToSegment(i);
                startSelectionTransition(() => {
                  setSelectedSegIdx(i);
                });
                // Toggle elevation zoom to this segment's range.
                const segProfiles = gpxProfiles?.[i];
                if (segProfiles && segProfiles.length > 0) {
                  const segStart = segProfiles[0].startKm;
                  const segEnd = segProfiles[segProfiles.length - 1].endKm;
                  const alreadyZoomed =
                    elevZoomRange &&
                    elevZoomRange[0] === segStart &&
                    elevZoomRange[1] === segEnd;
                  setElevZoomRange(alreadyZoomed ? null : [segStart, segEnd]);
                  setTempZoomKey(alreadyZoomed ? null : { segIdx: i });
                } else {
                  // No profiles yet — clear any stale zoom.
                  setElevZoomRange(null);
                  setTempZoomKey(null);
                }
              }}
              title={`Zoom to ${seg.name}`}
            >
              <span className="cml-line" style={{ background: seg.color }} />
              <span className="cml-label">{seg.name}</span>
            </div>
          ))}
        </div>
        {/* Elevation panel — always shows the full course.
             Segment ranges are colour-coded with their legend colour; any track
             portion not covered by a segment uses the default neutral style.
             Clicking a split section zooms the map to that split; clicks on
             uncovered gaps have no effect. */}
        {(() => {
          // Build the flat split list and per-segment colour ranges.
          const flatProfiles: SplitGpxProfile[] = gpxProfiles?.flat() ?? [];
          const activeSegColors = gpxProfiles
            ? gpxProfiles.flatMap((seg, si) =>
                seg.length > 0
                  ? [
                      {
                        startKm: seg[0].startKm,
                        endKm: seg[seg.length - 1].endKm,
                        color: SEGMENT_COLORS[
                          si % SEGMENT_COLORS.length
                        ] as string,
                      },
                    ]
                  : [],
              )
            : undefined;

          // Derive the elevation panel title from the current zoom state.
          let elevTitle = courseName ? `Elevation: ${courseName}` : "Elevation";
          if (elevZoomRange && gpxProfiles) {
            let zoomSegIdx: number | null = null;
            let zoomSplitIdx: number | null = null;
            outer: for (let si = 0; si < gpxProfiles.length; si++) {
              const seg = gpxProfiles[si];
              if (!seg.length) continue;
              if (
                Math.abs(seg[0].startKm - elevZoomRange[0]) < 0.01 &&
                Math.abs(seg[seg.length - 1].endKm - elevZoomRange[1]) < 0.01
              ) {
                zoomSegIdx = si;
                break;
              }
              for (let sj = 0; sj < seg.length; sj++) {
                if (
                  Math.abs(seg[sj].startKm - elevZoomRange[0]) < 0.01 &&
                  Math.abs(seg[sj].endKm - elevZoomRange[1]) < 0.01
                ) {
                  zoomSegIdx = si;
                  zoomSplitIdx = sj;
                  break outer;
                }
              }
            }
            if (zoomSegIdx !== null) {
              const segName =
                legendSegments[zoomSegIdx]?.name ?? `Segment ${zoomSegIdx + 1}`;
              if (zoomSplitIdx !== null) {
                const rawSplitName =
                  formSegments[zoomSegIdx]?.splits[zoomSplitIdx]?.name?.trim();
                const splitLabel =
                  rawSplitName ||
                  (formSegments.length > 1
                    ? `Seg ${zoomSegIdx + 1} · Split ${zoomSplitIdx + 1}`
                    : `Split ${zoomSplitIdx + 1}`);
                elevTitle = `Elevation: ${segName} > ${splitLabel}`;
              } else {
                elevTitle = `Elevation: ${segName}`;
              }
            }
          }

          return (
            <div className="cml-elev-panel">
              <div className="cml-elev-header">
                <span className="cml-elev-title">{elevTitle}</span>
                {(elevZoomRange || tempZoomKey) && (
                  <button
                    type="button"
                    className="cml-elev-reset"
                    onClick={() => {
                      setElevZoomRange(null);
                      setTempZoomKey(null);
                    }}
                    title="Return to full course view"
                  >
                    <i className="fa-solid fa-arrow-rotate-left" /> Reset
                  </button>
                )}
              </div>
              <Suspense fallback={null}>
                <ElevationProfile
                  gpxTrack={gpxTrack}
                  gpxProfiles={flatProfiles}
                  unitSystem={unitSystem}
                  onHoverKm={handleHoverKm}
                  onClickKm={gpxProfiles ? handleClickKm : undefined}
                  segmentColors={activeSegColors}
                  zoomRange={elevZoomRange}
                  onZoomChange={setElevZoomRange}
                />
              </Suspense>
            </div>
          );
        })()}
        {/* Temperature chart — shown once hourly weather is fetched */}
        {hourlyWeather &&
          hourlyWeather.length >= 2 &&
          courseTz &&
          (() => {
            // Compute zoom domain from hourlyWeather when a zoom key is set
            let tempZoomDomain: [number, number] | null = null;
            let tempZoomLabel: string | undefined;
            if (tempZoomKey) {
              const pts =
                tempZoomKey.splitIdx !== undefined
                  ? hourlyWeather.filter(
                      (p) =>
                        p.segIdx === tempZoomKey.segIdx &&
                        p.splitIdx === tempZoomKey.splitIdx,
                    )
                  : hourlyWeather.filter(
                      (p) => p.segIdx === tempZoomKey.segIdx,
                    );
              if (pts.length >= 2) {
                const times = pts.map((p) => new Date(p.timeIso).getTime());
                const minMs = Math.min(...times);
                const maxMs = Math.max(...times);
                const span = maxMs - minMs;
                const pad = Math.max(span * 0.05, 900_000);
                tempZoomDomain = [minMs - pad, maxMs + pad];
                tempZoomLabel =
                  tempZoomKey.splitIdx !== undefined
                    ? "split view"
                    : "segment view";
              }
            }
            return (
              <div className="cml-elev-panel">
                <div className="cml-elev-header">
                  <span className="cml-elev-title">
                    <i className="fa-solid fa-temperature-half" /> Forecast
                    {tempZoomLabel && (
                      <span className="temp-chart-zoom-badge">
                        {tempZoomLabel}
                      </span>
                    )}
                  </span>
                </div>
                <Suspense fallback={null}>
                  <TemperatureChart
                    hourlyWeather={hourlyWeather}
                    courseTz={courseTz}
                    unitSystem={unitSystem}
                    segmentBoundaryTimes={segmentBoundaryTimes}
                    onHoverPoint={setHoverWeatherPt}
                    sunriseSunset={sunriseSunset}
                    zoomDomain={tempZoomDomain}
                    zoomLabel={tempZoomLabel}
                  />
                </Suspense>
              </div>
            );
          })()}
      </div>
    </div>
  );
}
