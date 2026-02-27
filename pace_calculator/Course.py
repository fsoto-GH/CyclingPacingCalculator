from dataclasses import dataclass
from datetime import datetime, timedelta

from Cycling.pace_calculator.CourseDetail import CourseDetail
from Cycling.pace_calculator.RestStop import RestStop
from Cycling.pace_calculator.SegmentDetail import SegmentDetail
from Cycling.pace_calculator.DetailLines import KOMDetailLine, KOMOptionalDetailLine
from Cycling.pace_calculator.Segment import Segment

DISTANCE = 'distance'
TARGET_DISTANCE = 'target_distance'


@dataclass
class Course:
    segments: list[Segment]
    init_moving_speed: float
    min_moving_speed: float
    # TODO: Implement KOM, this might be a Printer object detail tbh
    KOMs: list[KOMDetailLine | KOMOptionalDetailLine]
    # TODO: Implement optional rest stops, this might be a Printer detail tbh
    optional_rest_stops: list[RestStop] | None = None
    down_time_ratio: float = 0
    split_decay: float = 0
    start_time: datetime = datetime.today()
    # you can set course mode to base calculations on DISTANCE purely or distance points by setting to TARGET_DISTANCE
    mode: str = DISTANCE

    def __post_init__(self):
        if self.mode == DISTANCE:
            return

        lass_distance_marker: float = 0
        for segment in self.segments:
            for split in segment.splits:
                if split.distance <= lass_distance_marker:
                    raise ValueError("In DISTANCE mode, split distances must be strictly increasing.")
                lass_distance_marker = split.distance

        # offset helps compute distance across segments
        offset: float = 0
        for segment in self.segments:
            # we are in TARGET_DISTANCE mode
            split_distances: list[float] = [offset] + [split.distance for split in segment.splits]
            new_offset = segment.splits[-1].distance
            new_distances: list[float] = []
            for i in range(1, len(split_distances)):
                new_distance = split_distances[i] - split_distances[i - 1]
                new_distances.append(new_distance)

            for new_distance, split in zip(new_distances, segment.splits):
                split.distance = new_distance

            offset = new_offset

    def compute_course_detail(self, curr_distance: float = 0) -> CourseDetail:
        """
        Computes the detailed breakdown of the course based on its segments and splits using the latest stable
        algorithm.

        :return: CourseDetail object containing the computed details of the course.
        """
        return self.compute_course_detail_v1(curr_distance=curr_distance)

    def compute_course_detail_v1(self, curr_distance: float = 0) -> CourseDetail:
        curr_start_time: datetime = self.start_time
        curr_moving_speed: float = self.init_moving_speed
        curr_distance: float = curr_distance
        segment_details: list[SegmentDetail] = []

        # totals
        total_moving_time: timedelta = timedelta(hours=0)
        total_down_time: timedelta = timedelta(hours=0)
        total_adjustment_time: timedelta = timedelta(hours=0)
        total_sleep_time: timedelta = timedelta(hours=0)

        # rolling times
        rolling_adjustment_time: timedelta = timedelta(hours=0)
        rolling_down_time: timedelta = timedelta(hours=0)
        rolling_moving_time: timedelta = timedelta(hours=0)
        rolling_elapsed_time: timedelta = timedelta(hours=0)
        rolling_sleep_time: timedelta = timedelta(hours=0)

        for segment in self.segments:
            segment_detail = segment.compute_segment_detail(
                down_time_ratio=self.down_time_ratio,
                split_decay=self.split_decay,
                start_time=curr_start_time,
                moving_speed=curr_moving_speed,
                distance=curr_distance,
                min_moving_speed=self.min_moving_speed,
            )

            rolling_adjustment_time += segment_detail.adjustment_time
            rolling_down_time += segment_detail.down_time
            rolling_moving_time += segment_detail.moving_time
            rolling_elapsed_time += segment_detail.elapsed_time
            rolling_sleep_time += segment_detail.sleep_time

            curr_start_time = segment_detail.end_time
            curr_moving_speed = segment_detail.end_moving_speed
            curr_distance += segment_detail.distance

            segment_detail.rolling_adjustment_time = rolling_adjustment_time
            segment_detail.rolling_down_time = rolling_down_time
            segment_detail.rolling_moving_time = rolling_moving_time
            segment_detail.rolling_elapsed_time = rolling_elapsed_time
            segment_detail.rolling_sleep_time = rolling_sleep_time

            segment_details.append(segment_detail)

            # account for sleep time between segments
            total_moving_time += segment_detail.moving_time
            total_down_time += segment_detail.down_time
            total_adjustment_time += segment_detail.adjustment_time
            total_sleep_time += segment.sleep_time

            curr_start_time += segment.sleep_time

        return CourseDetail(
            segment_details=segment_details,
            start_time=self.start_time,
            end_time=curr_start_time,
            elapsed_time=curr_start_time - self.start_time,
            moving_time=total_moving_time,
            down_time=total_down_time,
            sleep_time=total_sleep_time,
            adjustment_time=total_adjustment_time,
        )
