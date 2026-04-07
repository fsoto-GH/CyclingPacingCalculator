import { minutesToHms } from "../utils";
import { FieldError } from "./FieldError";

interface TimeInputProps {
  id: string;
  label: string;
  value: string;
  onChange: (val: string) => void;
  optional?: boolean;
  allowNegative?: boolean;
}

export default function TimeInput({
  id,
  label,
  value,
  onChange,
  optional,
  allowNegative,
}: TimeInputProps) {
  const hms = minutesToHms(value);
  return (
    <div className="field">
      <label htmlFor={id}>
        {label} (min)
        {optional && <span className="optional"> — optional</span>}
        {hms && <span className="time-aside"> = {hms}</span>}
      </label>
      <input
        id={id}
        type="number"
        step="any"
        {...(allowNegative ? {} : { min: "0" })}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0"
      />
      <FieldError fieldId={id} />
    </div>
  );
}
