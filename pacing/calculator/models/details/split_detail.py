from dataclasses import dataclass
from datetime import datetime

from pydantic import computed_field
from pacing.calculator.dtos.rest_stop import RestStop
from pacing.calculator.models.details.sub_split_detail import SubSplitDetail
from pacing.shared.serialized_timedelta import serialized_timedelta
from pacing.shared.utils import to_hours


@dataclass
class SplitDetail(SubSplitDetail):
    sub_splits: list[SubSplitDetail]
    adjustment_start: datetime  # represents when adjustment time starts
    adjustment_time: serialized_timedelta
    rest_stop: RestStop | None = None
    name: str | None = None

    @computed_field
    @property
    def adjustment_time_hours(self) -> float | None:
        if self.adjustment_time is None:
            return 0
        return to_hours(self.adjustment_time.total_seconds())

    @computed_field
    @property
    def active_time_hours(self) -> float:
        return to_hours(self.active_time.total_seconds())

    def __post_init__(self):
        if self.rest_stop is not None and self.rest_stop.arrival_date is None:
            self.rest_stop.arrival_date = self.end_time
