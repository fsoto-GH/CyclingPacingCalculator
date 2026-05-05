import { useEffect, useRef, useState } from "react";
import {
  listRacePlans,
  createRacePlan,
  updateRacePlan,
  deleteRacePlan,
  getRacePlan,
} from "../api";
import type { RacePlanSummary } from "../api";
import type { CourseForm as CourseFormState } from "../types";

interface RacePlanModalProps {
  open: boolean;
  onClose: () => void;
  /** The current form state to save. */
  currentForm: CourseFormState;
  /** Called when user loads a saved plan; receives the deserialized CourseForm. */
  onLoad: (form: CourseFormState) => void;
}

export default function RacePlanModal({
  open,
  onClose,
  currentForm,
  onLoad,
}: RacePlanModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [plans, setPlans] = useState<RacePlanSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveName, setSaveName] = useState("");
  const [savePublic, setSavePublic] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      loadPlans();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  async function loadPlans() {
    setLoading(true);
    setError(null);
    try {
      setPlans(await listRacePlans());
    } catch {
      setError("Could not load plans. Are you signed in?");
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!saveName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      // Payload stored as the raw form JSON — load restores it directly.
      const newPlan = await createRacePlan(
        saveName.trim(),
        savePublic,
        currentForm,
      );
      setPlans((prev) => [newPlan, ...prev]);
      setSaveName("");
      setSavePublic(false);
    } catch {
      setError("Failed to save plan.");
    } finally {
      setSaving(false);
    }
  }

  async function handleLoad(plan: RacePlanSummary) {
    try {
      const full = await getRacePlan(plan.id);
      onLoad(full.payload as CourseFormState);
      onClose();
    } catch {
      setError(`Failed to load plan "${plan.name}".`);
    }
  }

  async function handleRename(id: string, name: string) {
    try {
      const updated = await updateRacePlan(id, { name });
      setPlans((prev) =>
        prev.map((p) => (p.id === id ? { ...p, name: updated.name } : p)),
      );
    } catch {
      setError("Rename failed.");
    } finally {
      setRenamingId(null);
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
      setPlans((prev) => prev.filter((p) => p.id !== id));
    } catch {
      setError("Delete failed.");
    }
  }

  return (
    <dialog ref={dialogRef} className="legend-modal" onClose={onClose}>
      <div className="legend-header">
        <h2>My Race Plans</h2>
        <button className="legend-close" onClick={onClose} aria-label="Close">
          <i className="fas fa-times" />
        </button>
      </div>
      <div className="legend-body">
        {/* Save current form as a new plan */}
        <div className="race-plan-save-row">
          <input
            type="text"
            className="race-plan-name-input"
            placeholder="Plan name…"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
          />
          <label className="race-plan-public-label">
            <input
              type="checkbox"
              checked={savePublic}
              onChange={(e) => setSavePublic(e.target.checked)}
            />{" "}
            Public
          </label>
          <button
            type="button"
            className="ghost-btn"
            disabled={saving || !saveName.trim()}
            onClick={handleSave}
          >
            {saving ? (
              <span className="btn-spinner btn-spinner-sm" />
            ) : (
              "Save current plan"
            )}
          </button>
        </div>

        {error && <p className="field-error-msg">{error}</p>}

        {loading ? (
          <p className="gpx-search-empty">Loading…</p>
        ) : plans.length === 0 ? (
          <p className="gpx-search-empty">No saved plans yet.</p>
        ) : (
          <div className="example-list">
            {plans.map((plan) => (
              <div key={plan.id} className="example-card">
                <div className="example-card-info">
                  {renamingId === plan.id ? (
                    <input
                      className="race-plan-rename-input"
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => {
                        if (renameValue.trim() && renameValue !== plan.name)
                          handleRename(plan.id, renameValue.trim());
                        else setRenamingId(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          if (renameValue.trim() && renameValue !== plan.name)
                            handleRename(plan.id, renameValue.trim());
                          else setRenamingId(null);
                        }
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                    />
                  ) : (
                    <strong
                      className="race-plan-title"
                      onClick={() => {
                        setRenamingId(plan.id);
                        setRenameValue(plan.name);
                      }}
                      title="Click to rename"
                    >
                      {plan.name}
                    </strong>
                  )}
                  <p className="gpx-search-meta">
                    Updated {new Date(plan.updated_at).toLocaleDateString()}
                    {" · "}
                    <button
                      type="button"
                      className="race-plan-inline-btn"
                      onClick={() => handleTogglePublic(plan)}
                    >
                      {plan.is_public ? "🔓 Public" : "🔒 Private"}
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
    </dialog>
  );
}
