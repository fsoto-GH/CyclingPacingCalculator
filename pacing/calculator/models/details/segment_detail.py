from dataclasses import dataclass
from datetime import datetime

from pydantic import computed_field

from calculator.models.details.split_detail import SplitDetail
from shared.serialized_timedelta import serialized_timedelta
from shared.utils import to_hours


@dataclass
class SegmentDetail:
    split_details: list[SplitDetail]
    # start and end time only account for elapsed time between start and ending the bike ride,
    # so it does not include sleep time
    start_time: datetime
    end_time: datetime
    # represents the moving speed at the end of the segment
    end_moving_speed: float
    # computed totals
    distance: float
    start_distance: float

    moving_time: serialized_timedelta
    down_time: serialized_timedelta
    sleep_time: serialized_timedelta
    adjustment_time: serialized_timedelta | None

    # these fields cannot be summarized, so they are set to None
    moving_speed: None = None
    adjustment_start: None = None
    name: str | None = None

    @computed_field
    @property
    def elapsed_time(self) -> serialized_timedelta:
        """
        Total time is the sum of moving_time, down_time, and sleep_time.
        It also corresponds to the elapsed time between start and end time"""
        return self.end_time - self.start_time + self.sleep_time

    @computed_field
    @property
    def active_time(self) -> serialized_timedelta:
        """Active time is the elapsed time between start and end time, so it does not include sleep time"""
        return self.end_time - self.start_time

    @computed_field
    @property
    def span(self) -> tuple[float, float]:
        if len(self.split_details) == 1:
            # single split case
            start_distance, end_distance = self.split_details[-1].span
        else:
            start_distance = self.split_details[0].span[0]
            end_distance = self.split_details[-1].span[1]
        return start_distance, end_distance

    @computed_field
    @property
    def pace(self) -> float:
        return self.distance / self.active_time_hours

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
    def adjustment_time_hours(self) -> float | None:
        if self.adjustment_time is None:
            return 0
        return to_hours(self.adjustment_time.total_seconds())

    @computed_field
    @property
    def elapsed_time_hours(self) -> float:
        return to_hours(self.elapsed_time.total_seconds())

    @computed_field
    @property
    def active_time_hours(self) -> float:
        return to_hours(self.active_time.total_seconds())

    @computed_field
    @property
    def sleep_time_hours(self) -> float:
        return to_hours(self.sleep_time.total_seconds())