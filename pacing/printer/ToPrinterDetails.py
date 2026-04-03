from datetime import timedelta

from pacing.printer.PrinterDetailLine import PrinterDetailLine
from pacing.calculator.models.details.course_detail import CourseDetail
from pacing.shared.utils import to_hours


def get_rolling_segment_details(course_detail: CourseDetail, segment_index: int) -> PrinterDetailLine:
    """
    Computes the rolling totals up to the given segment index (inclusive).
    :param course_detail: the CourseDetail object containing the segment details and totals for the entire course
    :param segment_index: the index of the segment for which to compute the rolling totals
    :return: a PrinterDetailLine containing the rolling totals up to the given segment index
    """
    if segment_index < 0 or segment_index >= len(course_detail.segment_details):
        raise ValueError(f"Invalid segment index: {segment_index}")

    # base values, set to zero
    rolling_distance = 0
    rolling_adjustment_time = timedelta(hours=0)
    rolling_down_time = timedelta(hours=0)
    rolling_moving_time = timedelta(hours=0)
    rolling_elapsed_time = timedelta(hours=0)
    rolling_sleep_time = timedelta(hours=0)

    for segment in course_detail.segment_details[:segment_index + 1]:
        # while adding the *.*_hours would be easier, we would lose precision by converting to
        # hours at the segment level
        rolling_distance += segment.distance
        rolling_adjustment_time += segment.adjustment_time
        rolling_down_time += segment.down_time
        rolling_moving_time += segment.moving_time
        rolling_elapsed_time += segment.elapsed_time
        rolling_sleep_time += segment.sleep_time

    return PrinterDetailLine(
        start_time=course_detail.start_time,
        end_time=course_detail.segment_details[segment_index].end_time,
        distance=rolling_distance,
        adjustment_time_hours=to_hours(rolling_adjustment_time.total_seconds()),
        down_time_hours=to_hours(rolling_down_time.total_seconds()),
        moving_time_hours=to_hours(rolling_moving_time.total_seconds()),
        elapsed_time_hours=to_hours(rolling_elapsed_time.total_seconds()),
        sleep_time_hours=to_hours(rolling_sleep_time.total_seconds()),
    )


def to_printer_detail_line(obj: CourseDetail) -> PrinterDetailLine:
    adjustment_time_hours = obj.adjustment_time_hours

    return PrinterDetailLine(
        start_time=obj.start_time,
        end_time=obj.end_time,
        adjustment_time_hours=adjustment_time_hours,
        elapsed_time_hours=obj.elapsed_time_hours,
        down_time_hours=obj.down_time_hours,
        moving_time_hours=obj.moving_time_hours,
        distance=obj.distance,
        sleep_time_hours=obj.sleep_time_hours
    )
