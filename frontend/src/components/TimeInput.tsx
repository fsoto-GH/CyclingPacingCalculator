import { minutesToHms } from "../utils";
import { FieldError } from "./FieldError";

interface TimeInputProps {
  id: string;
  label: string;
  value: string;
  onChange: (val: string) => void;
  optional?: boolean;
  allowNegative?: boolean;
  disabled?: boolean;
  disabledTitle?: string;
}

export default function TimeInput({
  id,
  label,
  value,
  onChange,
  optional,
  allowNegative,
  disabled,
  disabledTitle,
}: TimeInputProps) {
  const hms = minutesToHms(value);
  return (
    <div className="field">
      <label htmlFor={id} title={disabled ? disabledTitle : undefined}>
        {label} (min)
        {optional && <span className="optional"> — optional</span>}
        {hms && !disabled && <span className="time-aside"> = {hms}</span>}
      </label>
      <input
        id={id}
        type="number"
        step="any"
        {...(allowNegative ? {} : { min: "0" })}
        value={disabled ? "" : value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={disabled ? "N/A" : "0"}
        disabled={disabled}
        title={disabled ? disabledTitle : undefined}
      />
      <FieldError fieldId={id} />
    </div>
  );
}
