import { useEffect, useRef } from "react";

interface LegendModalProps {
  open: boolean;
  onClose: () => void;
}

export default function LegendModal({ open, onClose }: LegendModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog ref={dialogRef} className="legend-modal" onClose={onClose}>
      <div className="legend-header">
        <h2>Legend</h2>
        <button className="legend-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="legend-body">
        <p className="legend-intro">
          <strong>Hierarchy:</strong> Course → Segment → Split → Sub-Split
        </p>

        <Section title="Speed">
          <p>
            The starting moving speed used for pacing predictions. Each split's
            speed begins here and decays per the <em>Split Decay</em> value.
          </p>
          <ul>
            <li>
              Can be <strong>overridden at the segment level</strong> to set a
              different starting speed for that segment.
            </li>
            <li>
              A segment-level override may be lower than the course-level Min
              Speed only if a lower Min Speed is also set on that segment.
            </li>
          </ul>
        </Section>

        <Section title="Min Speed">
          <p>
            The floor for moving speed at any point in the course. Split Decay
            will never reduce speed below this value.
          </p>
          <ul>
            <li>
              Can be <strong>overridden at the segment level</strong> — useful
              for hilly or technical segments where a lower floor is realistic.
            </li>
          </ul>
        </Section>

        <Section title="Down Time Ratio">
          <p>
            Idle time expressed as a fraction of moving time (0–1). Accounts for
            traffic lights, crossings, brief stops, etc.
          </p>
          <ul>
            <li>Example: 1 h moving time × 0.1 DTR = 6 min of down time.</li>
            <li>
              Overridable at the <strong>segment level</strong>. At the{" "}
              <strong>split level</strong>, you can set a concrete number of
              minutes instead.
            </li>
          </ul>
        </Section>

        <Section title="Split Decay">
          <p>
            A flat amount subtracted from the rolling moving speed at each
            successive split.
          </p>
          <ul>
            <li>
              Example: Speed 16 with decay 0.1 → 16.0 → 15.9 → 15.8 → … down to
              Min Speed.
            </li>
          </ul>
        </Section>

        <Section title="Segment">
          <p>
            Think of a segment as <em>distance ridden before sleeping</em>. A
            segment contains one or more splits and has its own totals for
            moving, active, and elapsed time.
          </p>
        </Section>

        <Section title="Split">
          <p>
            Think of a split as <em>distance ridden before a rest stop</em> (or
            a logical waypoint). Each split can optionally define a rest stop,
            adjustment time, and speed or down-time overrides.
          </p>
        </Section>

        <Section title="Sub-Split">
          <p>
            A finer-grained view of pacing within a split. The only configurable
            aspect is the interval mode:
          </p>
          <ul>
            <li>
              <strong>Even</strong> — divide the split into <em>N</em> equal
              sub-splits.
            </li>
            <li>
              <strong>Fixed</strong> — generate sub-splits of a given distance;
              the last sub-split is merged if it would be shorter than the
              threshold.
            </li>
            <li>
              <strong>Custom</strong> — provide a comma-separated list of
              distances (no validation on totals, but it doesn't affect other
              calculations).
            </li>
          </ul>
        </Section>

        <Section title="Sleep Time">
          <p>
            A concrete duration of sleep appended after a segment. Offsets the
            overall course timeline.
          </p>
        </Section>

        <Section title="Adjustment Time">
          <p>
            A concrete number of minutes added to a split — e.g. a planned
            restaurant stop. <strong>Can be negative</strong> to represent time
            saved.
          </p>
        </Section>

        <Section title="Include Down Time on Last Split">
          <p>
            Whether the final split in a segment should include down time. Turn
            off if the last split ends at your destination or rest point where
            extra buffer isn't needed.
          </p>
        </Section>

        <h3 className="legend-subheading">Time Definitions</h3>

        <Section title="Segment Times">
          <ul>
            <li>
              <strong>Moving Time</strong> — total time spent in motion.
            </li>
            <li>
              <strong>Active Time</strong> — moving time + down time (start to
              finish, excluding sleep).
            </li>
            <li>
              <strong>Elapsed Time</strong> — active time + sleep time.
            </li>
          </ul>
        </Section>

        <Section title="Split Times">
          <ul>
            <li>
              <strong>Moving Time</strong> — time spent in motion.
            </li>
            <li>
              <strong>Split Time</strong> — moving time + down time.
            </li>
            <li>
              <strong>Active Time</strong> — split time + adjustment time.
            </li>
          </ul>
        </Section>

        <Section title="Sub-Split Times">
          <p>
            Same as split times. Note that <em>active time = split time</em>{" "}
            because adjustment time is not applied at the sub-split level.
          </p>
        </Section>
      </div>
    </dialog>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="legend-section">
      <h3>{title}</h3>
      {children}
    </div>
  );
}
