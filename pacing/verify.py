from datetime import datetime

from Cycling.pacing.calculator.dtos.course import Course
from Cycling.pacing.calculator.dtos.segment import Segment
from Cycling.pacing.calculator.dtos.split import Split
from Cycling.pacing.calculator.dtos.sub_split_mode import EvenSubSplitMode, FixedDistanceSubSplitMode
from Cycling.pacing.calculator.service.calculations.course_processor import process_course
from Cycling.pacing.printer.CourseDetailPrinter import CourseDetailPrinter

if __name__ == "__main__":
    c = Course(
        segments=[
            Segment(
                splits=[
                    Split(
                        distance=40,
                        sub_split_mode=FixedDistanceSubSplitMode(
                            sub_split_distance=20
                        )
                    ),
                    Split(
                        distance=40,
                        sub_split_mode=EvenSubSplitMode(
                            sub_split_count=4
                        )
                    )
                ]
            )
        ],
        mode="distance",
        init_moving_speed=20.0,
        min_moving_speed=16.0,
        down_time_ratio=0.05,
        split_decay=0.25,
        # 2026-03-04T08:10:00
        start_time=datetime(2026, 3, 4, 8, 10, 0)
    )
    course_details = process_course(c)
    printer = CourseDetailPrinter(course_details)
    printer.print(include_sub_splits=True)