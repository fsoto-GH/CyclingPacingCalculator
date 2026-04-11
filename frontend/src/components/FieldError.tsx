import { createContext, useContext } from "react";

export const FieldErrorContext = createContext<Record<string, string>>({});

/** All computed errors (independent of touch state) — used for red-glow indicators. */
export const AllErrorsContext = createContext<Record<string, string>>({});

export function FieldError({ fieldId }: { fieldId: string }) {
  const errors = useContext(FieldErrorContext);
  const msg = errors[fieldId];
  return msg ? <span className="field-error">{msg}</span> : null;
}
