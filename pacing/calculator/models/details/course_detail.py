from dataclasses import dataclass
from datetime import datetime

from pydantic import computed_field

from calculator.models.details.segment_detail import SegmentDetail
from shared.serialized_timedelta import serialized_timedelta


@dataclass
class CourseDetail:
    """
    Represents a calculated course. That means that it yields estimated times for each segment and split, as well as
    totals for the entire course.
    """
    segment_details: list[SegmentDetail]
    start_time: datetime
    end_time: datetime
    elapsed_time: serialized_timedelta
    moving_time: serialized_timedelta
    down_time: serialized_timedelta
    sleep_time: serialized_timedelta
    adjustment_time: serialized_timedelta
    start_distance: float = 0

    @computed_field
    @property
    def distance(self) -> float:
        return sum(segment_detail.distance for segment_detail in self.segment_details)

    @computed_field
    @property
    def adjustment_time_hours(self) -> float:
        return self.adjustment_time.total_seconds() / 3600

    @computed_field
    @property
    def elapsed_time_hours(self) -> float:
        return self.elapsed_time.total_seconds() / 3600

    @computed_field
    @property
    def down_time_hours(self) -> float:
        return self.down_time.total_seconds() / 3600

    @computed_field
    @property
    def moving_time_hours(self) -> float:
        return self.moving_time.total_seconds() / 3600

    @computed_field
    @property
    def sleep_time_hours(self) -> float:
        return self.sleep_time.total_seconds() / 3600


