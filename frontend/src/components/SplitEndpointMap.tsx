import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Polyline,
  CircleMarker,
  Marker,
  Popup,
  useMap,
} from "react-leaflet";
import { divIcon } from "leaflet";
import type {
  LatLngBoundsExpression,
  LatLngExpression,
  Map as LeafletMap,
} from "leaflet";
import type { GpxTrackPoint, UnitSystem, RestStopForm } from "../types";
import { sliceTrackPoints, interpolateLatLon } from "../calculator/gpxParser";
import { queryNearbyAmenities } from "../calculator/overpass";
import type { NearbyAmenity } from "../calculator/overpass";

// ── Constants ────────────────────────────────────────────────────────────────

/** ±10 mi expressed in km */
const SLICE_KM = 16.0934;
const SEARCH_RADIUS_M = 1609.34;

const AMENITY_ICONS: Record<string, string> = {
  fuel: "⛽",
  supermarket: "🛒",
  convenience: "🏪",
  pharmacy: "💊",
  fast_food: "🍔",
  cafe: "☕",
  restaurant: "🍽️",
};

const AMENITY_LABELS: Record<string, string> = {
  fuel: "Gas Station",
  supermarket: "Grocery",
  convenience: "Convenience",
  pharmacy: "Pharmacy",
  fast_food: "Fast Food",
  cafe: "Café",
  restaurant: "Restaurant",
};

const AMENITY_COLORS: Record<string, string> = {
  fuel: "#fb923c",
  supermarket: "#60a5fa",
  convenience: "#818cf8",
  pharmacy: "#4ade80",
  fast_food: "#fbbf24",
  cafe: "#fbbf24",
  restaurant: "#fbbf24",
};

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
    return mi < 0.1 ? `${Math.round(m * 3.28084)} ft` : `${mi.toFixed(2)} mi`;
  }
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`;
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

/** Small distance label pinned to the route. */
function makeTickIcon(label: string) {
  return divIcon({
    html: `<div class="split-map-tick-label">${label}</div>`,
    className: "",
    iconSize: [48, 18],
    iconAnchor: [24, 9],
  });
}

// ── Inner child — must live inside MapContainer ───────────────────────────────

function FitBounds({ bounds }: { bounds: LatLngBoundsExpression }) {
  const map = useMap();
  useEffect(() => {
    map.fitBounds(bounds, { padding: [20, 20] });
  }, [map, bounds]);
  return null;
}

// ── Main component ────────────────────────────────────────────────────────────

interface SplitEndpointMapProps {
  gpxTrack: GpxTrackPoint[];
  startKm: number;
  endKm: number;
  endLat: number;
  endLon: number;
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
  unitSystem,
  restStop,
  onSelectStop,
  onAddressLoading,
}: SplitEndpointMapProps) {
  const [showNearby, setShowNearby] = useState(false);
  const [amenities, setAmenities] = useState<NearbyAmenity[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const [restStopCoords, setRestStopCoords] = useState<{
    lat: number;
    lon: number;
    type?: string;
    placeClass?: string;
  } | null>(null);
  const geocodeAbortRef = useRef<AbortController | null>(null);
  const geocodeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nameGeocodeAbortRef = useRef<AbortController | null>(null);
  // Track whether the panel was open so the endpoint-change effect can re-fetch
  const showNearbyRef = useRef(false);
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

  // Abort any in-flight requests and pending timers on unmount
  useEffect(
    () => () => {
      abortRef.current?.abort();
      geocodeAbortRef.current?.abort();
      nameGeocodeAbortRef.current?.abort();
      if (geocodeTimerRef.current !== null)
        clearTimeout(geocodeTimerRef.current);
    },
    [],
  );

  // Keep showNearbyRef in sync with state so effects can read it without re-running
  useEffect(() => {
    showNearbyRef.current = showNearby;
  }, [showNearby]);

  // When the endpoint moves, invalidate cached results and re-fetch if panel is open
  useEffect(() => {
    if (isFirstEndpointRender.current) {
      isFirstEndpointRender.current = false;
      return;
    }
    abortRef.current?.abort();
    setAmenities(null);
    setFetchError(null);
    if (!showNearbyRef.current) return;

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    queryNearbyAmenities(endLat, endLon, SEARCH_RADIUS_M, ctrl.signal)
      .then((results) => {
        if (ctrl.signal.aborted) return;
        results.sort((a, b) => a.distanceM - b.distanceM);
        setAmenities(results);
      })
      .catch((err: unknown) => {
        if ((err as { name?: string }).name === "AbortError") return;
        setFetchError("Could not fetch nearby stops.");
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
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

  // Distance tick marks every 1 mi (imperial) or 1 km (metric) along the track slice
  const tickMarks = useMemo(() => {
    const INTERVAL = unitSystem === "imperial" ? 2.5 * 1.60934 : 4.0; // 2.5 mi or 4 km in km
    const startDist = endKm - SLICE_KM;
    const endDist = endKm + SLICE_KM;
    // Anchor at endpoint so ticks are endKm ± n*INTERVAL (e.g. 10.2, 14.2, 6.2…)
    const firstN = Math.ceil((startDist - endKm) / INTERVAL);
    const lastN = Math.floor((endDist - endKm) / INTERVAL);
    const ticks: Array<{
      km: number;
      label: string;
      lat: number;
      lon: number;
    }> = [];
    for (let n = firstN; n <= lastN; n++) {
      const km = endKm + n * INTERVAL;
      const pt = interpolateLatLon(gpxTrack, km);
      if (!pt) continue;
      const label =
        unitSystem === "imperial"
          ? `${(km / 1.60934).toFixed(1)} mi`
          : `${km.toFixed(1)} km`;
      ticks.push({ km, label, lat: pt.lat, lon: pt.lon });
    }
    return ticks;
  }, [gpxTrack, endKm, unitSystem]);

  // Track slice: ±0.5 mi around the endpoint
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

  const handleFindNearby = useCallback(() => {
    setShowNearby(true);
    // If already fetched (or currently fetching), just reveal pins
    if (amenities !== null || loading) return;

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setFetchError(null);

    queryNearbyAmenities(endLat, endLon, SEARCH_RADIUS_M, ctrl.signal)
      .then((results) => {
        if (ctrl.signal.aborted) return;
        results.sort((a, b) => a.distanceM - b.distanceM);
        setAmenities(results);
      })
      .catch((err: unknown) => {
        if ((err as { name?: string }).name === "AbortError") return;
        setFetchError("Could not fetch nearby stops.");
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
  }, [endLat, endLon, amenities, loading]);

  function handleSelect(a: NearbyAmenity) {
    const patch: Partial<RestStopForm> = { enabled: true, name: a.name };
    if (a.hours) {
      patch.sameHoursEveryDay = false;
      patch.perDay = a.hours;
    }
    if (a.address) {
      patch.address = a.address;
      onSelectStop(patch);
      return;
    }
    // No address from Overpass — look it up via Nominatim using the place name
    onSelectStop({ ...patch, address: "" });
    onAddressLoading?.(true);
    nameGeocodeAbortRef.current?.abort();
    const ctrl = new AbortController();
    nameGeocodeAbortRef.current = ctrl;
    fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(a.name)}&format=json&limit=1&addressdetails=1`,
      { signal: ctrl.signal, headers: { "Accept-Language": "en" } },
    )
      .then((r) => r.json())
      .then(
        (
          res: Array<{
            display_name: string;
            address?: {
              house_number?: string;
              road?: string;
              city?: string;
              town?: string;
              village?: string;
              state?: string;
            };
          }>,
        ) => {
          if (ctrl.signal.aborted) return;
          if (res.length === 0) return;
          const ad = res[0].address ?? {};
          const street = [ad.house_number, ad.road].filter(Boolean).join(" ");
          const locality = ad.city ?? ad.town ?? ad.village ?? "";
          const parts = [street, locality, ad.state].filter(Boolean);
          const addr =
            parts.length > 0 ? parts.join(", ") : res[0].display_name;
          onSelectStop({ address: addr });
        },
      )
      .catch(() => {})
      .finally(() => {
        if (!ctrl.signal.aborted) onAddressLoading?.(false);
      });
  }

  return (
    <div className="split-endpoint-map">
      <div className="split-endpoint-map-canvas" ref={canvasRef}>
        {/* Status overlays */}
        {loading && (
          <div className="split-map-status">Searching nearby stops…</div>
        )}
        {fetchError && (
          <div className="split-map-status split-map-status--error">
            {fetchError}
          </div>
        )}
        {showNearby &&
          !loading &&
          amenities !== null &&
          amenities.length === 0 && (
            <div className="split-map-status">
              No stops found within {fmtDist(SEARCH_RADIUS_M, unitSystem)}.
            </div>
          )}

        <MapContainer
          ref={mapRef}
          bounds={bounds}
          boundsOptions={{ padding: [20, 20] }}
          scrollWheelZoom={true}
          style={{ height: "100%", width: "100%" }}
        >
          <FitBounds bounds={bounds} />
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            maxZoom={19}
          />

          {/* Distance tick marks along the route */}
          {tickMarks.map((t) => (
            <Marker
              key={t.km}
              position={[t.lat, t.lon]}
              icon={makeTickIcon(t.label)}
              interactive={false}
              zIndexOffset={-1000}
            />
          ))}

          {/* Route slice polyline */}
          {polyline.length >= 2 && (
            <Polyline
              positions={polyline as LatLngExpression[]}
              pathOptions={{ color: "#6b8aff", weight: 3, opacity: 0.85 }}
            />
          )}

          {/* Direction arrow at endpoint */}
          {arrowIcon ? (
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

        {/* OSM link — inside canvas so it overlays the map */}
        <a
          href={`https://www.openstreetmap.org/?mlat=${endLat}&mlon=${endLon}#map=15/${endLat}/${endLon}`}
          target="_blank"
          rel="noopener noreferrer"
          className="split-map-link"
        >
          Open in OSM ↗
        </a>
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
      </div>
      {/* end canvas */}

      {/* Nearby stops toggle — outside canvas so it's never clipped */}
      <div className="split-map-controls">
        {!showNearby ? (
          <button
            type="button"
            className="nearby-find-btn"
            onClick={handleFindNearby}
          >
            🔍 Find Nearby Stops
          </button>
        ) : (
          <button
            type="button"
            className="nearby-find-btn"
            onClick={() => setShowNearby(false)}
          >
            ✕ Hide Nearby Stops
          </button>
        )}
      </div>

      {/* Amenity list — shown when nearby search has results */}
      {showNearby && amenities && amenities.length > 0 && (
        <div className="split-map-amenity-list">
          {amenities.map((a) => (
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
          ))}
        </div>
      )}
    </div>
  );
}
