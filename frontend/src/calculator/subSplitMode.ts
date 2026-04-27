import type { SplitPayload } from "../types";

/**
 * Given a split's sub-split configuration and its (per-split, normalized) distance,
 * returns an array of individual sub-split distances.
 *
 * @param pace - Effective distance per elapsed hour (moving + down time). Used by
 *   the "hour" mode to place sub-split boundaries every elapsed hour rather than
 *   every moving hour. When omitted, falls back to movingSpeed.
 */
export function computeSubSplitDistances(
  split: SplitPayload,
  movingSpeed?: number,
  pace?: number,
): number[] {
  const { distance } = split;

  switch (split.sub_split_mode) {
    case "even": {
      const count = split.sub_split_count ?? 1;
      return Array.from({ length: count }, () => distance / count);
    }

    case "fixed": {
      const fixedDist = split.sub_split_distance ?? distance;
      const threshold = split.last_sub_split_threshold ?? null;
      const fullCount = Math.floor(distance / fixedDist);

      if (fullCount === 0) return [distance];

      const splits = Array.from({ length: fullCount }, () => fixedDist);
      const residual = distance % fixedDist;

      if (threshold != null && residual > 0 && residual < threshold) {
        // Absorb small residual into the last full sub-split
        splits[splits.length - 1] = fixedDist + residual;
      } else if (residual > 0) {
        splits.push(residual);
      }

      return splits;
    }

    case "custom":
      return split.sub_split_distances ?? [distance];

    case "hour": {
      if (!movingSpeed || movingSpeed <= 0) return [distance];

      // Use pace (dist/elapsed-hour) so each sub-split boundary falls on a
      // wall-clock hour boundary, accounting for down time within the split.
      const distPerHour = pace ?? movingSpeed;
      const fullCount = Math.floor(distance / distPerHour);

      if (fullCount === 0) return [distance];

      const splits = Array.from({ length: fullCount }, () => distPerHour);
      const residual = distance - fullCount * distPerHour;
      if (residual > 1e-9) {
        splits.push(residual);
      }

      return splits;
    }
  }
}
