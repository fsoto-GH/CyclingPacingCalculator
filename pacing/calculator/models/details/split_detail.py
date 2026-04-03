from dataclasses import dataclass
from datetime import datetime

from calculator.dtos.rest_stop import RestStop
from calculator.models.details.sub_split_detail import SubSplitDetail
from shared.serialized_timedelta import serialized_timedelta


@dataclass
class SplitDetail(SubSplitDetail):
    sub_splits: list[SubSplitDetail]
    adjustment_start: datetime  # represents when adjustment time starts
    adjustment_time: serialized_timedelta
    rest_stop: RestStop | None = None

    def __post_init__(self):
        if self.rest_stop is not None and self.rest_stop.arrival_date is None:
            self.rest_stop.arrival_date = self.end_time