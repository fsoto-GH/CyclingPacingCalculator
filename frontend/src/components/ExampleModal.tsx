import { useEffect, useRef } from "react";
import type { CourseForm as CourseFormState } from "../types";

export interface ExampleEntry {
  name: string;
  description: string;
  form: CourseFormState;
}

interface ExampleModalProps {
  open: boolean;
  onClose: () => void;
  examples: ExampleEntry[];
  onSelect: (form: CourseFormState) => void;
}

export default function ExampleModal({
  open,
  onClose,
  examples,
  onSelect,
}: ExampleModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  function handleSelect(form: CourseFormState) {
    onSelect(form);
    onClose();
  }

  return (
    <dialog ref={dialogRef} className="legend-modal" onClose={onClose}>
      <div className="legend-header">
        <h2>Load an Example</h2>
        <button className="legend-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="legend-body">
        <div className="example-list">
          {examples.map((ex, i) => (
            <div key={i} className="example-card">
              <div className="example-card-info">
                <strong>{ex.name}</strong>
                <p>{ex.description}</p>
              </div>
              <button
                type="button"
                className="ghost-btn"
                onClick={() => handleSelect(ex.form)}
              >
                Load
              </button>
            </div>
          ))}
        </div>
      </div>
    </dialog>
  );
}
