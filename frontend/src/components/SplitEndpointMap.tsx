import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
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
  AttributionControl,
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
  RestStopForm,
  IntermediateRestStopForm,
} from "../types";
import type { WeekHours } from "../calculator/overpass";
import { sliceTrackPoints, interpolateLatLon } from "../calculator/gpxParser";
import {
  AMENITY_LABELS,
  AMENITY_COLORS,
  queryNearbyAmenities,
} from "../calculator/overpass";
import { reverseGeocode } from "../calculator/geocode";
import {
  useRestStopGeocode,
  useIntermediateStopGeocode,
} from "../calculator/mapUtils";
import {
  MAP_TILE_LAYERS,
  MapTileLayerKey,
  GOOGLE_TILE_LAYER_KEYS,
} from "../calculator/mapTileLayers";
import { getGoogleTileUrlTemplate } from "../calculator/googleTileSession";
import type { NearbyAmenity } from "../calculator/overpass";
import { AmenityContext } from "../amenityContext";
import FindNearbyModal from "./FindNearbyModal";
import { useAppSettings } from "../AppSettingsContext";
import { searchPlacesText } from "../api";

// ── Constants ────────────────────────────────────────────────────────────────

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function fmtDist(m: number, unitSystem: UnitSystem): string {
  if (unitSystem === "imperial") {
    const mi = m / 1609.34;
    return mi < 0.1
      ? `${Math.round(m * 3.28084)} ft`
      : `${mi.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} mi`;
  }
  return m < 1000
    ? `${Math.round(m)} m`
    : `${(m / 1000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km`;
}

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

/** SVG arrowhead DivIcon rotated to face `bearingDeg` (0 = north). */
function makeArrowIcon(bearingDeg: number) {
  return divIcon({
    html: `<svg viewBox="0 0 24 24" width="22" height="22" xmlns="http://www.w3.org/2000/svg"
      style="transform:rotate(${bearingDeg}deg);transform-origin:50% 50%;display:block;overflow:visible">
      <polygon points="12,2 21,21 12,16 3,21"
        fill="#6b8aff" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/>
    </svg>`,
    className: "",
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

/** Dashed-circle icon shown when the split distance is undefined. */
function makeUndefinedEndpointIcon() {
  return divIcon({
    html: `<div style="width:22px;height:22px;border-radius:50%;border:2px dashed #94a3b8;background:rgba(30,30,46,0.75);display:flex;align-items:center;justify-content:center;box-sizing:border-box;"><span style="color:#94a3b8;font-size:13px;font-weight:700;line-height:1">?</span></div>`,
    className: "",
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

function makeRestStopIcon() {
  return divIcon({
    html: '<div class="split-rest-stop-pin"><i class="fa-solid fa-location-dot"></i></div>',
    className: "",
    iconSize: [20, 28],
    iconAnchor: [10, 27],
    popupAnchor: [0, -24],
  });
}

function makeIntermediateStopIcon() {
  return divIcon({
    html: '<div class="split-intermediate-stop-pin"><i class="fa-solid fa-location-dot"></i></div>',
    className: "",
    iconSize: [20, 28],
    iconAnchor: [10, 27],
    popupAnchor: [0, -24],
  });
}

const AMENITY_FA_ICONS: Record<string, string> = {
  fuel: "fa-gas-pump",
  supermarket: "fa-cart-shopping",
  convenience: "fa-store",
  pharmacy: "fa-pills",
  fast_food: "fa-burger",
  cafe: "fa-mug-hot",
  restaurant: "fa-utensils",
  drinking_water: "fa-droplet",
  vending_machine: "fa-coins",
  bench: "fa-person-walking",
  ice_cream: "fa-ice-cream",
  food_court: "fa-bowl-food",
};

function makeAmenityIcon(amenity: string, hasHours: boolean, is24h = false) {
  const faIcon = AMENITY_FA_ICONS[amenity] ?? "fa-location-dot";
  const color = AMENITY_COLORS[amenity] ?? "#94a3b8";
  const cls = is24h
    ? "split-amenity-pin split-amenity-pin--24h"
    : `split-amenity-pin${hasHours ? "" : " split-amenity-pin--no-hours"}`;
  const style = is24h
    ? `background:linear-gradient(135deg,${color} 50%,#4ade80 50%);color:#fff;border-color:rgba(255,255,255,0.3)`
    : `color:${color}`;
  return divIcon({
    html: `<div class="${cls}" style="${style}"><i class="fa-solid ${faIcon}"></i></div>`,
    className: "",
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -13],
  });
}

const DAY_ABBR_SEM = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function fmtTimeCompactSem(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  const suffix = h < 12 ? "a" : "p";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0
    ? `${h12}${suffix}`
    : `${h12}:${String(m).padStart(2, "0")}${suffix}`;
}

function dayEntrySemKey(e: WeekHours[0]): string {
  return `${e.mode}|${e.opens}|${e.closes}`;
}

function formatHoursCompactSem(hours: WeekHours | null): string {
  if (!hours) return "";
  if (hours.every((h) => h.mode === "24h")) return "24/7";
  if (hours.every((h) => h.mode === "closed")) return "Closed all week";
  const groups: { label: string; entry: WeekHours[0] }[] = [];
  let start = 0;
  for (let i = 1; i <= 7; i++) {
    if (i === 7 || dayEntrySemKey(hours[i]) !== dayEntrySemKey(hours[start])) {
      const entry = hours[start];
      const label =
        start === i - 1
          ? DAY_ABBR_SEM[start]
          : `${DAY_ABBR_SEM[start]}\u2013${DAY_ABBR_SEM[i - 1]}`;
      groups.push({ label, entry });
      start = i;
    }
  }
  return groups
    .map((g) => {
      if (g.entry.mode === "24h") return `${g.label}: 24h`;
      if (g.entry.mode === "closed") return `${g.label}: Closed`;
      return `${g.label}: ${fmtTimeCompactSem(g.entry.opens)}\u2013${fmtTimeCompactSem(g.entry.closes)}`;
    })
    .join(" \u00b7 ");
}

function SemPopupHoursGrid({ hours }: { hours: WeekHours }) {
  if (hours.every((h) => h.mode === "24h")) {
    return (
      <span className="popup-hours-badge popup-hours-badge--open">
        <i className="fa-solid fa-clock" aria-hidden="true" /> Open 24/7
      </span>
    );
  }
  if (hours.every((h) => h.mode === "closed")) {
    return (
      <span className="popup-hours-badge popup-hours-badge--closed">
        <i className="fa-solid fa-clock" aria-hidden="true" /> Closed
      </span>
    );
  }
  return (
    <table className="popup-hours-table">
      <tbody>
        {hours.map((entry, idx) => (
          <tr
            key={idx}
            className={`popup-hours-row popup-hours-row--${entry.mode}`}
          >
            <td className="popup-hours-day">{DAY_ABBR_SEM[idx]}</td>
            <td className="popup-hours-time">
              {entry.mode === "24h"
                ? "24h"
                : entry.mode === "closed"
                  ? "Closed"
                  : `${fmtTimeCompactSem(entry.opens)}\u2013${fmtTimeCompactSem(entry.closes)}`}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Find the nearest cumulative-km position on the gpx track to a clicked lat/lon,
 * clamped to [minKm, maxKm]. */
function findNearestKmOnTrack(
  track: GpxTrackPoint[],
  lat: number,
  lon: number,
  minKm: number,
  maxKm: number,
): number {
  let bestKm = (minKm + maxKm) / 2;
  let bestDist2 = Infinity;
  for (const pt of track) {
    if (pt.cumDist < minKm - 0.05 || pt.cumDist > maxKm + 0.05) continue;
    const dlat = pt.lat - lat;
    const dlon = pt.lon - lon;
    const d2 = dlat * dlat + dlon * dlon;
    if (d2 < bestDist2) {
      bestDist2 = d2;
      bestKm = pt.cumDist;
    }
  }
  return bestKm;
}

/** Small distance label pinned to the route. */
function makeTickIcon(label: string) {
  return divIcon({
    html: `<div class="split-map-tick-label">${label}</div>`,
    className: "",
    iconSize: [0, 0],
    iconAnchor: [0, 9],
  });
}

// ── Inner child — must live inside MapContainer ───────────────────────────────

/** Interval between markers in km at given Leaflet zoom level. */
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

/** Subtle route-direction arrow (smaller, white — distinct from the endpoint indicator). */
function makeRouteArrowIcon(bearingDeg: number) {
  return divIcon({
    html: `<svg viewBox="0 0 24 24" width="16" height="16" xmlns="http://www.w3.org/2000/svg" style="transform:rotate(${bearingDeg}deg);transform-origin:50% 50%;display:block;overflow:visible"><polygon points="12,2 20,20 12,15 4,20" fill="rgba(255,255,255,0.70)" stroke="rgba(0,0,0,0.40)" stroke-width="1.5" stroke-linejoin="round"/></svg>`,
    className: "",
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

/**
 * Zoom-adaptive distance labels and direction arrows, covering the full split
 * from startKm to endKm. Anchored at endKm so labels align consistently.
 */
function ZoomableMarkers({
  gpxTrack,
  startKm,
  endKm,
  unitSystem,
}: {
  gpxTrack: GpxTrackPoint[];
  startKm: number;
  endKm: number;
  unitSystem: UnitSystem;
}) {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());
  const [viewport, setViewport] = useState({
    s: -90,
    n: 90,
    w: -180,
    e: 180,
  });

  const readViewport = useCallback(() => {
    try {
      const b = map.getBounds();
      const s = b.getSouth();
      const n = b.getNorth();
      const w = b.getWest();
      const e = b.getEast();
      if (
        !Number.isFinite(s) ||
        !Number.isFinite(n) ||
        !Number.isFinite(w) ||
        !Number.isFinite(e)
      ) {
        return null;
      }
      return { s, n, w, e };
    } catch {
      return null;
    }
  }, [map]);

  useEffect(() => {
    const update = () => {
      setZoom(map.getZoom());
      const nextViewport = readViewport();
      if (nextViewport) setViewport(nextViewport);
    };

    update();
    map.on("zoomend moveend resize load", update);
    return () => {
      map.off("zoomend moveend resize load", update);
    };
  }, [map, readViewport]);

  // Stage 1: precompute all positions within [startKm, endKm] — reruns on zoom/unit/split change
  const allMarkers = useMemo(() => {
    const intervalKm = getIntervalKm(zoom, unitSystem);
    const dLabel = unitSystem === "imperial" ? "mi" : "km";
    const firstN = Math.ceil((startKm - endKm) / intervalKm);
    const lastN = 0; // endKm itself

    const dist: Array<{ km: number; lat: number; lon: number; label: string }> =
      [];
    for (let n = firstN; n <= lastN; n++) {
      const km = endKm + n * intervalKm;
      const pt = interpolateLatLon(gpxTrack, km);
      if (!pt) continue;
      const userDist = unitSystem === "imperial" ? km / 1.60934 : km;
      dist.push({
        km,
        lat: pt.lat,
        lon: pt.lon,
        label: `${userDist.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${dLabel}`,
      });
    }

    const arrow: Array<{
      km: number;
      lat: number;
      lon: number;
      bearing: number;
    }> = [];
    for (let n = firstN; n < lastN; n++) {
      const km = endKm + (n + 0.5) * intervalKm;
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
  }, [gpxTrack, startKm, endKm, zoom, unitSystem]);

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
          icon={makeRouteArrowIcon(m.bearing)}
          interactive={false}
          pane="route-labels"
        />
      ))}
    </>
  );
}

function FitBounds({ bounds }: { bounds: LatLngBoundsExpression }) {
  const map = useMap();
  useEffect(() => {
    map.fitBounds(bounds, { padding: [20, 20] });
  }, [map, bounds]);
  return null;
}

// Calls invalidateSize after mount and whenever the map container resizes.
// Uses map.getContainer() so no external ref is needed — the container is
// always available inside a MapContainer child component.
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

// Scroll wheel zoom is disabled until the user clicks inside the map,
// and re-disabled whenever the mouse leaves — prevents accidental zoom
// while scrolling the page past the map.
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

// ── Main component ────────────────────────────────────────────────────────────

interface SplitEndpointMapProps {
  gpxTrack: GpxTrackPoint[];
  startKm: number;
  endKm: number;
  endLat: number;
  endLon: number;
  endpointDefined?: boolean;
  unitSystem: UnitSystem;
  restStop?: RestStopForm | null;
  onSelectStop?: (patch: Partial<RestStopForm>) => void;
  onSelectIntermediateStop?: (patch: Partial<IntermediateRestStopForm>) => void;
  onAddressLoading?: (loading: boolean) => void;
  /** Hourly weather points for this split's wind overlay. */
  splitHourlyWeather?: HourlyWeatherPoint[] | null;
  /** Intermediate rest stop to display along the split route. */
  intermediateStop?: IntermediateRestStopForm | null;
  /** Pre-computed km position along the track for the intermediate stop. */
  intermediateKm?: number | null;
  /** Called when user clicks the route polyline to place an intermediate stop. */
  onPolylineClick?: (km: number, lat: number, lon: number) => void;
}

export default function SplitEndpointMap({
  gpxTrack,
  startKm,
  endKm,
  endLat,
  endLon,
  endpointDefined = true,
  unitSystem,
  restStop,
  onSelectStop,
  onSelectIntermediateStop,
  splitHourlyWeather,
  intermediateStop,
  intermediateKm,
  onPolylineClick,
}: SplitEndpointMapProps) {
  const [showNearby, setShowNearby] = useState(false);
  const [showList, setShowList] = useState(false);
  const [showMarkers, setShowMarkers] = useState(true);
  const [pendingClick, setPendingClick] = useState<{
    lat: number;
    lon: number;
    km: number;
  } | null>(null);
  const [searchTarget, setSearchTarget] = useState<"main" | "intermediate">(
    "main",
  );
  const { radiusM, selectedTypes, textQuery } = useContext(AmenityContext);
  const { paidApisEnabled, enableGoogleMaps, enableGooglePlaces, user, userSettings } =
    useAppSettings();
  const [amenities, setAmenities] = useState<NearbyAmenity[] | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const [confirmStop, setConfirmStop] = useState<NearbyAmenity | null>(null);
  const confirmDialogRef = useRef<HTMLDialogElement>(null);
  const [usedStopId, setUsedStopId] = useState<number | null>(null);
  const usedStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Remember the lat/lon centre used for the most-recent search so modal
  // re-searches (which don't pass new coords) use the same anchor.
  const searchCenterRef = useRef({ lat: endLat, lon: endLon });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showWindOverlay, setShowWindOverlay] = useState(false);
  const [mapStyle, setMapStyle] = useState<MapTileLayerKey>(() => {
    const def = userSettings.defaultMapStyle ?? "osm";
    return GOOGLE_TILE_LAYER_KEYS.has(def) && !enableGoogleMaps ? "osm" : def;
  });
  const [resolvedGoogleUrl, setResolvedGoogleUrl] = useState<string | null>(
    null,
  );
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);

  // Rest stop coordinates come from form state (set by Overpass selection or
  // the forward-geocode effect below). Reads are passive — writes happen via
  // onSelectStop so state stays in the parent.
  const restStopCoords = useMemo(() => {
    if (restStop?.enabled && restStop?.lat != null && restStop?.lon != null) {
      return { lat: restStop.lat, lon: restStop.lon };
    }
    return null;
  }, [restStop?.enabled, restStop?.lat, restStop?.lon]);
  const restStopIcon = useMemo(() => makeRestStopIcon(), []);
  const intermediateStopIcon = useMemo(() => makeIntermediateStopIcon(), []);

  // Intermediate stop coordinates: prefer stored lat/lon (set by geocoder or
  // map-click coordinate parse) so that changing the address field moves the
  // pin immediately. Fall back to track-derived position only when lat/lon
  // haven't been set yet (e.g. distance edited manually before map is opened).
  const intermediateStopCoords = useMemo(() => {
    if (!intermediateStop?.enabled) return null;
    if (intermediateStop.lat != null && intermediateStop.lon != null) {
      return { lat: intermediateStop.lat, lon: intermediateStop.lon };
    }
    if (intermediateKm != null) {
      const pt = interpolateLatLon(gpxTrack, intermediateKm);
      if (pt) return { lat: pt.lat, lon: pt.lon };
    }
    return null;
  }, [
    intermediateStop?.enabled,
    intermediateStop?.lat,
    intermediateStop?.lon,
    intermediateKm,
    gpxTrack,
  ]);

  // Geocode the rest stop address when the map mounts or the address changes,
  // but only when coords are not already set. This keeps the logic local to the
  // map so it only runs when the user actually opens the split's map panel.
  useRestStopGeocode(restStop, onSelectStop);
  useIntermediateStopGeocode(intermediateStop, onSelectIntermediateStop);

  const isFirstEndpointRender = useRef(true);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      canvasRef.current?.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }

  // Abort any in-flight search on unmount
  useEffect(
    () => () => {
      searchAbortRef.current?.abort();
      if (usedStopTimerRef.current !== null)
        clearTimeout(usedStopTimerRef.current);
    },
    [],
  );

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

  // When the endpoint moves, clear cached results so user re-searches
  useEffect(() => {
    if (isFirstEndpointRender.current) {
      isFirstEndpointRender.current = false;
      return;
    }
    setAmenities(null);
    setShowNearby(false);
    setSearchError(null);
    searchAbortRef.current?.abort();
  }, [endLat, endLon]); // eslint-disable-line react-hooks/exhaustive-deps

  // Track slice: full split from startKm to endKm
  const polyline = useMemo(() => {
    const slice = sliceTrackPoints(gpxTrack, startKm, endKm);
    return decimateTrack(slice);
  }, [gpxTrack, startKm, endKm]);

  // Arrow icon: bearing computed from points 150 m before → 50 m after endpoint
  const arrowIcon = useMemo(() => {
    const p1 = interpolateLatLon(gpxTrack, endKm - 0.15);
    const p2 = interpolateLatLon(gpxTrack, endKm + 0.05) ?? {
      lat: endLat,
      lon: endLon,
    };
    if (!p1) return null;
    const deg = computeBearing(p1.lat, p1.lon, p2.lat, p2.lon);
    return makeArrowIcon(deg);
  }, [gpxTrack, endKm, endLat, endLon]);

  // Bounds: fit the full split polyline; expands to include rest stop coords
  const bounds = useMemo<LatLngBoundsExpression>(() => {
    const pad = 0.002; // ~220 m padding
    if (polyline.length === 0) {
      return [
        [endLat - pad, endLon - pad],
        [endLat + pad, endLon + pad],
      ];
    }
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
    if (restStopCoords) {
      minLat = Math.min(minLat, restStopCoords.lat);
      maxLat = Math.max(maxLat, restStopCoords.lat);
      minLon = Math.min(minLon, restStopCoords.lon);
      maxLon = Math.max(maxLon, restStopCoords.lon);
    }
    if (intermediateStopCoords) {
      minLat = Math.min(minLat, intermediateStopCoords.lat);
      maxLat = Math.max(maxLat, intermediateStopCoords.lat);
      minLon = Math.min(minLon, intermediateStopCoords.lon);
      maxLon = Math.max(maxLon, intermediateStopCoords.lon);
    }
    return [
      [minLat - pad, minLon - pad],
      [maxLat + pad, maxLon + pad],
    ];
  }, [polyline, endLat, endLon, restStopCoords, intermediateStopCoords]);

  const handleSearch = useCallback(
    async (
      overrideRadius?: number,
      overrideTypes?: Set<string>,
      anchorLat?: number,
      anchorLon?: number,
    ) => {
      const searchRadius = overrideRadius ?? radiusM;
      const searchTypes = overrideTypes ?? selectedTypes;
      // Use provided anchor or fall back to the last-used centre
      const lat = anchorLat ?? searchCenterRef.current.lat;
      const lon = anchorLon ?? searchCenterRef.current.lon;
      searchCenterRef.current = { lat, lon };

      const all = [...searchTypes];
      if (all.length === 0) {
        setSearchError("NO_TYPES");
        return;
      }

      searchAbortRef.current?.abort();
      const ctrl = new AbortController();
      searchAbortRef.current = ctrl;
      setSearchLoading(true);
      setSearchError(null);

      try {
        let results = await queryNearbyAmenities(
          lat,
          lon,
          searchRadius,
          ctrl.signal,
          all,
          paidApisEnabled && !!user,
        );
        if (ctrl.signal.aborted) return;
        const byDistThenName = (a: NearbyAmenity, b: NearbyAmenity) =>
          a.distanceM - b.distanceM || a.name.localeCompare(b.name);
        const withHours = results
          .filter((r) => r.hours != null)
          .sort(byDistThenName);
        const noHours = results
          .filter((r) => r.hours == null)
          .sort(byDistThenName);
        results = [...withHours, ...noHours];
        setAmenities(results);
        setShowNearby(true);
      } catch (err: unknown) {
        if ((err as { name?: string }).name === "AbortError") return;
        const msg = (err as { message?: string }).message ?? "";
        if (msg.startsWith("OVERPASS_OOM:")) {
          setSearchError(
            "Search exceeded available memory — try a smaller radius or fewer stop types.",
          );
        } else {
          setSearchError("Search failed. Check your connection and try again.");
        }
      } finally {
        setSearchLoading(false);
      }
    },
    [radiusM, selectedTypes],
  );

  const runNearbySearch = useCallback(
    (anchorLat: number, anchorLon: number, target: "main" | "intermediate") => {
      setSearchTarget(target);
      searchCenterRef.current = { lat: anchorLat, lon: anchorLon };
      if (textQuery.trim() && enableGooglePlaces) {
        searchAbortRef.current?.abort();
        const ctrl = new AbortController();
        searchAbortRef.current = ctrl;
        setSearchLoading(true);
        setSearchError(null);
        searchPlacesText(
          textQuery.trim(),
          anchorLat,
          anchorLon,
          radiusM,
          ctrl.signal,
        )
          .then((raw) => {
            if (ctrl.signal.aborted) return;
            const results: NearbyAmenity[] = raw.map((a) => ({
              id: a.id,
              name: a.name,
              amenity: a.amenity,
              distanceM: a.distance_m,
              lat: a.lat,
              lon: a.lon,
              address: a.address,
              streetLine: a.street_line,
              hasLocality: a.has_locality,
              hours: a.hours ? (a.hours as WeekHours) : null,
              rawHours: a.raw_hours ?? null,
              placeId: a.place_id ?? null,
            }));
            results.sort((a, b) => a.distanceM - b.distanceM);
            setAmenities(results);
            setShowNearby(true);
          })
          .catch((err: unknown) => {
            if ((err as { name?: string }).name === "AbortError") return;
            setSearchError(
              "Text search failed. Check your connection and try again.",
            );
          })
          .finally(() => setSearchLoading(false));
      } else {
        handleSearch(undefined, undefined, anchorLat, anchorLon);
      }
    },
    [textQuery, enableGooglePlaces, radiusM, handleSearch],
  );

  function handleSelect(a: NearbyAmenity) {
    if (a.hours == null) {
      setConfirmStop(a);
      // showModal on next tick so the ref is rendered
      setTimeout(() => confirmDialogRef.current?.showModal(), 0);
      return;
    }
    doSelect(a);
  }

  function doSelect(a: NearbyAmenity) {
    mapRef.current?.flyTo([a.lat, a.lon], 16);
    const isIntermediate = searchTarget === "intermediate";
    const callback = isIntermediate ? onSelectIntermediateStop : onSelectStop;
    if (!callback) return;
    const patch: Partial<RestStopForm> = {
      enabled: true,
      name: a.name,
      lat: a.lat,
      lon: a.lon,
      googlePlaceId: a.placeId ?? undefined,
      ...(a.placeId
        ? { alt: `https://www.google.com/maps/place/?q=place_id:${a.placeId}` }
        : {}),
    };
    if (a.hours) {
      patch.sameHoursEveryDay = false;
      patch.perDay = a.hours;
    } else {
      // No hours data — default to "same daily hours" and "closed"
      patch.sameHoursEveryDay = true;
      patch.allDays = { mode: "closed", opens: "06:00", closes: "22:00" };
    }
    if (a.streetLine && a.hasLocality) {
      callback({
        ...patch,
        address: a.address,
      } as Partial<IntermediateRestStopForm>);
      return;
    }
    if (a.streetLine) {
      reverseGeocode(a.lat, a.lon).then((cityState) => {
        const address = cityState
          ? `${a.streetLine}, ${cityState}`
          : a.streetLine;
        callback({ ...patch, address } as Partial<IntermediateRestStopForm>);
      });
      return;
    }
    callback({
      ...patch,
      address: a.address || `${a.lat.toFixed(6)}, ${a.lon.toFixed(6)}`,
    } as Partial<IntermediateRestStopForm>);
  }

  return (
    <div className="split-endpoint-map">
      <div className="split-endpoint-map-canvas" ref={canvasRef}>
        {/* Empty-result overlay removed — handled in the list panel below */}

        <MapContainer
          ref={mapRef}
          bounds={bounds}
          boundsOptions={{ padding: [20, 20] }}
          scrollWheelZoom={true}
          attributionControl={false}
          style={{ height: "100%", width: "100%" }}
        >
          <AttributionControl position="bottomleft" />
          <Pane name="route-lines" style={{ zIndex: 393 }} />
          <Pane name="route-labels" style={{ zIndex: 397 }} />
          <MapInvalidator />
          <ScrollWheelActivator />
          <FitBounds bounds={bounds} />
          {(() => {
            const activeTileUrl = GOOGLE_TILE_LAYER_KEYS.has(mapStyle)
              ? resolvedGoogleUrl
              : MAP_TILE_LAYERS[mapStyle].url;
            return activeTileUrl != null ? (
              <TileLayer
                key={mapStyle}
                url={activeTileUrl}
                attribution={MAP_TILE_LAYERS[mapStyle].attribution}
                maxZoom={MAP_TILE_LAYERS[mapStyle].maxZoom}
              />
            ) : null;
          })()}

          {/* Zoom-adaptive distance labels and direction arrows */}
          {showMarkers && (
            <ZoomableMarkers
              gpxTrack={gpxTrack}
              startKm={startKm}
              endKm={endKm}
              unitSystem={unitSystem}
            />
          )}

          {/* Route slice polyline */}
          {polyline.length >= 2 && (
            <Polyline
              positions={polyline as LatLngExpression[]}
              pathOptions={{
                color: "#6b8aff",
                weight: 3,
                opacity: 0.85,
                ...(onPolylineClick ? { className: "polyline-clickable" } : {}),
              }}
              pane="route-lines"
              eventHandlers={
                onPolylineClick
                  ? {
                      click: (e) => {
                        const { lat, lng: lon } = e.latlng;
                        const km = findNearestKmOnTrack(
                          gpxTrack,
                          lat,
                          lon,
                          startKm,
                          endKm,
                        );
                        setPendingClick({ lat, lon, km });
                      },
                    }
                  : undefined
              }
            />
          )}

          {/* Intermediate stop placement popup from polyline click */}
          {pendingClick && onPolylineClick && (
            <Popup
              position={[pendingClick.lat, pendingClick.lon]}
              eventHandlers={{ remove: () => setPendingClick(null) }}
            >
              <div className="split-map-popup">
                <strong>Set as Intermediate Stop?</strong>
                <br />
                <span style={{ fontSize: "0.78rem", color: "#94a3b8" }}>
                  {pendingClick.lat.toFixed(5)}, {pendingClick.lon.toFixed(5)}
                </span>
                <br />
                <button
                  type="button"
                  className="split-map-popup-btn"
                  onClick={() => {
                    onPolylineClick(
                      pendingClick.km,
                      pendingClick.lat,
                      pendingClick.lon,
                    );
                    setPendingClick(null);
                  }}
                >
                  Set as Intermediate Stop
                </button>
              </div>
            </Popup>
          )}

          {/* Direction arrow at endpoint */}
          {!endpointDefined ? (
            <Marker
              position={[endLat, endLon]}
              icon={makeUndefinedEndpointIcon()}
            >
              <Popup>
                <strong>Split endpoint</strong>
                <br />
                Distance not yet defined
              </Popup>
            </Marker>
          ) : arrowIcon ? (
            <Marker position={[endLat, endLon]} icon={arrowIcon}>
              <Popup>
                <div className="split-map-popup">
                  <div className="split-map-popup-type-badge">
                    Split Endpoint
                  </div>
                  <div className="split-map-popup-meta">
                    <i
                      className="fa-solid fa-location-dot split-map-popup-row-icon"
                      aria-hidden="true"
                    />
                    {endLat.toFixed(5)}, {endLon.toFixed(5)}
                  </div>
                  <div className="split-map-popup-links">
                    <a
                      href={`https://www.google.com/maps?q=${endLat},${endLon}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Google Maps ↗
                    </a>
                    {" · "}
                    <a
                      href={`https://www.openstreetmap.org/?mlat=${endLat}&mlon=${endLon}#map=15/${endLat}/${endLon}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      OSM ↗
                    </a>
                  </div>
                  {onSelectStop && (
                    <div className="split-map-popup-btn-row">
                      <button
                        type="button"
                        className="split-map-popup-btn split-map-popup-btn--grow"
                        onClick={() => runNearbySearch(endLat, endLon, "main")}
                      >
                        <i
                          className="fa-solid fa-magnifying-glass"
                          aria-hidden="true"
                        />{" "}
                        Nearby Stops
                      </button>
                      <button
                        type="button"
                        className="split-map-popup-btn split-map-popup-btn--icon"
                        onClick={() => {
                          searchCenterRef.current = {
                            lat: endLat,
                            lon: endLon,
                          };
                          setModalOpen(true);
                        }}
                        title="Configure stop criteria"
                      >
                        <i className="fa-solid fa-gear" aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </div>
              </Popup>
            </Marker>
          ) : (
            <CircleMarker
              center={[endLat, endLon]}
              radius={9}
              pathOptions={{
                color: "#1a1a2e",
                weight: 2,
                fillColor: "#f87171",
                fillOpacity: 1,
              }}
            >
              <Popup>
                <div className="split-map-popup">
                  <div className="split-map-popup-type-badge">
                    Split Endpoint
                  </div>
                  <div className="split-map-popup-meta">
                    <i
                      className="fa-solid fa-location-dot split-map-popup-row-icon"
                      aria-hidden="true"
                    />
                    {endLat.toFixed(5)}, {endLon.toFixed(5)}
                  </div>
                  <div className="split-map-popup-links">
                    <a
                      href={`https://www.google.com/maps?q=${endLat},${endLon}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Google Maps ↗
                    </a>
                    {" · "}
                    <a
                      href={`https://www.openstreetmap.org/?mlat=${endLat}&mlon=${endLon}#map=15/${endLat}/${endLon}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      OSM ↗
                    </a>
                  </div>
                  {onSelectStop && (
                    <div className="split-map-popup-btn-row">
                      <button
                        type="button"
                        className="split-map-popup-btn split-map-popup-btn--grow"
                        onClick={() => runNearbySearch(endLat, endLon, "main")}
                      >
                        <i
                          className="fa-solid fa-magnifying-glass"
                          aria-hidden="true"
                        />{" "}
                        Nearby Stops
                      </button>
                      <button
                        type="button"
                        className="split-map-popup-btn split-map-popup-btn--icon"
                        onClick={() => {
                          searchCenterRef.current = {
                            lat: endLat,
                            lon: endLon,
                          };
                          setModalOpen(true);
                        }}
                        title="Configure stop criteria"
                      >
                        <i className="fa-solid fa-gear" aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </div>
              </Popup>
            </CircleMarker>
          )}

          {/* Rest stop marker — purple, geocoded from address */}
          {restStop?.enabled && restStopCoords && (
            <Marker
              position={[restStopCoords.lat, restStopCoords.lon]}
              icon={restStopIcon}
            >
              <Popup>
                <div className="split-map-popup">
                  <div className="split-map-popup-type-badge">
                    <i
                      className="fa-solid fa-flag-checkered split-map-popup-type-icon"
                      aria-hidden="true"
                    />{" "}
                    Rest Stop
                  </div>
                  {(restStop?.name || restStop?.address) && (
                    <div className="split-map-popup-title">
                      <strong>{restStop?.name || restStop?.address}</strong>
                    </div>
                  )}
                  <div className="split-map-popup-meta">
                    <i
                      className="fa-solid fa-location-dot split-map-popup-row-icon"
                      aria-hidden="true"
                    />
                    {restStopCoords.lat.toFixed(5)},{" "}
                    {restStopCoords.lon.toFixed(5)}
                  </div>
                  <div className="split-map-popup-links">
                    <a
                      href={`https://www.google.com/maps?q=${restStopCoords.lat},${restStopCoords.lon}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Google Maps ↗
                    </a>
                    {" · "}
                    <a
                      href={`https://www.openstreetmap.org/?mlat=${restStopCoords.lat}&mlon=${restStopCoords.lon}#map=17/${restStopCoords.lat}/${restStopCoords.lon}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      OSM ↗
                    </a>
                  </div>
                  {onSelectStop && (
                    <div className="split-map-popup-btn-row">
                      <button
                        type="button"
                        className="split-map-popup-btn split-map-popup-btn--grow"
                        onClick={() =>
                          runNearbySearch(
                            restStopCoords.lat,
                            restStopCoords.lon,
                            "main",
                          )
                        }
                      >
                        <i
                          className="fa-solid fa-magnifying-glass"
                          aria-hidden="true"
                        />{" "}
                        Nearby Stops
                      </button>
                      <button
                        type="button"
                        className="split-map-popup-btn split-map-popup-btn--icon"
                        onClick={() => {
                          searchCenterRef.current = {
                            lat: restStopCoords.lat,
                            lon: restStopCoords.lon,
                          };
                          setModalOpen(true);
                        }}
                        title="Configure stop criteria"
                      >
                        <i className="fa-solid fa-gear" aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </div>
              </Popup>
            </Marker>
          )}

          {/* Intermediate rest stop marker — amber, positioned by distance */}
          {intermediateStop?.enabled && intermediateStopCoords && (
            <Marker
              position={[
                intermediateStopCoords.lat,
                intermediateStopCoords.lon,
              ]}
              icon={intermediateStopIcon}
            >
              <Popup>
                <div className="split-map-popup">
                  <div className="split-map-popup-type-badge">
                    <i
                      className="fa-regular fa-flag split-map-popup-type-icon"
                      aria-hidden="true"
                    />{" "}
                    Intermediate Stop
                  </div>
                  {(intermediateStop.name || intermediateStop.address) && (
                    <div className="split-map-popup-title">
                      <strong>
                        {intermediateStop.name || intermediateStop.address}
                      </strong>
                    </div>
                  )}
                  <div className="split-map-popup-meta">
                    <i
                      className="fa-solid fa-location-dot split-map-popup-row-icon"
                      aria-hidden="true"
                    />
                    {intermediateStopCoords.lat.toFixed(5)},{" "}
                    {intermediateStopCoords.lon.toFixed(5)}
                  </div>
                  <div className="split-map-popup-links">
                    <a
                      href={`https://www.google.com/maps?q=${intermediateStopCoords.lat},${intermediateStopCoords.lon}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Google Maps ↗
                    </a>
                    {" · "}
                    <a
                      href={`https://www.openstreetmap.org/?mlat=${intermediateStopCoords.lat}&mlon=${intermediateStopCoords.lon}#map=17/${intermediateStopCoords.lat}/${intermediateStopCoords.lon}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      OSM ↗
                    </a>
                  </div>
                  {onSelectIntermediateStop && (
                    <div className="split-map-popup-btn-row">
                      <button
                        type="button"
                        className="split-map-popup-btn split-map-popup-btn--grow"
                        onClick={() =>
                          runNearbySearch(
                            intermediateStopCoords.lat,
                            intermediateStopCoords.lon,
                            "intermediate",
                          )
                        }
                      >
                        <i
                          className="fa-solid fa-magnifying-glass"
                          aria-hidden="true"
                        />{" "}
                        Nearby Stops
                      </button>
                      <button
                        type="button"
                        className="split-map-popup-btn split-map-popup-btn--icon"
                        onClick={() => {
                          searchCenterRef.current = {
                            lat: intermediateStopCoords.lat,
                            lon: intermediateStopCoords.lon,
                          };
                          setModalOpen(true);
                        }}
                        title="Configure stop criteria"
                      >
                        <i className="fa-solid fa-gear" aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </div>
              </Popup>
            </Marker>
          )}

          {/* Nearby amenity pins — only shown after user requests them */}
          {showNearby &&
            amenities?.map((a) => (
              <Marker
                key={a.id}
                position={[a.lat, a.lon]}
                icon={makeAmenityIcon(
                  a.amenity,
                  a.hours != null,
                  a.hours?.every((d) => d.mode === "24h") ?? false,
                )}
              >
                <Popup>
                  <div className="split-map-popup">
                    <div className="split-map-popup-title">
                      <i
                        className={`fa-solid ${AMENITY_FA_ICONS[a.amenity] ?? "fa-location-dot"} split-map-popup-type-icon`}
                        aria-hidden="true"
                      />
                      <strong>{a.name}</strong>
                    </div>
                    <div className="split-map-popup-type-badge">
                      {AMENITY_LABELS[a.amenity] ?? a.amenity}
                    </div>
                    <div className="split-map-popup-meta">
                      <i
                        className="fa-solid fa-location-dot split-map-popup-row-icon"
                        aria-hidden="true"
                      />
                      {fmtDist(a.distanceM, unitSystem)} away
                      {a.address && (
                        <span className="split-map-popup-addr">
                          {" "}
                          · {a.address}
                        </span>
                      )}
                    </div>
                    <div className="split-map-popup-hours">
                      {a.hours ? (
                        <SemPopupHoursGrid hours={a.hours} />
                      ) : a.rawHours ? (
                        <span className="split-map-popup-hours-raw">
                          <i
                            className="fa-solid fa-clock split-map-popup-row-icon"
                            aria-hidden="true"
                          />
                          {a.rawHours}
                        </span>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className="split-map-popup-btn"
                      onClick={() => handleSelect(a)}
                    >
                      <i className="fa-solid fa-bookmark" aria-hidden="true" />{" "}
                      {searchTarget === "intermediate"
                        ? "Use as Intermediate Stop"
                        : "Use as Rest Stop"}
                    </button>
                  </div>
                </Popup>
              </Marker>
            ))}
          {/* Wind overlay — one arrow per hourly sample */}
          {showWindOverlay &&
            splitHourlyWeather &&
            splitHourlyWeather.map((pt, i) => {
              // ── Scale constants — adjust these to taste ──────────────────
              /** px at 0 km/h wind */
              const ARROW_MIN = 12;
              /** px at max wind */
              const ARROW_MAX = 32;
              /** wind speed (km/h) that maps to ARROW_MAX */
              const SPEED_AT_MAX = 60;
              // ─────────────────────────────────────────────────────────────
              const sz = Math.round(
                ARROW_MIN +
                  (ARROW_MAX - ARROW_MIN) *
                    Math.min(pt.weather.windSpeed / SPEED_AT_MAX, 1),
              );
              const half = sz / 2;
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

        <div className="split-map-controls-stack">
          <select
            className="split-map-tile-select"
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
              mapRef.current?.fitBounds(bounds, { padding: [20, 20] })
            }
            title="Reset view"
            aria-label="Reset map view"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
              <path d="M15 3l2.3 2.3-2.89 2.87 1.42 1.42L18.7 6.7 21 9V3h-6zM3 9l2.3-2.3 2.87 2.89 1.42-1.42L6.7 5.3 9 3H3v6zm6 12l-2.3-2.3 2.89-2.87-1.42-1.42L5.3 17.3 3 15v6h6zm12-6l-2.3 2.3-2.87-2.89-1.42 1.42 2.89 2.87L15 21h6v-6z" />
            </svg>
          </button>
          {/* Distance markers toggle */}
          <button
            type="button"
            className="split-map-markers-btn"
            onClick={() => setShowMarkers((v) => !v)}
            title={
              showMarkers ? "Hide distance markers" : "Show distance markers"
            }
            aria-label={
              showMarkers ? "Hide distance markers" : "Show distance markers"
            }
            style={{ opacity: showMarkers ? 1 : 0.5 }}
          >
            <i className="fa-solid fa-map-location-dot" />
          </button>
          {/* Zoom to split endpoint */}
          <button
            type="button"
            className="split-map-reset-btn"
            onClick={() => mapRef.current?.setView([endLat, endLon], 16)}
            title="Zoom to split endpoint"
            aria-label="Zoom to split endpoint"
          >
            <i className="fa-solid fa-flag-checkered" />
          </button>
          {/* Zoom to rest stop */}
          {restStopCoords && (
            <button
              type="button"
              className="split-map-reset-btn"
              onClick={() =>
                mapRef.current?.setView(
                  [restStopCoords.lat, restStopCoords.lon],
                  17,
                )
              }
              title="Zoom to rest stop"
              aria-label="Zoom to rest stop"
              style={{ color: "#a855f7" }}
            >
              <i className="fa-solid fa-magnifying-glass-location" />
            </button>
          )}
          {/* Zoom to intermediate rest stop */}
          {intermediateStopCoords && (
            <button
              type="button"
              className="split-map-reset-btn"
              onClick={() =>
                mapRef.current?.setView(
                  [intermediateStopCoords.lat, intermediateStopCoords.lon],
                  17,
                )
              }
              title="Zoom to intermediate rest stop"
              aria-label="Zoom to intermediate rest stop"
              style={{ color: "#f59e0b" }}
            >
              <i className="fa-solid fa-magnifying-glass-location" />
            </button>
          )}
          {/* Wind overlay toggle button */}
          {splitHourlyWeather && splitHourlyWeather.length > 0 && (
            <button
              type="button"
              className="split-map-wind-btn"
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
          {/* Stop list toggle */}
          {showNearby && amenities !== null && (
            <button
              type="button"
              className={`split-map-list-toggle${showList ? " split-map-list-toggle--active" : ""}`}
              onClick={() => setShowList((v) => !v)}
              title={showList ? "Hide stop list" : "Show stop list"}
            >
              <i className="fa-solid fa-list" aria-hidden="true" />
            </button>
          )}
        </div>
        {/* Right-side stack: Searching indicator */}
        <div className="split-map-right-stack">
          {searchLoading && (
            <span className="split-map-searching-indicator">Searching…</span>
          )}
        </div>
      </div>
      {/* end canvas */}

      {/* Search error — shown when a search fails */}
      {searchError && (
        <div className="split-map-search-error">
          {searchError === "NO_TYPES" ? (
            <>
              No stop types selected.{" "}
              <button
                type="button"
                className="split-map-configure-link"
                onClick={() => {
                  setSearchError(null);
                  setModalOpen(true);
                }}
              >
                Configure criteria first.
              </button>
            </>
          ) : (
            searchError
          )}
          <button
            type="button"
            className="split-map-search-error-close"
            onClick={() => setSearchError(null)}
            aria-label="Dismiss error"
          >
            ✕
          </button>
        </div>
      )}

      {/* Amenity list — shown whenever a search has been run and results are visible */}
      {showNearby && amenities !== null && showList && (
        <div className="split-map-amenity-list">
          <div className="split-map-amenity-header">
            <span className="split-map-amenity-count">
              {amenities.length} stop{amenities.length !== 1 ? "s" : ""} found
              {" · "}
              <span
                className={`split-map-amenity-target-label${searchTarget === "intermediate" ? " split-map-amenity-target-label--intermediate" : ""}`}
              >
                {searchTarget === "intermediate"
                  ? "for Intermediate Rest Stop"
                  : "for Rest Stop"}
              </span>
            </span>
            <div className="split-map-amenity-header-actions">
              <a
                href={(() => {
                  const all = [...Array.from(selectedTypes)];
                  const query =
                    all.length > 0
                      ? all.map((t) => t.replace(/_/g, "+")).join("+")
                      : "restaurants+gas+stations+supermarkets";
                  return `https://www.google.com/maps/search/${query}/@${endLat},${endLon},14z`;
                })()}
                target="_blank"
                rel="noopener noreferrer"
                className="split-map-amenity-action-btn split-map-amenity-scout-link"
                title="Scout stops in Google Maps"
              >
                🗺️ Scout
              </a>
              <button
                type="button"
                className="split-map-amenity-action-btn"
                onClick={() => setModalOpen(true)}
                title="Update search criteria"
              >
                ⚙️ Update
              </button>
              <button
                type="button"
                className="split-map-amenity-action-btn split-map-amenity-action-btn--close"
                onClick={() => setShowNearby(false)}
                title="Hide results"
              >
                ✕
              </button>
            </div>
          </div>
          {amenities.length === 0 ? (
            <div className="split-map-amenity-empty">
              No stops found within {fmtDist(radiusM, unitSystem)}. Try
              adjusting your search radius or stop types.
            </div>
          ) : (
            amenities.map((a) => (
              <div key={a.id} className="split-map-amenity-row">
                <span className="split-map-amenity-icon">
                  <i
                    className={`fa-solid ${AMENITY_FA_ICONS[a.amenity] ?? "fa-location-dot"}`}
                    aria-hidden="true"
                  />
                </span>
                <div className="split-map-amenity-info">
                  <span className="split-map-amenity-name">{a.name}</span>
                  <span className="split-map-amenity-meta">
                    {AMENITY_LABELS[a.amenity] ?? a.amenity} ·{" "}
                    {fmtDist(a.distanceM, unitSystem)}
                  </span>
                  {a.hours ? (
                    <span
                      className="split-map-amenity-hours"
                      title={a.rawHours ?? undefined}
                    >
                      {formatHoursCompactSem(a.hours)}
                    </span>
                  ) : a.rawHours ? (
                    <span
                      className="split-map-amenity-hours split-map-amenity-hours--raw"
                      title={a.rawHours}
                    >
                      {a.rawHours}
                    </span>
                  ) : (
                    <span className="split-map-amenity-no-hours">
                      <i
                        className="fa-solid fa-clock-rotate-left"
                        aria-hidden="true"
                      />{" "}
                      Hours unknown
                    </span>
                  )}
                  {a.address && (
                    <span className="split-map-amenity-addr" title={a.address}>
                      {a.address}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  className={`split-map-amenity-use-btn${usedStopId === a.id ? " split-map-amenity-use-btn--used" : ""}`}
                  onClick={() => {
                    handleSelect(a);
                    if (usedStopTimerRef.current !== null)
                      clearTimeout(usedStopTimerRef.current);
                    setUsedStopId(a.id);
                    usedStopTimerRef.current = setTimeout(
                      () => setUsedStopId(null),
                      1500,
                    );
                  }}
                >
                  {usedStopId === a.id ? "✓" : "Use"}
                </button>
              </div>
            ))
          )}
        </div>
      )}
      {modalOpen && (
        <FindNearbyModal
          unitSystem={unitSystem}
          onClose={() => setModalOpen(false)}
          onSave={(r, types, tq) => {
            if (tq.trim() && enableGooglePlaces) {
              // Text search via Google Places
              searchAbortRef.current?.abort();
              const ctrl = new AbortController();
              searchAbortRef.current = ctrl;
              setSearchLoading(true);
              setSearchError(null);
              const lat = searchCenterRef.current.lat;
              const lon = searchCenterRef.current.lon;
              searchPlacesText(tq.trim(), lat, lon, r, ctrl.signal)
                .then((raw) => {
                  if (ctrl.signal.aborted) return;
                  const results: NearbyAmenity[] = raw.map((a) => ({
                    id: a.id,
                    name: a.name,
                    amenity: a.amenity,
                    distanceM: a.distance_m,
                    lat: a.lat,
                    lon: a.lon,
                    address: a.address,
                    streetLine: a.street_line,
                    hasLocality: a.has_locality,
                    hours: a.hours ? (a.hours as WeekHours) : null,
                    rawHours: a.raw_hours ?? null,
                    placeId: a.place_id ?? null,
                  }));
                  results.sort((a, b) => a.distanceM - b.distanceM);
                  setAmenities(results);
                  setShowNearby(true);
                })
                .catch((err: unknown) => {
                  if ((err as { name?: string }).name === "AbortError") return;
                  setSearchError(
                    "Text search failed. Check your connection and try again.",
                  );
                })
                .finally(() => setSearchLoading(false));
            } else {
              handleSearch(r, types);
            }
          }}
        />
      )}
      {confirmStop && (
        <dialog
          ref={confirmDialogRef}
          className="legend-modal no-hours-confirm"
          onClose={() => setConfirmStop(null)}
        >
          <div className="legend-header">
            <h2>Hours Unknown</h2>
            <button
              className="legend-close"
              onClick={() => {
                confirmDialogRef.current?.close();
                setConfirmStop(null);
              }}
              aria-label="Close"
            >
              ✕
            </button>
          </div>
          <div className="legend-body no-hours-confirm__body">
            <p>
              <strong>{confirmStop.name}</strong> has no listed hours in
              OpenStreetMap. Visit its Google Maps page to look up hours, then
              enter them manually after adding the stop.
            </p>
            <a
              href={`https://www.google.com/maps/search/${encodeURIComponent(confirmStop.name)}/@${confirmStop.lat},${confirmStop.lon},17z`}
              target="_blank"
              rel="noopener noreferrer"
              className="no-hours-confirm__maps-link"
            >
              🗺️ Open Google Maps to look up hours
            </a>
          </div>
          <div className="legend-footer">
            <button
              type="button"
              className="action-btn action-btn-export"
              onClick={() => {
                const stop = confirmStop;
                confirmDialogRef.current?.close();
                setConfirmStop(null);
                doSelect(stop);
              }}
            >
              Use Anyway
            </button>
          </div>
        </dialog>
      )}
    </div>
  );
}
