import type { InputHTMLAttributes } from "react";

interface NumberInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "onChange"
> {
  value: string;
  onChange: (val: string) => void;
}

/**
 * A styled number input with +/− stepper buttons.
 * Wraps a standard <input type="number"> and adds explicit ▲/▼ buttons that
 * respect the input's `step`, `min`, and `max` attributes.
 */
export default function NumberInput({
  value,
  onChange,
  step,
  min,
  max,
  disabled,
  ...rest
}: NumberInputProps) {
  const numStep =
    step === "any" || step === undefined ? 1 : parseFloat(String(step));
  const numMin = min !== undefined ? parseFloat(String(min)) : -Infinity;
  const numMax = max !== undefined ? parseFloat(String(max)) : Infinity;

  function adjust(delta: number) {
    const current = parseFloat(value);
    const base = isNaN(current) ? 0 : current;
    const next = parseFloat((base + delta).toPrecision(12)); // avoid floating-point drift
    if (next < numMin || next > numMax) return;
    onChange(String(next));
  }

  return (
    <div className="number-input-wrapper">
      <input
        {...rest}
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="number-input-steppers" aria-hidden="true">
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          onClick={() => adjust(numStep)}
        >
          ▲
        </button>
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          onClick={() => adjust(-numStep)}
        >
          ▼
        </button>
      </div>
    </div>
  );
}
