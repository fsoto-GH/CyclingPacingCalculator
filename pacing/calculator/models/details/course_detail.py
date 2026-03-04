from dataclasses import dataclass
from datetime import datetime, timedelta


from Cycling.pacing.calculator.models.details.segment_detail import SegmentDetail


@dataclass
class CourseDetail:
    """
    Represents a calculated course. That means that it yields estimated times for each segment and split, as well as
    totals for the entire course.
    """
    segment_details: list[SegmentDetail]
    start_time: datetime
    end_time: datetime
    elapsed_time: timedelta
    moving_time: timedelta
    down_time: timedelta
    sleep_time: timedelta
    adjustment_time: timedelta

    @property
    def distance(self):
        return sum(segment_detail.distance for segment_detail in self.segment_details)

    @property
    def adjustment_time_hours(self) -> float:
        return self.adjustment_time.total_seconds() / 3600

    @property
    def elapsed_time_hours(self) -> float:
        return self.elapsed_time.total_seconds() / 3600

    @property
    def down_time_hours(self) -> float:
        return self.down_time.total_seconds() / 3600

    @property
    def moving_time_hours(self) -> float:
        return self.moving_time.total_seconds() / 3600

    @property
    def sleep_time_hours(self) -> float:
        return self.sleep_time.total_seconds() / 3600


