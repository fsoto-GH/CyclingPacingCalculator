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
import type { GpxTrackPoint, UnitSystem, RestStopForm } from "../types";
import { sliceTrackPoints, interpolateLatLon } from "../calculator/gpxParser";
import {
  AMENITY_ICONS,
  AMENITY_LABELS,
  AMENITY_COLORS,
} from "../calculator/overpass";
import { reverseGeocode } from "../calculator/geocode";
import type { NearbyAmenity } from "../calculator/overpass";
import { AmenityContext } from "../amenityContext";
import FindNearbyModal from "./FindNearbyModal";

// ── Constants ────────────────────────────────────────────────────────────────

/** ±10 mi expressed in km */
const SLICE_KM = 16.0934;

// Module-level cache — persists across remounts so the same address is never re-fetched
const geocodeCache = new Map<
  string,
  { lat: number; lon: number; type?: string; placeClass?: string } | null
>();

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
 * Zoom-adaptive distance labels and direction arrows, scoped to the ±SLICE_KM
 * window around the split endpoint. Anchored at endKm so labels align consistently.
 */
function ZoomableMarkers({
  gpxTrack,
  endKm,
  unitSystem,
}: {
  gpxTrack: GpxTrackPoint[];
  endKm: number;
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

  // Stage 1: precompute all positions within ±SLICE_KM — reruns on zoom/unit/endpoint change
  const allMarkers = useMemo(() => {
    const intervalKm = getIntervalKm(zoom, unitSystem);
    const startKm = endKm - SLICE_KM;
    const endKmRange = endKm + SLICE_KM;
    const dLabel = unitSystem === "imperial" ? "mi" : "km";
    const firstN = Math.ceil((startKm - endKm) / intervalKm);
    const lastN = Math.floor((endKmRange - endKm) / intervalKm);

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
  }, [gpxTrack, endKm, zoom, unitSystem]);

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
  onSelectStop: (patch: Partial<RestStopForm>) => void;
  onAddressLoading?: (loading: boolean) => void;
}

export default function SplitEndpointMap({
  gpxTrack,
  endKm,
  endLat,
  endLon,
  endpointDefined = true,
  unitSystem,
  restStop,
  onSelectStop,
}: SplitEndpointMapProps) {
  const [showNearby, setShowNearby] = useState(false);
  const { radiusM } = useContext(AmenityContext);
  const [amenities, setAmenities] = useState<NearbyAmenity[] | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmStop, setConfirmStop] = useState<NearbyAmenity | null>(null);
  const confirmDialogRef = useRef<HTMLDialogElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const [restStopCoords, setRestStopCoords] = useState<{
    lat: number;
    lon: number;
    type?: string;
    placeClass?: string;
  } | null>(null);
  const geocodeAbortRef = useRef<AbortController | null>(null);
  const geocodeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  // Abort geocode requests and pending timers on unmount
  useEffect(
    () => () => {
      geocodeAbortRef.current?.abort();
      if (geocodeTimerRef.current !== null)
        clearTimeout(geocodeTimerRef.current);
    },
    [],
  );

  // When the endpoint moves, clear cached results so user re-searches from modal
  useEffect(() => {
    if (isFirstEndpointRender.current) {
      isFirstEndpointRender.current = false;
      return;
    }
    setAmenities(null);
    setShowNearby(false);
  }, [endLat, endLon]); // eslint-disable-line react-hooks/exhaustive-deps

  // Geocode the rest stop address via Nominatim — debounced 600 ms, cached by address
  useEffect(() => {
    const addr = restStop?.address?.trim() ?? "";
    if (!addr) {
      setRestStopCoords(null);
      return;
    }
    // Hit the cache first — avoids re-fetching across remounts or unchanged values
    if (geocodeCache.has(addr)) {
      setRestStopCoords(geocodeCache.get(addr) ?? null);
      return;
    }
    // Debounce: coalesce rapid keystrokes into a single request
    if (geocodeTimerRef.current !== null) clearTimeout(geocodeTimerRef.current);
    geocodeTimerRef.current = setTimeout(() => {
      geocodeAbortRef.current?.abort();
      const ctrl = new AbortController();
      geocodeAbortRef.current = ctrl;
      fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(addr)}&format=json&limit=1`,
        { signal: ctrl.signal, headers: { "Accept-Language": "en" } },
      )
        .then((r) => r.json())
        .then(
          (
            res: Array<{
              lat: string;
              lon: string;
              type?: string;
              class?: string;
            }>,
          ) => {
            if (ctrl.signal.aborted) return;
            const coords =
              res.length > 0
                ? {
                    lat: +res[0].lat,
                    lon: +res[0].lon,
                    type: res[0].type,
                    placeClass: res[0].class,
                  }
                : null;
            geocodeCache.set(addr, coords);
            setRestStopCoords(coords);
          },
        )
        .catch(() => {});
    }, 600);
  }, [restStop?.address]);

  // Track slice: ±SLICE_KM around the endpoint
  const polyline = useMemo(() => {
    const slice = sliceTrackPoints(
      gpxTrack,
      endKm - SLICE_KM,
      endKm + SLICE_KM,
    );
    return decimateTrack(slice);
  }, [gpxTrack, endKm]);

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

  // Bounds: tight pad around endpoint; expands to include geocoded rest stop
  const bounds = useMemo<LatLngBoundsExpression>(() => {
    const pad = 0.002; // ~220 m — forces z15-16
    let minLat = endLat - pad,
      maxLat = endLat + pad;
    let minLon = endLon - pad,
      maxLon = endLon + pad;
    if (restStopCoords) {
      minLat = Math.min(minLat, restStopCoords.lat - pad);
      maxLat = Math.max(maxLat, restStopCoords.lat + pad);
      minLon = Math.min(minLon, restStopCoords.lon - pad);
      maxLon = Math.max(maxLon, restStopCoords.lon + pad);
    }
    return [
      [minLat, minLon],
      [maxLat, maxLon],
    ];
  }, [endLat, endLon, restStopCoords]);

  const handleModalResults = useCallback((results: NearbyAmenity[]) => {
    setAmenities(results);
    setShowNearby(true);
  }, []);

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
    const patch: Partial<RestStopForm> = { enabled: true, name: a.name };
    if (a.hours) {
      patch.sameHoursEveryDay = false;
      patch.perDay = a.hours;
    } else {
      // No hours data — default to "same daily hours" and "closed"
      patch.sameHoursEveryDay = true;
      patch.allDays = { mode: "closed", opens: "06:00", closes: "22:00" };
    }
    if (a.streetLine && a.hasLocality) {
      // Full address: house + street + city/state — use as-is, single call
      onSelectStop({ ...patch, address: a.address });
      return;
    }
    if (a.streetLine) {
      // Partial: have house + street but no city — wait for geocode then single call
      reverseGeocode(a.lat, a.lon).then((cityState) => {
        const address = cityState
          ? `${a.streetLine}, ${cityState}`
          : a.streetLine;
        onSelectStop({ ...patch, address });
      });
      return;
    }
    // No usable address — fall back to coordinates, single call
    onSelectStop({
      ...patch,
      address: `${a.lat.toFixed(6)}, ${a.lon.toFixed(6)}`,
    });
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
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            maxZoom={19}
          />

          {/* Zoom-adaptive distance labels and direction arrows */}
          <ZoomableMarkers
            gpxTrack={gpxTrack}
            endKm={endKm}
            unitSystem={unitSystem}
          />

          {/* Route slice polyline */}
          {polyline.length >= 2 && (
            <Polyline
              positions={polyline as LatLngExpression[]}
              pathOptions={{ color: "#6b8aff", weight: 3, opacity: 0.85 }}
              pane="route-lines"
            />
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
                <strong>Split endpoint</strong>
                <br />
                {endLat.toFixed(5)}, {endLon.toFixed(5)}
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
                <strong>Split endpoint</strong>
                <br />
                {endLat.toFixed(5)}, {endLon.toFixed(5)}
              </Popup>
            </CircleMarker>
          )}

          {/* Rest stop marker — purple, geocoded from address */}
          {restStopCoords && (
            <CircleMarker
              center={[restStopCoords.lat, restStopCoords.lon]}
              radius={9}
              pathOptions={{
                color: "#1a1a2e",
                weight: 2,
                fillColor: "#a855f7",
                fillOpacity: 1,
              }}
            >
              <Popup>
                <strong>Rest Stop</strong>
                {restStopCoords?.type && (
                  <span
                    className="split-map-place-badge"
                    title={restStopCoords.placeClass}
                  >
                    {restStopCoords.type}
                  </span>
                )}
                <br />
                {restStop?.name || restStop?.address}
              </Popup>
            </CircleMarker>
          )}

          {/* Nearby amenity pins — only shown after user requests them */}
          {showNearby &&
            amenities?.map((a) => (
              <CircleMarker
                key={a.id}
                center={[a.lat, a.lon]}
                radius={7}
                pathOptions={{
                  color: "#1a1a2e",
                  weight: 1.5,
                  fillColor: AMENITY_COLORS[a.amenity] ?? "#94a3b8",
                  fillOpacity: 0.95,
                  ...(a.hours == null
                    ? { dashArray: "4 4", color: "#64748b" }
                    : {}),
                }}
              >
                <Popup>
                  <div className="split-map-popup">
                    <div className="split-map-popup-title">
                      <span>{AMENITY_ICONS[a.amenity] ?? "📍"}</span>
                      <strong>{a.name}</strong>
                    </div>
                    <div className="split-map-popup-meta">
                      {fmtDist(a.distanceM, unitSystem)} away
                      {a.address && <> · {a.address}</>}
                    </div>
                    {a.rawHours && (
                      <div className="split-map-popup-hours">{a.rawHours}</div>
                    )}
                    <button
                      type="button"
                      className="split-map-popup-btn"
                      onClick={() => handleSelect(a)}
                    >
                      Use as rest stop
                    </button>
                  </div>
                </Popup>
              </CircleMarker>
            ))}
        </MapContainer>

        {/* Fullscreen button */}
        <button
          type="button"
          className="split-map-fullscreen-btn"
          onClick={toggleFullscreen}
          title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          aria-label={isFullscreen ? "Exit fullscreen" : "View map fullscreen"}
        >
          {isFullscreen ? (
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
              <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
              <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
            </svg>
          )}
        </button>
        {/* Reset view button */}
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
        {/* Right-side stack: Find Nearby → Google Maps → OSM */}
        <div className="split-map-right-stack">
          <button
            type="button"
            className="split-map-nearby-fab"
            onClick={
              amenities !== null && !showNearby
                ? () => setShowNearby(true)
                : showNearby
                  ? () => setShowNearby(false)
                  : () => setModalOpen(true)
            }
            title={
              amenities !== null && !showNearby
                ? "Show nearby results"
                : showNearby
                  ? "Hide nearby results"
                  : "Find nearby stops"
            }
          >
            {amenities !== null && !showNearby
              ? "Show Stops 📍"
              : showNearby
                ? "Hide ✕"
                : "Nearby Stops 📍"}
          </button>
          <a
            href={`https://www.google.com/maps?q=${endLat},${endLon}`}
            target="_blank"
            rel="noopener noreferrer"
            className="split-map-link"
          >
            Open Google Maps ↗
          </a>
          <a
            href={`https://www.openstreetmap.org/?mlat=${endLat}&mlon=${endLon}#map=15/${endLat}/${endLon}`}
            target="_blank"
            rel="noopener noreferrer"
            className="split-map-link"
          >
            Open OSM ↗
          </a>
        </div>
      </div>
      {/* end canvas */}

      {/* Amenity list — shown whenever a search has been run and results are visible */}
      {showNearby && amenities !== null && (
        <div className="split-map-amenity-list">
          <div className="split-map-amenity-header">
            <span className="split-map-amenity-count">
              {amenities.length} stop{amenities.length !== 1 ? "s" : ""} found
            </span>
            <div className="split-map-amenity-header-actions">
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
                  {AMENITY_ICONS[a.amenity] ?? "📍"}
                </span>
                <div className="split-map-amenity-info">
                  <span className="split-map-amenity-name">{a.name}</span>
                  <span className="split-map-amenity-meta">
                    {AMENITY_LABELS[a.amenity] ?? a.amenity} ·{" "}
                    {fmtDist(a.distanceM, unitSystem)}
                    {a.rawHours && <> · {a.rawHours}</>}
                  </span>
                  {!a.hours && (
                    <span className="split-map-amenity-no-hours">
                      ⏰ Hours unknown
                    </span>
                  )}
                  {a.address && (
                    <span className="split-map-amenity-addr">{a.address}</span>
                  )}
                </div>
                <button
                  type="button"
                  className="split-map-amenity-use-btn"
                  onClick={() => handleSelect(a)}
                >
                  Use
                </button>
              </div>
            ))
          )}
        </div>
      )}
      {modalOpen && (
        <FindNearbyModal
          lat={endLat}
          lon={endLon}
          unitSystem={unitSystem}
          onResults={handleModalResults}
          onClose={() => setModalOpen(false)}
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
              className="ghost-btn"
              onClick={() => {
                confirmDialogRef.current?.close();
                setConfirmStop(null);
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="ghost-btn no-hours-confirm__use-btn"
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
