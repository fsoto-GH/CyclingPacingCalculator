from dataclasses import dataclass
from datetime import datetime, timedelta

from Cycling.pace_calculator.PrinterDetailLine import PrinterDetailLine
from Cycling.pace_calculator.SegmentDetail import SegmentDetail
from Cycling.pace_calculator.Utils import to_hours


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

    def get_rolling_segment_details(self, segment_index: int) -> PrinterDetailLine:
        """
        Computes the rolling totals up to the given segment index (inclusive).
        :param segment_index: the index of the segment for which to compute the rolling totals
        :return: a PrinterDetailLine containing the rolling totals up to the given segment index
        """
        if segment_index < 0 or segment_index >= len(self.segment_details):
            raise ValueError(f"Invalid segment index: {segment_index}")

        # base values, set to zero
        rolling_distance = 0
        rolling_adjustment_time = timedelta(hours=0)
        rolling_down_time = timedelta(hours=0)
        rolling_moving_time = timedelta(hours=0)
        rolling_elapsed_time = timedelta(hours=0)
        rolling_sleep_time = timedelta(hours=0)

        for segment in self.segment_details[:segment_index + 1]:
            # while adding the *.*_hours would be easier, we would lose precision by converting to
            # hours at the segment level
            rolling_distance += segment.distance
            rolling_adjustment_time += segment.adjustment_time
            rolling_down_time += segment.down_time
            rolling_moving_time += segment.moving_time
            rolling_elapsed_time += segment.elapsed_time
            rolling_sleep_time += segment.sleep_time

        return PrinterDetailLine(
            start_time=self.start_time,
            end_time=self.segment_details[segment_index].end_time,
            distance=rolling_distance,
            adjustment_time_hours=to_hours(rolling_adjustment_time.total_seconds()),
            down_time_hours=to_hours(rolling_down_time.total_seconds()),
            moving_time_hours=to_hours(rolling_moving_time.total_seconds()),
            elapsed_time_hours=to_hours(rolling_elapsed_time.total_seconds()),
            sleep_time_hours=to_hours(rolling_sleep_time.total_seconds()),
        )

    def to_printer_detail_line(self) -> PrinterDetailLine:
        return PrinterDetailLine(
            start_time=self.start_time,
            end_time=self.end_time,
            adjustment_time_hours=self.adjustment_time_hours,
            elapsed_time_hours=self.elapsed_time_hours,
            down_time_hours=self.down_time_hours,
            moving_time_hours=self.moving_time_hours,
            distance=self.distance,
            sleep_time_hours=self.sleep_time_hours
        )

