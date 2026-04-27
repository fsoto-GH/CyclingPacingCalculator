from dataclasses import dataclass


@dataclass
class SubSplitMode:
    def sub_splits(self, distance: float, moving_speed: float | None = None, pace: float | None = None) -> list[float]:
        raise NotImplementedError('sub_splits method must be implemented by subclasses')


@dataclass
class EvenSubSplitMode(SubSplitMode):
    sub_split_count: int

    def sub_splits(self, distance, moving_speed=None, pace=None) -> list[float]:
        return [distance / self.sub_split_count for _ in range(self.sub_split_count)]


@dataclass
class FixedDistanceSubSplitMode(SubSplitMode):
    sub_split_distance: float
    last_sub_split_threshold: float | None = None

    def sub_splits(self, distance, moving_speed=None, pace=None) -> list[float]:
        full_sub_split_count = int(distance // self.sub_split_distance)
        if full_sub_split_count == 0:
            return [distance]

        splits = [self.sub_split_distance for _ in range(full_sub_split_count)]

        residual_distance = distance % self.sub_split_distance
        # residual distance is within threshold, add it to last split
        if self.last_sub_split_threshold is not None and 0 < residual_distance < self.last_sub_split_threshold:
            splits[-1] = self.sub_split_distance + residual_distance
        elif 0 < residual_distance:
            splits.append(residual_distance)

        return splits


@dataclass
class CustomSubSplitMode(SubSplitMode):
    """
    A SubSplitMode that allows for custom-defined sub-split distances.
    NOTE: The sum of sub_split_distances should equal to or greater than the total distance of the split.
    If that is not the case, the remaining distance will be treated as a final sub-split.
    If the sum exceeds the total distance, the extra distances will yield invalid calculations.
    """
    sub_split_distances: list[float]

    def sub_splits(self, distance, moving_speed=None, pace=None) -> list[float]:
        return self.sub_split_distances


@dataclass
class HourSubSplitMode(SubSplitMode):
    """
    A SubSplitMode where each sub-split represents one elapsed hour (moving + down time).
    The distance per sub-split equals the pace (distance/elapsed-hour), which accounts
    for down time within the split. Falls back to moving_speed when pace is not provided.
    The final sub-split covers whatever distance remains.
    """

    def sub_splits(self, distance, moving_speed=None, pace=None) -> list[float]:
        if moving_speed is None or moving_speed <= 0:
            return [distance]

        # Use pace (dist/elapsed-hour) so boundaries fall on wall-clock hour marks.
        dist_per_hour = pace or moving_speed
        full_count = int(distance // dist_per_hour)

        if full_count == 0:
            return [distance]

        splits = [dist_per_hour for _ in range(full_count)]
        residual = distance - (full_count * dist_per_hour)
        if residual > 1e-9:
            splits.append(residual)

        return splits
