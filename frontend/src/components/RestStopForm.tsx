import { useEffect, useRef, useState } from "react";
import type { RestStopForm, DayHoursEntry } from "../types";
import { FieldError } from "./FieldError";
import DayHoursInput from "./DayHoursInput";
import { parseHighPrecisionCoordinateAddress } from "../calculator/geocode";

interface EtaInfo {
  status: "open" | "near-open" | "near-close" | "closed";
  statusWord: string;
  hoursLabel: string;
  nearDetail: string | null;
  arrivalTime: string;
  timezone?: string;
}

interface RestStopFormProps {
  prefix: string;
  value: RestStopForm;
  onChange: (val: RestStopForm) => void;
  addressLoading?: boolean;
  etaInfo?: EtaInfo | null;
  /** When true, hides the enable/disable toggle row (for embedded use). */
  hideToggle?: boolean;
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function fmtCompact(time: string): string {
  if (!time) return "";
  const [h, m] = time.split(":").map(Number);
  const ampm = h < 12 ? "a" : "p";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0
    ? `${h12}${ampm}`
    : `${h12}:${String(m).padStart(2, "0")}${ampm}`;
}

function entryCompactLabel(entry: DayHoursEntry): string {
  if (entry.mode === "24h") return "24h";
  if (entry.mode === "closed") return "Closed";
  return `${fmtCompact(entry.opens)}-${fmtCompact(entry.closes)}`;
}

function hoursDetailSummary(rs: RestStopForm): string {
  if (rs.sameHoursEveryDay) {
    return `Daily: ${entryCompactLabel(rs.allDays)}`;
  }
  const groups: { start: number; end: number; label: string }[] = [];
  rs.perDay.forEach((entry, i) => {
    const label = entryCompactLabel(entry);
    if (groups.length > 0 && groups[groups.length - 1].label === label) {
      groups[groups.length - 1].end = i;
    } else {
      groups.push({ start: i, end: i, label });
    }
  });
  return groups
    .map(({ start, end, label }) => {
      const dayStr =
        start === end
          ? DAY_LABELS[start]
          : `${DAY_LABELS[start]}-${DAY_LABELS[end]}`;
      return `${dayStr}: ${label}`;
    })
    .join(" · ");
}

export default function RestStopFormComponent({
  prefix,
  value,
  onChange,
  addressLoading,
  etaInfo,
  hideToggle = false,
}: RestStopFormProps) {
  const update = (patch: Partial<RestStopForm>) =>
    onChange({ ...value, ...patch });

  // Keep address typing local; commit to parent form on blur so
  // forward-geocode triggers only after the user leaves the field.
  const [addressDraft, setAddressDraft] = useState(value.address);
  useEffect(() => {
    setAddressDraft(value.address);
  }, [value.address]);

  // Hours modal state — draft is initialized from value when modal opens
  const [modalOpen, setModalOpen] = useState(false);
  const [draftSame, setDraftSame] = useState(value.sameHoursEveryDay);
  const [draftAllDays, setDraftAllDays] = useState<DayHoursEntry>(
    value.allDays,
  );
  const [draftPerDay, setDraftPerDay] = useState<RestStopForm["perDay"]>(
    value.perDay,
  );
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (modalOpen && !el.open) el.showModal();
    else if (!modalOpen && el.open) el.close();
  }, [modalOpen]);

  const openModal = () => {
    setDraftSame(value.sameHoursEveryDay);
    setDraftAllDays(value.allDays);
    setDraftPerDay(value.perDay);
    setModalOpen(true);
  };

  const cancelModal = () => setModalOpen(false);

  const commitModal = () => {
    update({
      sameHoursEveryDay: draftSame,
      allDays: draftAllDays,
      perDay: draftPerDay,
    });
    setModalOpen(false);
  };

  const updateDraftPerDay = (i: number, entry: DayHoursEntry) => {
    const next = [...draftPerDay] as RestStopForm["perDay"];
    next[i] = entry;
    setDraftPerDay(next);
  };

  return (
    <div className="rs-section">
      {/* Header row with toggle — omitted when embedded (hideToggle) */}
      {!hideToggle && (
        <div className={`rs-toggle-row${value.enabled ? " open" : ""}`}>
          <div className="rs-header-name">
            <span className="rs-toggle-label">Rest Stop</span>
          </div>

          <label className="toggle-switch">
            <input
              id={`${prefix}-enabled`}
              type="checkbox"
              checked={value.enabled}
              onChange={(e) => update({ enabled: e.target.checked })}
            />
            <span className="toggle-track" />
            <span className="toggle-thumb" />
          </label>
        </div>
      )}

      {(hideToggle || value.enabled) && (
        <div className="rs-section-body">
          {/* Name + Alt URL on same row */}
          <div className="fields-grid fields-grid--2col">
            <div className="field">
              <label htmlFor={`${prefix}-name`}>Name *</label>
              <input
                id={`${prefix}-name`}
                type="text"
                value={value.name}
                onChange={(e) => update({ name: e.target.value })}
              />
              <FieldError fieldId={`${prefix}-name`} />
            </div>
            <div className="field">
              <label htmlFor={`${prefix}-alt`}>Alt URL</label>
              <input
                id={`${prefix}-alt`}
                type="text"
                value={value.alt}
                onChange={(e) => update({ alt: e.target.value })}
                placeholder="https://..."
              />
              <FieldError fieldId={`${prefix}-alt`} />
            </div>
          </div>

          {/* Address full width */}
          <div className="field">
            <label htmlFor={`${prefix}-address`}>Address *</label>
            <input
              id={`${prefix}-address`}
              type="text"
              value={addressDraft}
              onChange={(e) => {
                const next = e.target.value;
                setAddressDraft(next);

                // For precise coordinate input, commit immediately so the map
                // marker appears without waiting for blur.
                const parsed = parseHighPrecisionCoordinateAddress(next);
                if (!parsed) return;
                if (
                  value.address === next &&
                  value.lat === parsed.lat &&
                  value.lon === parsed.lon
                ) {
                  return;
                }
                update({ address: next, lat: parsed.lat, lon: parsed.lon });
              }}
              onBlur={() => {
                if (parseHighPrecisionCoordinateAddress(addressDraft)) return;
                if (addressDraft !== value.address) {
                  // Clear coords so map geocoding can refresh from the new address.
                  update({
                    address: addressDraft,
                    lat: undefined,
                    lon: undefined,
                  });
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  (e.currentTarget as HTMLInputElement).blur();
                }
              }}
              placeholder={
                addressLoading ? "Looking up address\u2026" : undefined
              }
              className={addressLoading ? "input-address-loading" : undefined}
            />
            <FieldError fieldId={`${prefix}-address`} />
            {value.address.trim() && (
              <a
                className="rs-open-in-google"
                href={
                  value.googlePlaceId
                    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(value.name)}&query_place_id=${value.googlePlaceId}`
                    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(value.address.trim())}`
                }
                target="_blank"
                rel="noopener noreferrer"
              >
                <svg
                  viewBox="0 0 24 24"
                  width="12"
                  height="12"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z" />
                </svg>
                Open in Google Maps
              </a>
            )}
          </div>

          {/* Hours — summary + edit icon */}
          <div className="rs-hours-row">
            <span className="rs-hours-row-label">Hours</span>
            <span className="rs-hours-detail-summary">
              {hoursDetailSummary(value)}
            </span>
            <button
              type="button"
              className="rs-hours-edit-icon-btn"
              onClick={openModal}
              aria-label="Edit rest stop hours"
              title="Edit hours"
            >
              ✎
            </button>
          </div>
          <FieldError fieldId={`${prefix}-hours`} />

          {/* ETA status */}
          {etaInfo && (
            <div
              className={`rs-eta-row eta-${etaInfo.status}`}
              title={
                etaInfo.timezone
                  ? `Resolved timezone: ${etaInfo.timezone}`
                  : undefined
              }
            >
              ETA {etaInfo.arrivalTime} — <strong>{etaInfo.statusWord}</strong>
              {etaInfo.hoursLabel !== "24 hours" &&
                etaInfo.hoursLabel !== "Closed" && <> ({etaInfo.hoursLabel})</>}
              {etaInfo.nearDetail && (
                <span className="rs-eta-detail"> · {etaInfo.nearDetail}</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Hours modal */}
      <dialog ref={dialogRef} className="rs-hours-modal" onClose={cancelModal}>
        <div className="legend-header">
          <h2>Rest Stop Hours</h2>
          <button
            type="button"
            className="legend-close"
            onClick={cancelModal}
            aria-label="Close"
          >
            <i className="fas fa-times" />
          </button>
        </div>
        <div className="legend-body rs-hours-modal-body">
          <div className="rs-hours-header rs-hours-modal-same-row">
            <span className="rs-hours-header-label">Same hours every day</span>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={draftSame}
                onChange={(e) => setDraftSame(e.target.checked)}
              />
              <span className="toggle-track" />
              <span className="toggle-thumb" />
            </label>
          </div>

          {draftSame ? (
            <DayHoursInput
              id={`${prefix}-modal-all`}
              value={draftAllDays}
              onChange={setDraftAllDays}
            />
          ) : (
            <div className="per-day-hours">
              {DAY_LABELS.map((day, i) => (
                <DayHoursInput
                  key={i}
                  id={`${prefix}-modal-day-${i}`}
                  label={day}
                  value={draftPerDay[i]}
                  onChange={(v) => updateDraftPerDay(i, v)}
                />
              ))}
            </div>
          )}
        </div>
        <div className="legend-footer">
          <button
            type="button"
            className="action-btn action-btn-export"
            onClick={commitModal}
          >
            Set Hours
          </button>
        </div>
      </dialog>
    </div>
  );
}
