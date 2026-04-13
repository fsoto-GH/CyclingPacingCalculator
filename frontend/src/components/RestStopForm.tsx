import type { RestStopForm, DayHoursEntry } from "../types";
import { FieldError } from "./FieldError";
import DayHoursInput from "./DayHoursInput";

interface RestStopFormProps {
  prefix: string;
  value: RestStopForm;
  onChange: (val: RestStopForm) => void;
  addressLoading?: boolean;
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function RestStopFormComponent({
  prefix,
  value,
  onChange,
  addressLoading,
}: RestStopFormProps) {
  const update = (patch: Partial<RestStopForm>) =>
    onChange({ ...value, ...patch });

  const updatePerDay = (i: number, entry: DayHoursEntry) => {
    const next = [...value.perDay] as RestStopForm["perDay"];
    next[i] = entry;
    update({ perDay: next });
  };

  return (
    <div className="rs-section">
      {/* Header row with toggle */}
      <div className={`rs-toggle-row${value.enabled ? " open" : ""}`}>
        <span className="rs-toggle-label">Rest Stop</span>
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

      {value.enabled && (
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
            </div>
          </div>

          {/* Address full width */}
          <div className="field">
            <label htmlFor={`${prefix}-address`}>Address *</label>
            <input
              id={`${prefix}-address`}
              type="text"
              value={value.address}
              onChange={(e) => update({ address: e.target.value })}
              placeholder={
                addressLoading ? "Looking up address\u2026" : undefined
              }
              className={addressLoading ? "input-address-loading" : undefined}
            />
            <FieldError fieldId={`${prefix}-address`} />
            {value.address.trim() && (
              <a
                className="rs-open-in-google"
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(value.address.trim())}`}
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

          {/* Hours section */}
          <div className="rs-hours-header">
            <span className="rs-hours-header-label">Hours</span>
            <span className="rs-hours-header-toggle-label">
              Same Daily Hours
            </span>
            <label className="toggle-switch">
              <input
                id={`${prefix}-same-hours`}
                type="checkbox"
                checked={value.sameHoursEveryDay}
                onChange={(e) =>
                  update({ sameHoursEveryDay: e.target.checked })
                }
              />
              <span className="toggle-track" />
              <span className="toggle-thumb" />
            </label>
          </div>

          {value.sameHoursEveryDay ? (
            <DayHoursInput
              id={`${prefix}-all`}
              value={value.allDays}
              onChange={(v) => update({ allDays: v })}
            />
          ) : (
            <div className="per-day-hours">
              {DAY_LABELS.map((day, i) => (
                <DayHoursInput
                  key={i}
                  id={`${prefix}-day-${i}`}
                  label={day}
                  value={value.perDay[i]}
                  onChange={(v) => updatePerDay(i, v)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
