from datetime import datetime, timedelta

from pacing.calculator.dtos.course import Course
from pacing.calculator.models.details.course_detail import CourseDetail
from pacing.calculator.models.details.segment_detail import SegmentDetail
from pacing.calculator.service.calculations.segment_processor import __compute_segment_detail
from pacing.shared.CONSTANTS import DISTANCE, TARGET_DISTANCE


def process_course(course: Course, start_distance: float = 0) -> CourseDetail:
    is_valid = __validate_course(course)

    if not is_valid:
        # in theory, this failed for an unexpected reason
        raise ValueError("Course is not valid. Please check the course details and try again.")

    normalized_course = __normalize_course(course)
    return __compute_course_detail(normalized_course, curr_distance=start_distance)


def __validate_course(course: Course) -> bool:
    """
    This mode validates course values.
    In TARGET_DISTANCE mode, it checks that split distances are non-decreasing.
    :param course:
    :return: bool indicating whether the course is valid or not
    """
    if course.mode == DISTANCE:
        return True

    if course.mode == TARGET_DISTANCE:
        # must be non-decreasing
        lass_distance_marker: float = 0
        for segment in course.segments:
            if len(segment.splits) == 0:
                raise ValueError("Each segment must have at least one split.")

            for split in segment.splits:
                if split.distance <= lass_distance_marker:
                    raise ValueError("In DISTANCE mode, split distances must be non-decreasing.")
                lass_distance_marker = split.distance
        return True


def __normalize_course(course: Course) -> Course:
    """
    Returns a normalized version of a course object.
    This subroutine normalizes distances to be based on the distance of each split rather than another metric.
    Modes like Target Distance require this normalization to be done before calculations can be performed.
    :param course: an initial Course object that may have non-normalized fields based on the course mode
    :return: a new Course object with normalized fields (mode will be set to DISTANCE)
    """
    res = Course(
        segments=course.segments,
        init_moving_speed=course.init_moving_speed,
        min_moving_speed=course.min_moving_speed,
        down_time_ratio=course.down_time_ratio,
        split_decay=course.split_decay,
        start_time=course.start_time,
        mode=DISTANCE
    )

    if course.mode == DISTANCE:
        return res

    if course.mode == TARGET_DISTANCE:
        # the course object is based on target distance, so we must compute the individual split distances
        # this is based on the target distance and the previous split distances
        offset: float = 0
        for segment in res.segments:
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
        return res


def __compute_course_detail(course: Course, curr_distance: float = 0) -> CourseDetail:
    initial_start_distance = curr_distance
    curr_start_time: datetime = course.start_time
    curr_moving_speed: float = course.init_moving_speed
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

    for segment in course.segments:
        segment_detail = __compute_segment_detail(
            segment=segment,
            down_time_ratio=course.down_time_ratio,
            split_decay=course.split_decay,
            start_time=curr_start_time,
            moving_speed=curr_moving_speed,
            distance=curr_distance,
            min_moving_speed=course.min_moving_speed,
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
        start_time=course.start_time,
        end_time=curr_start_time,
        elapsed_time=curr_start_time - course.start_time,
        moving_time=total_moving_time,
        down_time=total_down_time,
        sleep_time=total_sleep_time,
        adjustment_time=total_adjustment_time,
        start_distance=initial_start_distance
    )
