from datetime import datetime, timedelta

from Cycling.pace_calculator import HeadingKeys
from Cycling.pace_calculator.Course import Course, TARGET_DISTANCE
from Cycling.pace_calculator.CourseDetailPrinter import CourseDetailPrinter
from Cycling.pace_calculator.RestStop import RestStop, FixedOpenHours, WeeklyOpenHours
from Cycling.pace_calculator.Segment import Segment
from Cycling.pace_calculator.Split import Split


def main():
    course = Course(
        mode=TARGET_DISTANCE,
        segments=[
            Segment(
                splits=[
                    Split(
                        distance=80,
                    ),
                    Split(
                        distance=160,
                    ),
                    Split(
                        distance=240,
                    ),
                    Split(
                        distance=320,
                        adjusted_time=timedelta(minutes=15),
                    ),
                    Split(
                        distance=400,
                    ),
                    Split(
                        distance=480,
                    ),
                    Split(
                        distance=560,
                    ),
                    Split(
                        distance=640,
                    ),
                ],
                sleep_time=timedelta(hours=3, minutes=30)
            ),
            Segment(
                moving_speed=20,
                split_decay=0.5,
                min_moving_speed=18,
                splits=[
                    Split(
                        distance=720,
                    ),
                    Split(
                        distance=800,
                    ),
                    Split(
                        distance=880,
                    ),
                    Split(
                        distance=960,
                    ),
                    Split(
                        distance=1040,
                        adjusted_time=timedelta(minutes=21),
                        moving_speed=20
                    ),
                    Split(
                        distance=1121.1,
                    ),
                ],
            )
        ],
        KOMs=[],
        optional_rest_stops=[],
        start_time=datetime(2026, 7, 11, 6, 0, 0),
        init_moving_speed=17.5,
        min_moving_speed=16,
        down_time_ratio=0.05,
        split_decay=0.1,
    )

    course_details = course.compute_course_detail()

    printer = CourseDetailPrinter(
        course_details=course_details,
        zebra_split_color=False,
        keys_to_exclude=HeadingKeys.REST_STOP_DETAILS,
    )

    printer.print(include_sub_splits=False)


if __name__ == '__main__':
    main()
