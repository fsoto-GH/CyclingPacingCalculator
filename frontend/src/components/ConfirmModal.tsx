import { useEffect, useRef } from "react";

interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = "Continue",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="legend-modal confirm-modal"
      onClose={onCancel}
    >
      <div className="legend-header">
        <h2>{title}</h2>
        <button className="legend-close" onClick={onCancel} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="legend-body">
        <p className="confirm-modal__message">{message}</p>
        <div className="confirm-modal__actions">
          <button type="button" className="ghost-btn" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className="ghost-btn confirm-modal__confirm-btn"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
