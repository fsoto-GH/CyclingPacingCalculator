import { useState, useCallback, useRef, useEffect } from "react";
import type { RestStopForm, UnitSystem } from "../types";
import { queryNearbyAmenities } from "../calculator/overpass";
import type { NearbyAmenity } from "../calculator/overpass";

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

function fmtDist(m: number, unitSystem: UnitSystem): string {
  if (unitSystem === "imperial") {
    const mi = m / 1609.34;
    return mi < 0.1 ? `${Math.round(m * 3.28084)} ft` : `${mi.toFixed(2)} mi`;
  }
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`;
}

interface NearbyStopsPanelProps {
  lat: number;
  lon: number;
  unitSystem: UnitSystem;
  onClose: () => void;
  /** Called when user selects a store to fill the rest stop */
  onSelect: (patch: Partial<RestStopForm>) => void;
}

export default function NearbyStopsPanel({
  lat,
  lon,
  unitSystem,
  onClose,
  onSelect,
}: NearbyStopsPanelProps) {
  const [results, setResults] = useState<NearbyAmenity[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const handleSearch = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setLoading(true);
    setError(null);
    setResults(null);

    try {
      const amenities = await queryNearbyAmenities(lat, lon, 1000, ctrl.signal);
      // Sort: distance ascending, then those with hours before those without
      amenities.sort((a, b) => {
        if (a.distanceM !== b.distanceM) return a.distanceM - b.distanceM;
        return (b.hours ? 1 : 0) - (a.hours ? 1 : 0);
      });
      setResults(amenities);
    } catch (e: unknown) {
      if ((e as { name?: string }).name === "AbortError") return;
      setError("Could not reach Overpass API. Check your connection.");
    } finally {
      setLoading(false);
    }
  }, [lat, lon]);

  // Auto-search on mount
  useEffect(() => {
    handleSearch();
    return () => {
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelect = useCallback(
    (a: NearbyAmenity) => {
      const patch: Partial<RestStopForm> = {
        enabled: true,
        name: a.name,
        address: a.address,
      };
      if (a.hours) {
        patch.sameHoursEveryDay = false;
        patch.perDay = a.hours;
      }
      onSelect(patch);
    },
    [onSelect],
  );

  return (
    <div className="nearby-stops-panel">
      <div className="nearby-panel-header">
        <span className="nearby-panel-title">
          {loading ? "Searching…" : "Nearby Stops"}
        </span>
        <div className="nearby-panel-actions">
          {!loading && (
            <button
              type="button"
              className="nearby-refresh-btn"
              onClick={handleSearch}
              title="Search again"
            >
              ↺
            </button>
          )}
          <button
            type="button"
            className="nearby-close-btn"
            onClick={onClose}
            title="Hide nearby stops"
          >
            ✕
          </button>
        </div>
      </div>

      {error && <p className="nearby-error">{error}</p>}

      {results !== null && results.length === 0 && (
        <p className="nearby-empty">
          No stores found within {fmtDist(1000, unitSystem)}.
        </p>
      )}

      {loading && <p className="nearby-loading-msg">Querying OpenStreetMap…</p>}

      {results && results.length > 0 && (
        <ul className="nearby-list">
          {results.map((a) => (
            <li key={a.id} className="nearby-item">
              <button
                type="button"
                className="nearby-item-btn"
                onClick={() => handleSelect(a)}
              >
                <div className="nearby-item-top">
                  <span className="nearby-icon">
                    {AMENITY_ICONS[a.amenity] ?? "📍"}
                  </span>
                  <span className="nearby-name">{a.name}</span>
                  <span className="nearby-dist">
                    {fmtDist(a.distanceM, unitSystem)}
                  </span>
                </div>
                <div className="nearby-item-bottom">
                  <span className="nearby-type">
                    {AMENITY_LABELS[a.amenity] ?? a.amenity}
                  </span>
                  {a.address && (
                    <span className="nearby-address">{a.address}</span>
                  )}
                  {a.rawHours ? (
                    <span className="nearby-hours" title={a.rawHours}>
                      🕐 {a.rawHours}
                    </span>
                  ) : (
                    <span className="nearby-hours nearby-hours-unknown">
                      Hours unknown
                    </span>
                  )}
                  <span className="nearby-coords">
                    {a.lat.toFixed(5)}, {a.lon.toFixed(5)}
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
