from dataclasses import dataclass
from datetime import datetime, timedelta

from Cycling.pace_calculator.SplitDetail import SubSplitDetail


@dataclass
class SubSplitCalculator:
    """
    Base class for SubSplitCalculator implementations.
    """

    @staticmethod
    def get_sub_split_details(sub_split_distances: list[float],
                              no_end_down_time: bool,
                              start_distance: float,
                              start_time: datetime,
                              down_time: timedelta,
                              moving_speed: float):
        pass


@dataclass
class SubSplitCalculatorV1(SubSplitCalculator):
    """
    This implementation evenly splits down_time across sub-splits.
    """
    @staticmethod
    def get_sub_split_details(sub_split_distances: list[float],
                              no_end_down_time: bool,
                              start_distance: float,
                              start_time: datetime,
                              down_time: timedelta,
                              moving_speed: float):
        res: list[SubSplitDetail] = []

        # avoid technical computations and evenly split down_time
        # could consider this being = moving_time * split.down_time_ratio or segment.down_time_ratio
        # however, we'd need to handle cases where down_time is explicitly defined for splits
        # down_time_count = len(sub_split_distances) - (1 if no_end_down_time else 0)
        #
        # # check if there is no_end_down_time and there is only one sub-split
        # # illogical to have down_time disabled in this case
        # if no_end_down_time and down_time_count == 0 and down_time.total_seconds() != 0:
        #     raise ValueError("A sub-split calculation with no_end_down_time requires 1) at least two sub-splits or "
        #                      "2) a down_time of zero.")

        sub_split_down_time = timedelta(hours=0)

        if down_time.total_seconds() != 0:
            sub_split_down_time = down_time / len(sub_split_distances)

        for i, sub_split_distance in enumerate(sub_split_distances):
            # if we have exceeded our down_time_count, set down_time to 0
            if i >= len(sub_split_distances):
                sub_split_down_time = timedelta(hours=0)

            sub_split_moving_time = timedelta(hours=sub_split_distance / moving_speed)
            sub_split_total_time = sub_split_moving_time + sub_split_down_time

            sub_split_detail = SubSplitDetail(
                distance=sub_split_distance,
                start_time=start_time,
                end_time=start_time + sub_split_total_time,
                moving_speed=moving_speed,
                moving_time=sub_split_moving_time,
                down_time=sub_split_down_time,
                split_time=sub_split_total_time,
                total_time=sub_split_total_time,  # equal to split time because sub-splits do not consider adjusted time
                pace=sub_split_distance / (sub_split_total_time.total_seconds() / 3600),
                start_distance=start_distance
            )

            start_time += sub_split_moving_time + sub_split_down_time
            start_distance += sub_split_distance

            res.append(sub_split_detail)
        return res
