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
  Popup,
  useMap,
  AttributionControl,
} from "react-leaflet";
import type { LatLngBoundsExpression, LatLngExpression } from "leaflet";
import type { Map as LeafletMap } from "leaflet";
import type { GpxTrackPoint, RestStopForm, UnitSystem } from "../types";
import { interpolateLatLon, sliceTrackPoints } from "../calculator/gpxParser";
import {
  decimateTrack,
  fmtDist,
  makeRestStopIcon,
  ScrollWheelActivator,
  useRestStopGeocode,
} from "../calculator/mapUtils";
import { MAP_TILE_LAYERS, MapTileLayerKey } from "../calculator/mapTileLayers";
import {
  AMENITY_ICONS,
  AMENITY_LABELS,
  AMENITY_COLORS,
  queryNearbyAmenities,
} from "../calculator/overpass";
import { reverseGeocode } from "../calculator/geocode";
import type { NearbyAmenity } from "../calculator/overpass";
import { AmenityContext } from "../amenityContext";
import FindNearbyModal from "./FindNearbyModal";
import { useAppSettings } from "../AppSettingsContext";

// ── Helpers ──────────────────────────────────────────────────────────────────

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

// ── Props ─────────────────────────────────────────────────────────────────────

interface TransitSegmentMapProps {
  gpxTrack: GpxTrackPoint[];
  startKm: number;
  endKm: number;
  unitSystem: UnitSystem;
  segmentColor: string;
  restStop?: RestStopForm | null;
  onSelectStop?: (patch: Partial<RestStopForm>) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function TransitSegmentMap({
  gpxTrack,
  startKm,
  endKm,
  unitSystem,
  segmentColor,
  restStop,
  onSelectStop,
}: TransitSegmentMapProps) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [mapStyle, setMapStyle] = useState<MapTileLayerKey>("osm");

  // ── Nearby search state ────────────────────────────────────────────────────
  const { radiusM, selectedTypes, customTypes } = useContext(AmenityContext);
  const { paidApisEnabled } = useAppSettings();
  const [amenities, setAmenities] = useState<NearbyAmenity[] | null>(null);
  const [showNearby, setShowNearby] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const [confirmStop, setConfirmStop] = useState<NearbyAmenity | null>(null);
  const confirmDialogRef = useRef<HTMLDialogElement>(null);
  const [usedStopId, setUsedStopId] = useState<number | null>(null);
  const usedStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Abort in-flight requests on unmount
  useEffect(
    () => () => {
      searchAbortRef.current?.abort();
      if (usedStopTimerRef.current !== null)
        clearTimeout(usedStopTimerRef.current);
    },
    [],
  );

  // ── Route geometry ─────────────────────────────────────────────────────────
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

  const endLat = endPoint?.lat ?? 0;
  const endLon = endPoint?.lon ?? 0;

  // Clear cached search results when the endpoint moves
  const isFirstEndpointRender = useRef(true);
  useEffect(() => {
    if (isFirstEndpointRender.current) {
      isFirstEndpointRender.current = false;
      return;
    }
    setAmenities(null);
    setShowNearby(false);
    setSearchError(null);
    searchAbortRef.current?.abort();
  }, [endKm]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Rest stop ──────────────────────────────────────────────────────────────
  const restStopIcon = useMemo(() => makeRestStopIcon(), []);

  const restStopCoords = useMemo(() => {
    if (restStop?.enabled && restStop?.lat != null && restStop?.lon != null) {
      return { lat: restStop.lat, lon: restStop.lon };
    }
    return null;
  }, [restStop?.enabled, restStop?.lat, restStop?.lon]);

  // Forward-geocode the rest stop address when coords are not yet set
  useRestStopGeocode(restStop, onSelectStop);

  // ── Map bounds ─────────────────────────────────────────────────────────────
  const bounds = useMemo<LatLngBoundsExpression | null>(() => {
    if (!startPoint || !endPoint) return null;

    const lats = [startPoint.lat, endPoint.lat, ...polyline.map((p) => p[0])];
    const lons = [startPoint.lon, endPoint.lon, ...polyline.map((p) => p[1])];

    if (restStopCoords) {
      lats.push(restStopCoords.lat);
      lons.push(restStopCoords.lon);
    }

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
  }, [startPoint, endPoint, polyline, restStopCoords]);

  // ── Fullscreen ─────────────────────────────────────────────────────────────
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

  // ── Nearby search handlers ─────────────────────────────────────────────────
  const handleSearch = useCallback(
    async (
      overrideRadius?: number,
      overrideTypes?: Set<string>,
      overrideCustom?: string,
    ) => {
      const searchRadius = overrideRadius ?? radiusM;
      const searchTypes = overrideTypes ?? selectedTypes;
      const searchCustom = overrideCustom ?? customTypes;

      const custom = searchCustom
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const all = [...searchTypes, ...custom];
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
          endLat,
          endLon,
          searchRadius,
          ctrl.signal,
          all,
          paidApisEnabled,
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
    [endLat, endLon, radiusM, selectedTypes, customTypes],
  );

  function handleSelect(a: NearbyAmenity) {
    if (a.hours == null) {
      setConfirmStop(a);
      setTimeout(() => confirmDialogRef.current?.showModal(), 0);
      return;
    }
    doSelect(a);
  }

  function doSelect(a: NearbyAmenity) {
    const patch: Partial<RestStopForm> = {
      enabled: true,
      name: a.name,
      lat: a.lat,
      lon: a.lon,
    };
    if (a.hours) {
      patch.sameHoursEveryDay = false;
      patch.perDay = a.hours;
    } else {
      patch.sameHoursEveryDay = true;
      patch.allDays = { mode: "closed", opens: "06:00", closes: "22:00" };
    }
    if (a.streetLine && a.hasLocality) {
      onSelectStop?.({ ...patch, address: a.address });
      return;
    }
    if (a.streetLine) {
      reverseGeocode(a.lat, a.lon).then((cityState) => {
        const address = cityState
          ? `${a.streetLine}, ${cityState}`
          : a.streetLine;
        onSelectStop?.({ ...patch, address });
      });
      return;
    }
    onSelectStop?.({
      ...patch,
      address: `${a.lat.toFixed(6)}, ${a.lon.toFixed(6)}`,
    });
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (!startPoint || !endPoint || !bounds) {
    return <div className="map-loading">Transit map unavailable</div>;
  }

  const interactive = !!onSelectStop;

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
            key={mapStyle}
            url={MAP_TILE_LAYERS[mapStyle].url}
            attribution={MAP_TILE_LAYERS[mapStyle].attribution}
            maxZoom={MAP_TILE_LAYERS[mapStyle].maxZoom}
          />

          {/* Dashed transit route */}
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

          {/* Transit start marker */}
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

          {/* Transit end marker */}
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

          {/* Rest stop marker */}
          {restStop?.enabled && restStopCoords && (
            <Marker
              position={[restStopCoords.lat, restStopCoords.lon]}
              icon={restStopIcon}
            >
              <Popup>
                <strong>Rest Stop</strong>
                <br />
                {restStop?.name || restStop?.address}
              </Popup>
            </Marker>
          )}

          {/* Nearby amenity pins */}
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
                    {interactive && (
                      <button
                        type="button"
                        className="split-map-popup-btn"
                        onClick={() => handleSelect(a)}
                      >
                        Use as rest stop
                      </button>
                    )}
                  </div>
                </Popup>
              </CircleMarker>
            ))}
        </MapContainer>

        <div className="split-map-controls-stack">
          <select
            className="split-map-tile-select"
            value={mapStyle}
            onChange={(e) => setMapStyle(e.target.value as MapTileLayerKey)}
            title="Map style"
            aria-label="Map style"
          >
            {(Object.keys(MAP_TILE_LAYERS) as MapTileLayerKey[]).map((key) => (
              <option key={key} value={key}>
                {MAP_TILE_LAYERS[key].label}
              </option>
            ))}
          </select>
          {/* Fullscreen button */}
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
          {/* Reset view button */}
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

        {/* Right-side overlay: nearby stops + external map links */}
        <div className="split-map-right-stack">
          {interactive && (
            <button
              type="button"
              className="split-map-nearby-fab"
              onClick={
                amenities !== null && !showNearby
                  ? () => setShowNearby(true)
                  : showNearby
                    ? () => setShowNearby(false)
                    : () => handleSearch()
              }
              disabled={searchLoading}
              title={
                searchLoading
                  ? "Searching…"
                  : amenities !== null && !showNearby
                    ? "Show nearby results"
                    : showNearby
                      ? "Hide nearby results"
                      : "Search for nearby stops"
              }
            >
              {searchLoading
                ? "Searching…"
                : amenities !== null && !showNearby
                  ? "Show Stops 📍"
                  : showNearby
                    ? "Hide ✕"
                    : "Nearby Stops 📍"}
            </button>
          )}
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

      {/* Search error */}
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

      {/* Amenity list */}
      {showNearby && amenities !== null && (
        <div className="split-map-amenity-list">
          <div className="split-map-amenity-header">
            <span className="split-map-amenity-count">
              {amenities.length} stop{amenities.length !== 1 ? "s" : ""} found
            </span>
            <div className="split-map-amenity-header-actions">
              <a
                href={(() => {
                  const custom = customTypes
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean);
                  const all = [...Array.from(selectedTypes), ...custom];
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
                {interactive && (
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
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Find nearby criteria modal */}
      {modalOpen && (
        <FindNearbyModal
          unitSystem={unitSystem}
          onClose={() => setModalOpen(false)}
          onSave={(r, types, custom) => handleSearch(r, types, custom)}
        />
      )}

      {/* Confirm no-hours stop */}
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
