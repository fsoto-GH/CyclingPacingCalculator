# This script demos how to use the CourseDetailPrinter
# Key details:
# 1) Define a Course object
# 2) Use the course_processor to `process_course`
# 3) Utilize the CourseDetailPrinter to display the details in a neat format

from datetime import timedelta, datetime

from pacing.printer import HeadingKeys
from pacing.printer.CourseDetailPrinter import CourseDetailPrinter
from pacing.calculator.dtos.course import Course
from pacing.calculator.dtos.rest_stop import RestStop
from pacing.calculator.dtos.open_hours import FixedOpenHours
from pacing.calculator.dtos.segment import Segment
from pacing.calculator.dtos.split import Split
from pacing.calculator.dtos.sub_split_mode import FixedDistanceSubSplitMode
from pacing.calculator.service.calculations.course_processor import process_course
from pacing.shared.CONSTANTS import TARGET_DISTANCE


def main():
    # Example Mishigami Game Plan

    # same FixedDistanceSubSplitMode
    sub_split_mode = FixedDistanceSubSplitMode(sub_split_distance=50, last_sub_split_threshold=15)

    course = Course(
        mode=TARGET_DISTANCE,
        segments=[
            Segment(
                name="Chicago to St Ignace",
                splits=[
                    Split(
                        distance=114.3,
                        sub_split_mode=sub_split_mode,
                        rest_stop=RestStop(
                            name="McDonald's",
                            open_hours=FixedOpenHours(hours="6:00a -  9:00p"),
                            address="7170 N Teutonia Ave, Milwaukee, WI 53209",
                        ),
                    ),
                    Split(
                        distance=246.5,
                        sub_split_mode=sub_split_mode,
                        rest_stop=RestStop(
                            name="Shell Gas Station",
                            open_hours=FixedOpenHours(hours="24hrs"),
                            address="1010 S Broadway, De Pere, WI 54115",
                        ),
                    ),
                    Split(
                        distance=394.3,
                        sub_split_mode=sub_split_mode,
                        rest_stop=RestStop(
                            name="bp",
                            open_hours=FixedOpenHours(hours="6:00a - 1:00a"),
                            address="W365 US-2 #41, Harris, MI 49845",
                        ),
                    ),
                    Split(
                        distance=480.7,
                        sub_split_mode=sub_split_mode,
                        rest_stop=RestStop(
                            name="bp",
                            open_hours=FixedOpenHours(hours="7:00a - 9:00p"),
                            address="1223 US-2, Gulliver, MI 49840",
                        ),
                    ),
                    Split(
                        distance=571.5,
                        sub_split_mode=sub_split_mode,
                        rest_stop=RestStop(
                            name="Best Western Harbour Pointe Lakefront",
                            open_hours=FixedOpenHours(hours="3:00p - 11:00a"),
                            address="797 N State St, St Ignace, MI 49781",
                        ),
                    )
                ],
                sleep_time=timedelta(hours=4),
                no_end_down_time=False  # use this computed down_time to pad for debrief for sleep
            ),
            Segment(
                # moving_speed=16.0,
                name="St Ignace to Chicago",
                splits=[
                    Split(
                        distance=696.8,
                        sub_split_mode=sub_split_mode,
                        rest_stop=RestStop(
                            name="Mobil",
                            open_hours=FixedOpenHours(hours="5:00a - 11:00p"),
                            address="100 1st St, Elk Rapids, MI 49629",
                        ),
                    ),
                    Split(
                        distance=805.3,
                        sub_split_mode=sub_split_mode,
                        rest_stop=RestStop(
                            name="Wesco",
                            open_hours=FixedOpenHours(hours="24hrs"),
                            address="75 Cypress St, Manistee, MI 49660",
                        )
                    ),
                    Split(
                        distance=936.2,
                        sub_split_mode=sub_split_mode,
                        rest_stop=RestStop(
                            name="McDonald's",
                            open_hours=FixedOpenHours(hours="24hrs"),
                            address="213 N River Ave, Holland, MI 49424",
                        )
                    ),
                    Split(
                        distance=1036.2,
                        sub_split_mode=sub_split_mode,
                        rest_stop=RestStop(
                            name="Barney’s",
                            open_hours=FixedOpenHours(hours="7:00a - 9:00p"),
                            address="10 N Thompson St, New Buffalo, MI 49117",
                        )
                    ),
                    Split(
                        distance=1121.2,
                        sub_split_mode=sub_split_mode,
                    )
                ],
            )
        ],
        start_time=datetime(2025, 7, 12, 6, 0, 0),
        init_moving_speed=16.5,
        min_moving_speed=15,
        down_time_ratio=0.12,
        split_decay=0.25
    )

    course_details = process_course(course)
    printer = CourseDetailPrinter(
        course_details=course_details,
        zebra_split_color=True,
        keys_to_exclude={HeadingKeys.REST_STOP_ALT_URL},
        keys_to_rename={HeadingKeys.DISTANCE: "Interval"},
        reordered_keys=[HeadingKeys.DISTANCE, HeadingKeys.PACE, HeadingKeys.MOVING_SPEED]
    )

    printer.print(include_sub_splits=False, include_rolling_summary=False)


if __name__ == '__main__':
    main()
