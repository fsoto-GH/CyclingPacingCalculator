import { useEffect, useRef, useState } from "react";

interface SearchAlongRouteModalProps {
  open: boolean;
  onClose: () => void;
  onSearch: (query: string) => void;
}

export default function SearchAlongRouteModal({
  open,
  onClose,
  onSearch,
}: SearchAlongRouteModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) {
      setQuery("");
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
    onSearch(query.trim());
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
