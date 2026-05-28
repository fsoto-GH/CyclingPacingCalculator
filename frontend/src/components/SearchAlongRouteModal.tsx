import { useEffect, useRef, useState } from "react";

interface SearchAlongRouteModalProps {
  open: boolean;
  onClose: () => void;
  /** query: search term; originPct: 0 = no origin bias, 1–100 = % along split */
  onSearch: (query: string, originPct: number) => void;
}

export default function SearchAlongRouteModal({
  open,
  onClose,
  onSearch,
}: SearchAlongRouteModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const [originPct, setOriginPct] = useState(0);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) {
      setQuery("");
      setOriginPct(0);
      setValidationError(null);
      el.showModal();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  function handleSearch() {
    if (!query.trim()) {
      setValidationError("Enter something to search for.");
      return;
    }
    setValidationError(null);
    onSearch(query.trim(), originPct);
    onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      className="legend-modal search-along-route-modal"
      onClose={onClose}
    >
      <div className="legend-header">
        <h2>Search Along Route</h2>
        <button className="legend-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="legend-body">
        <label className="fnm-custom-label" htmlFor="sar-query-input">
          What to search for?
        </label>
        <input
          id="sar-query-input"
          type="text"
          className="fnm-custom-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSearch();
          }}
          placeholder="e.g. Walmart, Starbucks, bike shop"
          autoFocus
        />

        <div style={{ marginTop: "1.5rem" }}>
          <label className="fnm-custom-label" htmlFor="sar-origin-input">
            Search from (% along split)
          </label>
          <input
            id="sar-origin-input"
            type="number"
            className="fnm-custom-input"
            min={0}
            max={100}
            step={5}
            value={originPct}
            onChange={(e) => {
              const v = Math.max(
                0,
                Math.min(100, Math.round(Number(e.target.value))),
              );
              setOriginPct(isNaN(v) ? 0 : v);
            }}
          />
          <p
            style={{
              margin: "0.35rem 0 0",
              fontSize: "0.75rem",
              color: "var(--text-muted, #94a3b8)",
            }}
          >
            Favors results that are easiest to reach from that point on the
            route. <strong>0% disables the origin bias.</strong>
          </p>
        </div>

        <p
          style={{
            margin: "0.75rem 0 0",
            fontSize: "0.75rem",
            color: "var(--text-muted, #94a3b8)",
            display: "flex",
            gap: "0.4rem",
            alignItems: "flex-start",
          }}
        >
          <i
            className="fa-solid fa-circle-info"
            style={{ marginTop: "0.1rem", flexShrink: 0 }}
          />
          <span>
            Up to <strong>20 results</strong> are returned along the route. For
            a more thorough search, place an intermediate stop and use{" "}
            <em>Nearby Stops</em> instead.
          </span>
        </p>
      </div>
      <div className="legend-footer">
        {validationError && (
          <p className="fnm-validation-error">{validationError}</p>
        )}
        <button
          type="button"
          className="action-btn action-btn-export"
          onClick={handleSearch}
        >
          Search
        </button>
      </div>
    </dialog>
  );
}
