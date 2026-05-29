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
import { divIcon } from "leaflet";
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
import {
  MAP_TILE_LAYERS,
  MapTileLayerKey,
  GOOGLE_TILE_LAYER_KEYS,
} from "../calculator/mapTileLayers";
import { getGoogleTileUrlTemplate } from "../calculator/googleTileSession";
import {
  AMENITY_ICONS,
  AMENITY_FA_ICONS,
  AMENITY_LABELS,
  AMENITY_COLORS,
  queryNearbyAmenities,
} from "../calculator/overpass";
import { reverseGeocode } from "../calculator/geocode";
import type { NearbyAmenity, WeekHours } from "../calculator/overpass";
import { AmenityContext } from "../amenityContext";
import FindNearbyModal from "./FindNearbyModal";
import { useAppSettings } from "../AppSettingsContext";
import { searchPlacesText } from "../api";

// ── Helpers ──────────────────────────────────────────────────────────────────

const DAY_ABBR = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function fmtTimeCompact(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  const suffix = h < 12 ? "a" : "p";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0
    ? `${h12}${suffix}`
    : `${h12}:${String(m).padStart(2, "0")}${suffix}`;
}

function dayEntryKey(e: WeekHours[0]): string {
  return `${e.mode}|${e.opens}|${e.closes}`;
}

/** Returns a compact human-readable hours summary, e.g. "24/7", "Mon–Fri: 8a–9p · Sat–Sun: 9a–6p" */
function formatHoursCompact(hours: WeekHours | null): string {
  if (!hours) return "";
  if (hours.every((h) => h.mode === "24h")) return "24/7";
  if (hours.every((h) => h.mode === "closed")) return "Closed all week";

  const groups: { label: string; entry: WeekHours[0] }[] = [];
  let start = 0;
  for (let i = 1; i <= 7; i++) {
    if (i === 7 || dayEntryKey(hours[i]) !== dayEntryKey(hours[start])) {
      const entry = hours[start];
      const label =
        start === i - 1
          ? DAY_ABBR[start]
          : `${DAY_ABBR[start]}–${DAY_ABBR[i - 1]}`;
      groups.push({ label, entry });
      start = i;
    }
  }
  return groups
    .map((g) => {
      if (g.entry.mode === "24h") return `${g.label}: 24h`;
      if (g.entry.mode === "closed") return `${g.label}: Closed`;
      return `${g.label}: ${fmtTimeCompact(g.entry.opens)}–${fmtTimeCompact(g.entry.closes)}`;
    })
    .join(" · ");
}

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

/** Small icon using Font Awesome with emoji fallback */
function AmenityFaIcon({
  amenity,
  className,
}: {
  amenity: string;
  className?: string;
}) {
  const fa = AMENITY_FA_ICONS[amenity];
  if (fa) {
    return (
      <i
        className={`fa-solid ${fa}${className ? " " + className : ""}`}
        aria-hidden="true"
      />
    );
  }
  return <span className={className}>{AMENITY_ICONS[amenity] ?? "📍"}</span>;
}

/** Compact hours grid for the map popup */
function PopupHoursGrid({ hours }: { hours: WeekHours }) {
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
            <td className="popup-hours-day">{DAY_ABBR[idx]}</td>
            <td className="popup-hours-time">
              {entry.mode === "24h"
                ? "24h"
                : entry.mode === "closed"
                  ? "Closed"
                  : `${fmtTimeCompact(entry.opens)}–${fmtTimeCompact(entry.closes)}`}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
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
    let alive = true;
    const recenter = () => {
      if (!alive) return;
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
      alive = false;
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
  const [resolvedGoogleUrl, setResolvedGoogleUrl] = useState<string | null>(
    null,
  );

  // ── Nearby search state ────────────────────────────────────────────────────
  const { radiusM, selectedTypes, textQuery } = useContext(AmenityContext);
  const {
    paidApisEnabled,
    enableGoogleMaps,
    enableGooglePlaces,
    user,
    userSettings,
  } = useAppSettings();
  const [mapStyle, setMapStyle] = useState<MapTileLayerKey>(() => {
    const def = userSettings.defaultMapStyle ?? "osm";
    return GOOGLE_TILE_LAYER_KEYS.has(def) && !enableGoogleMaps ? "osm" : def;
  });
  const [amenities, setAmenities] = useState<NearbyAmenity[] | null>(null);
  const [showNearby, setShowNearby] = useState(false);
  const [showList, setShowList] = useState(false);
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
    async (overrideRadius?: number, overrideTypes?: Set<string>) => {
      const searchRadius = overrideRadius ?? radiusM;
      const searchTypes = overrideTypes ?? selectedTypes;
      const tq = textQuery.trim();

      searchAbortRef.current?.abort();
      const ctrl = new AbortController();
      searchAbortRef.current = ctrl;
      setSearchLoading(true);
      setSearchError(null);

      // Text search takes priority when Google Places is enabled and a query is set.
      if (tq && paidApisEnabled && enableGooglePlaces) {
        searchPlacesText(tq, endLat, endLon, searchRadius, ctrl.signal)
          .then((raw) => {
            if (ctrl.signal.aborted) return;
            const results: NearbyAmenity[] = raw
              .map((a) => ({
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
              }))
              .sort((a, b) => a.distanceM - b.distanceM);
            setAmenities(results);
            setShowNearby(true);
            setShowList(true);
          })
          .catch((err: unknown) => {
            if ((err as { name?: string }).name === "AbortError") return;
            setSearchError(
              "Text search failed. Check your connection and try again.",
            );
          })
          .finally(() => setSearchLoading(false));
        return;
      }

      const all = [...searchTypes];
      if (all.length === 0) {
        setSearchLoading(false);
        setSearchError("NO_TYPES");
        return;
      }

      try {
        let results = await queryNearbyAmenities(
          endLat,
          endLon,
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
        setShowList(true);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      endLat,
      endLon,
      radiusM,
      selectedTypes,
      textQuery,
      paidApisEnabled,
      enableGooglePlaces,
      user,
    ],
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
    mapRef.current?.flyTo([a.lat, a.lon], 14, { animate: false });
    const patch: Partial<RestStopForm> = {
      enabled: true,
      name: a.name,
      lat: a.lat,
      lon: a.lon,
      googlePlaceId: a.placeId ?? undefined,
      ...(a.placeId
        ? {
            alt: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a.name)}&query_place_id=${a.placeId}`,
          }
        : {}),
    };
    if (a.hours) {
      patch.sameHoursEveryDay = false;
      patch.perDay = a.hours;
    } else {
      patch.sameHoursEveryDay = true;
      patch.allDays = { mode: "closed", opens: "06:00", closes: "22:00" };
    }
    if (a.streetLine && (a.hasLocality || a.placeId)) {
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
      address: a.address || `${a.lat.toFixed(6)}, ${a.lon.toFixed(6)}`,
    });
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (!startPoint || !endPoint || !bounds) {
    return <div className="map-loading">Transit map unavailable</div>;
  }

  const interactive = !!onSelectStop;

  const activeTileUrl = GOOGLE_TILE_LAYER_KEYS.has(mapStyle)
    ? resolvedGoogleUrl
    : MAP_TILE_LAYERS[mapStyle].url;

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
          {activeTileUrl != null && (
            <TileLayer
              key={mapStyle}
              url={activeTileUrl}
              attribution={MAP_TILE_LAYERS[mapStyle].attribution}
              maxZoom={MAP_TILE_LAYERS[mapStyle].maxZoom}
            />
          )}

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
              <br />
              <div className="split-map-popup-links">
                <a
                  href={`https://www.google.com/maps?q=${startPoint.lat},${startPoint.lon}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Google Maps ↗
                </a>
                {" · "}
                <a
                  href={`https://www.openstreetmap.org/?mlat=${startPoint.lat}&mlon=${startPoint.lon}#map=15/${startPoint.lat}/${startPoint.lon}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  OSM ↗
                </a>
              </div>
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
              <br />
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
                <br />
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
              </Popup>
            </Marker>
          )}

          {/* Nearby amenity pins */}
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
                      <AmenityFaIcon
                        amenity={a.amenity}
                        className="split-map-popup-type-icon"
                      />
                      {a.placeId ? (
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a.name)}&query_place_id=${a.placeId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="split-map-popup-name-link"
                        >
                          <strong>{a.name}</strong>
                        </a>
                      ) : (
                        <strong>{a.name}</strong>
                      )}
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
                        <span
                          className="split-map-popup-addr"
                          title={a.address}
                        >
                          {" "}
                          · {a.address}
                        </span>
                      )}
                    </div>
                    <div className="split-map-popup-hours">
                      {a.hours ? (
                        <PopupHoursGrid hours={a.hours} />
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
                    {interactive && (
                      <button
                        type="button"
                        className="split-map-popup-btn"
                        onClick={() => handleSelect(a)}
                      >
                        <i
                          className="fa-solid fa-bookmark"
                          aria-hidden="true"
                        />{" "}
                        Use as rest stop
                      </button>
                    )}
                  </div>
                </Popup>
              </Marker>
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
          {/* List toggle — shown only once results are loaded */}
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
              {searchLoading ? (
                <>
                  <i
                    className="fa-solid fa-circle-notch fa-spin"
                    aria-hidden="true"
                  />{" "}
                  Searching…
                </>
              ) : amenities !== null && !showNearby ? (
                <>
                  <i className="fa-solid fa-eye" aria-hidden="true" /> Show
                  Stops
                </>
              ) : showNearby ? (
                <>
                  <i className="fa-solid fa-eye-slash" aria-hidden="true" />{" "}
                  Hide Results
                </>
              ) : (
                <>
                  <i
                    className="fa-solid fa-magnifying-glass"
                    aria-hidden="true"
                  />{" "}
                  Nearby Stops
                </>
              )}
            </button>
          )}
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
      {showNearby && amenities !== null && showList && (
        <div className="split-map-amenity-list">
          <div className="split-map-amenity-header">
            <span className="split-map-amenity-count">
              {amenities.length} stop{amenities.length !== 1 ? "s" : ""} found
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
                  <AmenityFaIcon amenity={a.amenity} />
                </span>
                <div className="split-map-amenity-info">
                  {a.placeId ? (
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a.name)}&query_place_id=${a.placeId}`}
                      className="split-map-amenity-name"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {a.name}
                    </a>
                  ) : (
                    <span className="split-map-amenity-name">{a.name}</span>
                  )}
                  <span className="split-map-amenity-meta">
                    {AMENITY_LABELS[a.amenity] ?? a.amenity} ·{" "}
                    {fmtDist(a.distanceM, unitSystem)}
                  </span>
                  {a.hours ? (
                    <span
                      className="split-map-amenity-hours"
                      title={a.rawHours ?? undefined}
                    >
                      {formatHoursCompact(a.hours)}
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
          onSave={(r, types, tq) => {
            if (tq.trim() && paidApisEnabled && enableGooglePlaces) {
              searchAbortRef.current?.abort();
              const ctrl = new AbortController();
              searchAbortRef.current = ctrl;
              setSearchLoading(true);
              setSearchError(null);
              searchPlacesText(tq.trim(), endLat, endLon, r, ctrl.signal)
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
                  setShowList(true);
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
