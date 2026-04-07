import { useState, useCallback, useRef } from "react";
import type { RestStopForm } from "../types";
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

function fmtDist(m: number): string {
  if (m < 1000) return `${m}m`;
  return `${(m / 1000).toFixed(1)}km`;
}

interface NearbyStopsPanelProps {
  lat: number;
  lon: number;
  /** Called when user selects a store to fill the rest stop */
  onSelect: (patch: Partial<RestStopForm>) => void;
}

export default function NearbyStopsPanel({
  lat,
  lon,
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
      const amenities = await queryNearbyAmenities(lat, lon, 2000, ctrl.signal);
      setResults(amenities);
    } catch (e: unknown) {
      if ((e as { name?: string }).name === "AbortError") return;
      setError("Could not reach Overpass API. Check your connection.");
    } finally {
      setLoading(false);
    }
  }, [lat, lon]);

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
      <button
        type="button"
        className="nearby-search-btn"
        onClick={handleSearch}
        disabled={loading}
      >
        {loading ? "Searching…" : "🔍 Find Nearby Stops"}
      </button>

      {error && <p className="nearby-error">{error}</p>}

      {results !== null && results.length === 0 && (
        <p className="nearby-empty">No stores found within 2 km.</p>
      )}

      {results && results.length > 0 && (
        <ul className="nearby-list">
          {results.map((a) => (
            <li key={a.id} className="nearby-item">
              <button
                type="button"
                className="nearby-item-btn"
                onClick={() => handleSelect(a)}
                title={a.rawHours ? `Hours: ${a.rawHours}` : "No hours in OSM"}
              >
                <span className="nearby-icon">
                  {AMENITY_ICONS[a.amenity] ?? "📍"}
                </span>
                <span className="nearby-name">{a.name}</span>
                <span className="nearby-dist">{fmtDist(a.distanceM)}</span>
                {a.hours ? (
                  <span className="nearby-hours-badge" title={a.rawHours ?? ""}>
                    🕐
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
