interface InsertZoneProps {
  onInsert: () => void;
  label?: string;
}

export default function InsertZone({
  onInsert,
  label = "Insert here",
}: InsertZoneProps) {
  return (
    <button
      type="button"
      className="insert-zone"
      onClick={onInsert}
      aria-label={label}
      title={label}
    >
      <span className="insert-zone-line" />
      <span className="insert-zone-btn">
        <i className="fas fa-plus" />
      </span>
      <span className="insert-zone-line" />
    </button>
  );
}
