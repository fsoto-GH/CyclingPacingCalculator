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

  if (!value.enabled) {
    return (
      <div className="field">
        <label>
          <input
            id={`${prefix}-enabled`}
            type="checkbox"
            checked={false}
            onChange={() => update({ enabled: true })}
          />{" "}
          Add Rest Stop
        </label>
      </div>
    );
  }

  const updatePerDay = (i: number, entry: DayHoursEntry) => {
    const next = [...value.perDay] as RestStopForm["perDay"];
    next[i] = entry;
    update({ perDay: next });
  };

  return (
    <div className="rest-stop-section">
      <label>
        <input
          id={`${prefix}-enabled`}
          type="checkbox"
          checked={true}
          onChange={() => update({ enabled: false })}
        />{" "}
        Rest Stop
      </label>

      <div className="fields-grid">
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

      <div className="field">
        <label>
          <input
            id={`${prefix}-same-hours`}
            type="checkbox"
            checked={value.sameHoursEveryDay}
            onChange={(e) => update({ sameHoursEveryDay: e.target.checked })}
          />{" "}
          Same hours every day
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
  );
}
