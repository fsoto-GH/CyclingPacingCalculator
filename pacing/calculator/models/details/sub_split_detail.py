from dataclasses import dataclass
from datetime import datetime, timedelta


@dataclass
class SubSplitDetail:
    distance: float
    start_time: datetime
    end_time: datetime  # the ETA with all adjustments included
    moving_speed: float
    moving_time: timedelta
    down_time: timedelta
    split_time: timedelta  # moving_time + down_time
    total_time: timedelta  # moving + down_time + adjustment_time
    pace: float  # represents the elapsed distance travelled per hour
    start_distance: float  # represents the starting distance marker

    @property
    def span(self) -> tuple[float, float]:
        return self.start_distance, self.start_distance + self.distance
