from dataclasses import dataclass
from datetime import datetime

from pydantic import computed_field

from pacing.shared.serialized_timedelta import serialized_timedelta
from pacing.shared.utils import to_hours


@dataclass
class SubSplitDetail:
    distance: float
    start_time: datetime
    end_time: datetime  # the ETA with all adjustments included
    moving_speed: float
    moving_time: serialized_timedelta
    down_time: serialized_timedelta
    split_time: serialized_timedelta  # moving_time + down_time
    active_time: serialized_timedelta  # moving + down_time + adjustment_time
    pace: float  # represents the elapsed distance travelled per hour
    start_distance: float  # represents the starting distance marker

    @computed_field
    @property
    def span(self) -> tuple[float, float]:
        return self.start_distance, self.start_distance + self.distance

    @computed_field
    @property
    def moving_time_hours(self) -> float:
        return to_hours(self.moving_time.total_seconds())

    @computed_field
    @property
    def down_time_hours(self) -> float:
        return to_hours(self.down_time.total_seconds())

    @computed_field
    @property
    def active_time_hours(self) -> float:
        return to_hours(self.active_time.total_seconds())
