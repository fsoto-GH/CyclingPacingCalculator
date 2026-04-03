from dataclasses import dataclass
from datetime import timedelta

from calculator.dtos.rest_stop import RestStop
from calculator.dtos.sub_split_mode import SubSplitMode


@dataclass
class Split:
    distance: float
    sub_split_mode: SubSplitMode
    rest_stop: RestStop | None = None
    # this field overrides any down_time computed at segment level
    down_time: timedelta | None = None
    # this field overrides any moving speed set at parent levels (segment or course)
    moving_speed: float | None = None
    adjustment_time: timedelta = timedelta(hours=0)
