from dataclasses import dataclass
from datetime import timedelta, datetime

from Cycling.pace_calculator.SegmentDetail import SegmentDetail
from Cycling.pace_calculator.Split import Split
from Cycling.pace_calculator.SplitDetail import SplitDetail


@dataclass
class Segment:
    splits: list[Split]
    down_time_ratio: float | None = None
    split_decay: float | None = None
    moving_speed: float | None = None
    min_moving_speed: float | None = None
    sleep_time: timedelta = timedelta(hours=0)
    no_end_down_time: bool = True  # if True, no down_time is added after the last split of the segment

    def compute_segment_detail(self,
                               start_time: datetime,
                               moving_speed: float,
                               min_moving_speed: float,
                               down_time_ratio: float,
                               split_decay: float,
                               distance: float,
                               ) -> SegmentDetail:
        split_details: list[SplitDetail] = []
        segment_start: datetime = start_time
        curr_start_time: datetime = start_time
        curr_moving_speed: float = moving_speed
        curr_distance: float = distance

        # at the start of a new segment the following are applied by the course-level settings:
        #   - min_moving_speed
        #   - moving speed,
        #   - split_decay
        #   - down_time_ratio
        # however, the segment's defined values override them, so here we apply them if defined,
        if self.min_moving_speed is not None:
            min_moving_speed = self.min_moving_speed

        if self.moving_speed is not None:
            curr_moving_speed = self.moving_speed

        if self.split_decay is not None:
            split_decay = self.split_decay

        if self.down_time_ratio is not None:
            down_time_ratio = self.down_time_ratio

        if curr_moving_speed < min_moving_speed:
            raise ValueError('Split moving speed cannot be lower than the minimum moving speed')

        for i, split in enumerate(self.splits):
            # at this point, the following respect the course/segment-level settings:
            #   - moving_speed
            #   - down_time
            # below we override moving_speed if the split has it defined
            if split.moving_speed is not None:
                curr_moving_speed = split.moving_speed

            moving_time: timedelta = timedelta(hours=split.distance / curr_moving_speed)
            down_time: timedelta = moving_time * down_time_ratio

            # here we override down_time if the split has it defined
            if split.down_time is not None:
                down_time = split.down_time

            # check if this is the last split of the segment and no_end_downtime is set
            if i == len(self.splits) - 1 and self.no_end_down_time:
                down_time = timedelta(hours=0)

            split_time = moving_time + down_time
            total_time = split_time + split.adjusted_time

            split_detail = SplitDetail(
                distance=split.distance,
                start_time=curr_start_time,
                end_time=curr_start_time + total_time,
                adjustment_start=curr_start_time + split_time,
                moving_speed=curr_moving_speed,
                moving_time=moving_time,
                down_time=down_time,
                adjustment_time=split.adjusted_time,
                split_time=split_time,
                total_time=total_time,
                pace=split.distance / (total_time.total_seconds() / 3600),
                start_distance=curr_distance,
                rest_stop=split.rest_stop,
                sub_splits=split.compute_sub_split_detail(
                    start_distance=curr_distance,
                    no_end_down_time=self.no_end_down_time,
                    start_time=curr_start_time,
                    down_time=down_time,
                    moving_speed=curr_moving_speed
                ),
            )

            # NOTE: The operations below are for post-split calculation updates.
            # Shifting start time, updating subsequent moving speed, etc.

            # decay split moving speed for next split, limit to min_moving_speed
            next_decayed_moving_speed = curr_moving_speed - split_decay

            curr_moving_speed = max(next_decayed_moving_speed, min_moving_speed)
            curr_distance += split.distance
            curr_start_time += total_time

            split_details.append(split_detail)

        total_segment_moving_time = sum((x.moving_time for x in split_details), timedelta(0))
        total_segment_down_time = sum((x.down_time for x in split_details), timedelta(0))
        total_adjustment_time = sum((x.adjustment_time for x in split_details), timedelta(0))

        return SegmentDetail(
            split_details=split_details,
            start_time=segment_start,
            end_time=curr_start_time,
            end_moving_speed=curr_moving_speed,
            distance=curr_distance - distance,
            moving_time=total_segment_moving_time,
            down_time=total_segment_down_time,
            adjustment_time=total_adjustment_time,
            sleep_time=self.sleep_time
        )
