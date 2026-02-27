from dataclasses import dataclass
from datetime import timedelta, datetime

from Cycling.pace_calculator.RestStop import RestStop
from Cycling.pace_calculator.SplitDetail import SplitDetail, SubSplitDetail
from Cycling.pace_calculator.SubSplitCalculator import SubSplitCalculatorV1
from Cycling.pace_calculator.SubSplitMode import EvenSubSplitMode, FixedDistanceSubSplitMode, CustomSubSplitMode


@dataclass
class Split:
    distance: float
    sub_split_mode: EvenSubSplitMode | FixedDistanceSubSplitMode | CustomSubSplitMode = \
        FixedDistanceSubSplitMode(sub_split_distance=20)
    rest_stop: RestStop | None = None
    # this field overrides any down_time computed at segment level
    down_time: timedelta | None = None
    # this field overrides any moving speed set at parent levels (segment or course)
    moving_speed: float | None = None
    adjusted_time: timedelta = timedelta(hours=0)

    @property
    def sub_split_distances(self):
        return self.sub_split_mode.sub_splits(self.distance)

    def compute_sub_split_detail(self,
                                 start_distance: float,
                                 start_time: datetime,
                                 down_time: timedelta,
                                 moving_speed: float,
                                 no_end_down_time: bool) -> list[SubSplitDetail]:
        return SubSplitCalculatorV1.get_sub_split_details(
            sub_split_distances=self.sub_split_distances,
            no_end_down_time=no_end_down_time,
            start_distance=start_distance,
            start_time=start_time,
            down_time=down_time,
            moving_speed=moving_speed
        )
