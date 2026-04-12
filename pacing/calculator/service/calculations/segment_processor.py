from datetime import datetime, timedelta

from pacing.calculator.dtos.segment import Segment
from pacing.calculator.dtos.split import Split
from pacing.calculator.models.details.segment_detail import SegmentDetail
from pacing.calculator.models.details.split_detail import SplitDetail
from pacing.calculator.models.details.sub_split_detail import SubSplitDetail


def process_segment(segment: Segment,
                    moving_speed: float,
                    min_moving_speed: float,
                    start_time: datetime,
                    down_time_ratio: float,
                    split_delta: float,
                    distance: float,
                    ) -> SegmentDetail:
    is_valid = __validate_segment(segment, moving_speed, min_moving_speed)
    if not is_valid:
        # in theory, this failed for an unexpected reason
        raise ValueError("A course segment is not valid. Please check the course details and try again.")

    normalized_segment = __normalize_segment(segment)
    return __compute_segment_detail(normalized_segment,
                                    start_time=start_time,
                                    moving_speed=moving_speed,
                                    min_moving_speed=min_moving_speed,
                                    down_time_ratio=down_time_ratio,
                                    split_delta=split_delta,
                                    distance=distance)


def __validate_segment(segment: Segment, moving_speed: float, min_moving_speed) -> bool:
    curr_min_moving_speed = segment.moving_speed if segment.min_moving_speed is not None else min_moving_speed
    curr_moving_speed = segment.moving_speed if segment.moving_speed else moving_speed

    if curr_moving_speed < curr_min_moving_speed:
        raise ValueError('Split moving speed cannot be lower than the minimum moving speed')

    return True


def __normalize_segment(segment: Segment) -> Segment:
    return Segment(
        splits=segment.splits,
        down_time_ratio=segment.down_time_ratio,
        split_delta=segment.split_delta,
        moving_speed=segment.moving_speed,
        min_moving_speed=segment.min_moving_speed,
        sleep_time=segment.sleep_time,
        no_end_down_time=segment.no_end_down_time,
    )


def __compute_segment_detail(segment: Segment,
                             start_time: datetime,
                             moving_speed: float,
                             min_moving_speed: float,
                             down_time_ratio: float,
                             split_delta: float,
                             distance: float,
                             ) -> SegmentDetail:
    split_details: list[SplitDetail] = []
    segment_start: datetime = start_time
    curr_start_time: datetime = start_time
    curr_moving_speed: float = moving_speed
    curr_distance: float = distance
    initial_start_distance: float = distance

    # at the start of a new segment the following are applied by the course-level settings:
    #   - min_moving_speed
    #   - moving speed,
    #   - split_delta
    #   - down_time_ratio
    # however, the segment's defined values override them, so here we apply them if defined,
    if segment.min_moving_speed is not None:
        min_moving_speed = segment.min_moving_speed

    if segment.moving_speed is not None:
        curr_moving_speed = segment.moving_speed

    if segment.split_delta is not None:
        split_delta = segment.split_delta

    if segment.down_time_ratio is not None:
        down_time_ratio = segment.down_time_ratio

    if curr_moving_speed < min_moving_speed:
        raise ValueError('Split moving speed cannot be lower than the minimum moving speed')

    for i, split in enumerate(segment.splits):
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
        if i == len(segment.splits) - 1 and segment.no_end_down_time:
            down_time = timedelta(hours=0)

        split_time = moving_time + down_time
        active_time = split_time + split.adjustment_time

        split_detail = SplitDetail(
            distance=split.distance,
            start_time=curr_start_time,
            end_time=curr_start_time + active_time,
            adjustment_start=curr_start_time + split_time,
            moving_speed=curr_moving_speed,
            moving_time=moving_time,
            down_time=down_time,
            adjustment_time=split.adjustment_time,
            split_time=split_time,
            active_time=active_time,
            pace=split.distance / (active_time.total_seconds() / 3600),
            start_distance=curr_distance,
            rest_stop=split.rest_stop,
            name=split.name,
            sub_splits=__compute_sub_split_detail(
                split=split,
                start_distance=curr_distance,
                no_end_down_time=segment.no_end_down_time,
                start_time=curr_start_time,
                down_time=down_time,
                moving_speed=curr_moving_speed
            ),
        )

        # NOTE: The operations below are for post-split calculation updates.
        # Shifting start time, updating subsequent moving speed, etc.

        # decay split moving speed for next split, limit to min_moving_speed
        next_delta_moving_speed = curr_moving_speed + split_delta

        curr_moving_speed = max(next_delta_moving_speed, min_moving_speed)
        curr_distance += split.distance
        curr_start_time += active_time

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
        sleep_time=segment.sleep_time,
        start_distance=initial_start_distance,
        name=segment.name
    )


def __compute_sub_split_detail(split: Split,
                               start_distance: float,
                               start_time: datetime,
                               down_time: timedelta,
                               moving_speed: float,
                               no_end_down_time: bool) -> list[SubSplitDetail]:
    sub_split_distances = split.sub_split_mode.sub_splits(split.distance)
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
        sub_split_active_time = sub_split_moving_time + sub_split_down_time

        sub_split_detail = SubSplitDetail(
            distance=sub_split_distance,
            start_time=start_time,
            end_time=start_time + sub_split_active_time,
            moving_speed=moving_speed,
            moving_time=sub_split_moving_time,
            down_time=sub_split_down_time,
            split_time=sub_split_active_time,
            active_time=sub_split_active_time,  # equal to split time because sub-splits do not consider adjusted time
            pace=sub_split_distance / (sub_split_active_time.total_seconds() / 3600),
            start_distance=start_distance
        )

        start_time += sub_split_moving_time + sub_split_down_time
        start_distance += sub_split_distance

        res.append(sub_split_detail)
    return res
