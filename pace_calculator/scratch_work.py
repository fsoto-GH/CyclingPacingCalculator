from datetime import datetime, timedelta

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
                        distance=86.1,
                        rest_stop=RestStop(
                            name="Casey's",
                            open_hours=FixedOpenHours(
                                hours=" 4:00a - 12:00am",
                            ),
                            address="500 E Main St, Capron, IL 61012",
                            alt="https://maps.app.goo.gl/q5DsKEa82UGf63kA8",
                        ),
                    ),
                    Split(
                        distance=173,
                        rest_stop=RestStop(
                            name="Casey's",
                            open_hours=FixedOpenHours(
                                hours=" 8:00a -  9:00p",
                            ),
                            address="100 S Dodge St, Burlington, WI 53105",
                            alt="https://maps.app.goo.gl/9Vnidx3WmyD5VdyJ8",
                        ),
                    ),
                    Split(
                        distance=250.8,
                    ),
                ],
            ),
        ],
        KOMs=[],
        optional_rest_stops=[],
        start_time=datetime(2026, 5, 5, 6, 0, 0),
        init_moving_speed=18,
        min_moving_speed=15,
        down_time_ratio=0.05,
        split_decay=0.05,
    )

    course_details = course.compute_course_detail()

    printer = CourseDetailPrinter(
        course_details=course_details,
        zebra_split_color=False,
    )

    printer.print(include_sub_splits=False)


if __name__ == '__main__':
    main()
