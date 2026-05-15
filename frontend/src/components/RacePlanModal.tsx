import { useCallback, useEffect, useRef, useState } from "react";
import {
  listRacePlans,
  updateRacePlan,
  deleteRacePlan,
  getRacePlan,
} from "../api";
import type { RacePlanSummary } from "../api";
import type { CourseForm as CourseFormState } from "../types";

const PER_PAGE = 10;

interface RacePlanModalProps {
  open: boolean;
  onClose: () => void;
  /** Increment this to force a refresh (e.g. after saving a plan). */
  savedVersion: number;
  /** Called when user loads a saved plan; receives the form and the plan summary. */
  onLoad: (form: CourseFormState, plan: RacePlanSummary) => void;
}

export default function RacePlanModal({
  open,
  onClose,
  savedVersion,
  onLoad,
}: RacePlanModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [plans, setPlans] = useState<RacePlanSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [pendingSearch, setPendingSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  // Open/close the native dialog
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  // Re-fetch whenever fetchKey changes (open state, pagination, search, or external save)
  const fetchKey = `${open}|${refreshKey}|${savedVersion}|${page}|${search}`;
  const lastFetchKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open) return;
    if (lastFetchKeyRef.current === fetchKey) return;
    lastFetchKeyRef.current = fetchKey;
    loadPlans();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchKey]);

  const loadPlans = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listRacePlans({
        q: search || undefined,
        page,
        per_page: PER_PAGE,
      });
      setPlans(result.items);
      setTotal(result.total);
    } catch {
      setError("Could not load plans. Are you signed in?");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, page]);

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    setSearch(pendingSearch);
  }

  async function handleLoad(plan: RacePlanSummary) {
    try {
      const full = await getRacePlan(plan.id);
      onLoad(full.payload as CourseFormState, plan);
      onClose();
    } catch {
      setError(`Failed to load plan "${plan.name}".`);
    }
  }

  async function handleTogglePublic(plan: RacePlanSummary) {
    try {
      const updated = await updateRacePlan(plan.id, {
        is_public: !plan.is_public,
      });
      setPlans((prev) =>
        prev.map((p) =>
          p.id === plan.id ? { ...p, is_public: updated.is_public } : p,
        ),
      );
    } catch {
      setError("Update failed.");
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!window.confirm(`Delete "${name}"?`)) return;
    try {
      await deleteRacePlan(id);
      // Re-fetch current page (count may have changed)
      setRefreshKey((k) => k + 1);
    } catch {
      setError("Delete failed.");
    }
  }

  function formatUpdatedFull(isoString: string): string {
    return new Date(isoString).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }

  return (
    <dialog
      ref={dialogRef}
      className="legend-modal race-plan-modal"
      onClose={onClose}
    >
      <div className="legend-header">
        <h2>My Race Plans</h2>
        <div className="legend-header-actions">
          <form className="race-plan-search-form" onSubmit={handleSearchSubmit}>
            <input
              type="search"
              id="plan-search"
              className="race-plan-search-input"
              placeholder="Search plans…"
              value={pendingSearch}
              onChange={(e) => setPendingSearch(e.target.value)}
              onBlur={() => {
                if (pendingSearch !== search) {
                  setPage(1);
                  setSearch(pendingSearch);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter")
                  handleSearchSubmit(e as unknown as React.FormEvent);
                if (e.key === "Escape" && pendingSearch === "") {
                  setSearch("");
                  setPage(1);
                }
              }}
            />
            <button
              type="button"
              className="gpx-refresh-btn"
              onClick={() => {
                setPage(1);
                setRefreshKey((k) => k + 1);
              }}
              disabled={loading}
              title="Refresh plans"
              aria-label="Refresh plans"
            >
              <i className={`fas fa-rotate${loading ? " fa-spin" : ""}`} />
            </button>
            <button
              className="legend-close"
              onClick={onClose}
              aria-label="Close"
            >
              <i className="fas fa-times" />
            </button>
          </form>
        </div>
      </div>

      <div className="legend-body race-plan-modal-body">
        {error && <p className="field-error-msg">{error}</p>}

        {loading ? (
          <p className="gpx-search-empty">Loading…</p>
        ) : plans.length === 0 ? (
          <p className="gpx-search-empty">
            {search ? `No plans matching "${search}".` : "No saved plans yet."}
          </p>
        ) : (
          <div className="example-list">
            {plans.map((plan) => (
              <div key={plan.id} className="example-card">
                <div className="example-card-info">
                  <strong className="race-plan-title">{plan.name}</strong>
                  {plan.description && (
                    <p
                      className="race-plan-description"
                      title={plan.description}
                    >
                      {plan.description}
                    </p>
                  )}
                  <p className="gpx-search-meta">
                    <span
                      className="race-plan-updated"
                      title={formatUpdatedFull(plan.updated_at)}
                    >
                      Updated {new Date(plan.updated_at).toLocaleDateString()}
                    </span>
                    {" · "}
                    <button
                      type="button"
                      className="race-plan-inline-btn"
                      onClick={() => handleTogglePublic(plan)}
                    >
                      {plan.is_public ? (
                        <>
                          <i className="fas fa-lock-open" /> Public
                        </>
                      ) : (
                        <>
                          <i className="fas fa-lock" /> Private
                        </>
                      )}
                    </button>
                  </p>
                </div>
                <div className="race-plan-actions">
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => handleLoad(plan)}
                  >
                    Load
                  </button>
                  <button
                    type="button"
                    className="ghost-btn race-plan-delete-btn"
                    onClick={() => handleDelete(plan.id, plan.name)}
                    title="Delete plan"
                  >
                    <i className="fas fa-trash" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="race-plan-pagination">
          <button
            type="button"
            className="race-plan-page-btn"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => p - 1)}
            aria-label="Previous page"
          >
            <i className="fas fa-chevron-left" />
          </button>
          <span className="race-plan-page-info">
            {page} / {totalPages}
            <span className="race-plan-page-total"> ({total})</span>
          </span>
          <button
            type="button"
            className="race-plan-page-btn"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((p) => p + 1)}
            aria-label="Next page"
          >
            <i className="fas fa-chevron-right" />
          </button>
        </div>
      )}
    </dialog>
  );
}
