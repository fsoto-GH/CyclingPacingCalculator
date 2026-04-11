from datetime import timedelta

from pacing.api.routes.calculator.dto.course import Course
from pacing.api.routes.calculator.dto.split import Split
from pacing.calculator.dtos.course import Course as CourseDto
from pacing.calculator.dtos.segment import Segment as SegmentDto
from pacing.calculator.dtos.rest_stop import RestStop as RestStopDto
from pacing.calculator.dtos.open_hours import OpenHours, FixedOpenHours, WeeklyOpenHours
from pacing.calculator.dtos.split import Split as SplitDto
from pacing.calculator.dtos.sub_split_mode import *


def validate_course(course: Course) -> list[str]:
    res: list[str] = []

    if course.down_time_ratio < 0 or course.down_time_ratio > 1:
        res.append(f"Course has invalid down_time_ratio '{course.down_time_ratio}'. "
                   f"Down time ratio should be between 0 and 1.")
        
    if course.init_moving_speed <= 0:
        res.append(f"Course has invalid init_moving_speed '{course.init_moving_speed}'. "
                   f"Initial moving speed should be greater than 0.")
    
    if course.min_moving_speed <= 0:
        res.append(f"Course has invalid min_moving_speed '{course.min_moving_speed}'. "
                   f"Minimum moving speed should be greater than 0.")

    if course.init_moving_speed < course.min_moving_speed:
        res.append(f"Course has invalid init_moving_speed '{course.init_moving_speed}' which is less than "
                   f"min_moving_speed '{course.min_moving_speed}'.")

    for i, segment in enumerate(course.segments):
        if segment.sleep_time < timedelta(hours=0):
            res.append(f"Segment {i} has invalid sleep_time '{segment.sleep_time}'. Sleep time cannot be negative.")
        for j, split in enumerate(segment.splits):

            sub_split_validation_result = __valid_sub_split_mode(i, j, split)
            if sub_split_validation_result is not None:
                res.append(sub_split_validation_result)

            # validate rest stop
            if split.rest_stop is not None:
                is_fixed = 'fixed' in split.rest_stop.open_hours
                # if 'fixed' is a key, we ignore 0-6
                if is_fixed and len(split.rest_stop.open_hours) > 1:
                    res.append(f"Rest stop (Segment {i}, Split {j}) '{split.rest_stop.name}' "
                               f"has 'fixed' as a key in open hours but also has other keys, which is invalid.")
                elif not is_fixed and len(split.rest_stop.open_hours) != 7:
                    res.append(f"Rest stop (Segment {i}, Split {j}) '{split.rest_stop.name}' "
                               f"should have either keys 0-6 (where 0 is Monday) or only the 'Fixed' key.")

    return res


def course_to_dto(course: Course) -> CourseDto:
    """
    This function converts a Course object from the API layer to a CourseDto object for the calculator service layer.
    This should be used after validating the course with the validate_course function to ensure that the course is valid
    and can be converted without errors.

    :param course: a Course object from the API layer, which contains all the necessary information about the course,
    segments, splits, and rest stops.
    :return: a CourseDto object that can be used by the calculator service layer to perform calculations
    """
    dto_segments: list[SegmentDto] = [
        SegmentDto(
            splits=[
                SplitDto(
                    distance=split.distance,
                    sub_split_mode=sub_split_to_dto(split),
                    rest_stop=rest_stop_to_dto(split),
                    down_time=split.down_time,
                    moving_speed=split.moving_speed,
                    adjustment_time=split.adjustment_time
                )
                for split in segment.splits
            ],
            down_time_ratio=segment.down_time_ratio,
            split_delta=segment.split_delta,
            moving_speed=segment.moving_speed,
            min_moving_speed=segment.min_moving_speed,
            sleep_time=segment.sleep_time,
            no_end_down_time=segment.no_end_down_time
        )
        for segment in course.segments
    ]

    dto_course = CourseDto(
        mode=course.mode,
        segments=dto_segments,
        init_moving_speed=course.init_moving_speed,
        min_moving_speed=course.min_moving_speed,
        down_time_ratio=course.down_time_ratio,
        split_delta=course.split_delta,
        start_time=course.start_time
    )

    return dto_course


def sub_split_to_dto(split: Split) -> SubSplitMode:
    if split.sub_split_mode == 'custom':
        return CustomSubSplitMode(sub_split_distances=split.sub_split_distances)

    if split.sub_split_mode == 'even':
        return EvenSubSplitMode(sub_split_count=split.sub_split_count)

    if split.sub_split_mode == 'fixed':
        return FixedDistanceSubSplitMode(sub_split_distance=split.sub_split_distance,
                                         last_sub_split_threshold=split.last_sub_split_threshold)


def rest_stop_to_dto(split: Split) -> RestStopDto | None:
    if split.rest_stop is None:
        return None

    open_hours: OpenHours
    if 'fixed' in split.rest_stop.open_hours:
        open_hours = FixedOpenHours(hours=split.rest_stop.open_hours['fixed'])
    else:
        day_keys = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
        day_values = {day_keys[int(k)]: v for k, v in split.rest_stop.open_hours.items()}
        open_hours = WeeklyOpenHours(**day_values)

    return RestStopDto(
        name=split.rest_stop.name,
        open_hours=open_hours,
        address=split.rest_stop.address,
        alt=split.rest_stop.alt,
        arrival_date=split.rest_stop.arrival_date
    )


def __valid_sub_split_mode(seg_i, split_j, split: Split) -> str | None:
    mode = split.sub_split_mode

    if mode not in ("custom", "even", "fixed"):
        return f"(Segment {seg_i}, Split {split_j}) has invalid sub_split_mode '{mode}'. " \
               f"Valid modes are 'custom', 'even', 'fixed'."

    if mode == "custom" and split.sub_split_distances is None:
        return f"(Segment {seg_i}, Split {split_j}) has 'custom' sub_split_mode but no sub_split_distances provided."

    if mode == "even" and split.sub_split_count is None:
        return f"(Segment {seg_i}, Split {split_j}) has 'even' sub_split_mode but no sub_split_count provided."

    if mode == 'fixed' and split.sub_split_distance is None:
        return f"(Segment {seg_i}, Split {split_j}) has 'fixed' sub_split_mode but no sub_split_distance provided."

    return None
