from datetime import timedelta, datetime

from Cycling.pace_calculator.Course import Course
from Cycling.pace_calculator.CourseDetailPrinter import CourseDetailPrinter
from Cycling.pace_calculator.HeadingKeys import *
from Cycling.pace_calculator.RestStop import RestStop, WeeklyOpenHours, FixedOpenHours
from Cycling.pace_calculator.Segment import Segment
from Cycling.pace_calculator.Split import Split
from Cycling.pace_calculator.SubSplitMode import FixedDistanceSubSplitMode, CustomSubSplitMode


def main():
    course = Course(
        mode=DISTANCE,  # either DISTANCE or TARGET_DISTANCE (distance-value-based or distance-marker-based)
        segments=[
            Segment(
                splits=[
                    Split(
                        distance=100,
                        sub_split_mode=CustomSubSplitMode(
                            sub_split_distances=[10, 20, 30, 40, 10]
                        ),
                        rest_stop=RestStop(
                            name="McDonald's",
                            open_hours=WeeklyOpenHours(
                                mon="6:00a -  9:00p",
                                tue="9:00a - 10:00p",
                            ),
                            address="7832 S Western Ave, Chicago, IL 60620",
                            alt="https://share.google/JGoFaIMStVTrwLUBB",
                        ),
                        adjusted_time=timedelta(minutes=10),  # a bit of delay here, perhaps traffic congestion
                    ),
                    Split(
                        distance=100,
                        sub_split_mode=FixedDistanceSubSplitMode(
                            sub_split_distance=50
                        ),
                        rest_stop=RestStop(
                            name="McDonald's",
                            open_hours=FixedOpenHours(
                                hours="24hrs",
                            ),
                            address="7832 S Western Ave, Chicago, IL 60620",
                            alt="https://share.google/JGoFaIMStVTrwLUBB",
                        ),
                        moving_speed=12,  # perhaps a climb here, so slower speed
                    ),
                    Split(
                        distance=20,
                        sub_split_mode=FixedDistanceSubSplitMode(
                            sub_split_distance=50
                        ),
                        moving_speed=20,  # perhaps a climb here, so slower speed
                    ),
                ],
                sleep_time=timedelta(hours=11),
                no_end_down_time=False  # for whatever reason, we want down_time after last split
            ),
            Segment(
                splits=[
                    Split(
                        distance=300,
                        sub_split_mode=FixedDistanceSubSplitMode(
                            sub_split_distance=50
                        ),
                        rest_stop=RestStop(
                            name="McDonald's",
                            open_hours=WeeklyOpenHours(
                                mon="6:00a -  9:00p",
                                tue="9:00a - 10:00p"
                            ),
                            address="7832 S Western Ave, Chicago, IL 60620",
                            alt="https://share.google/JGoFaIMStVTrwLUBB",
                        ),
                        moving_speed=18,  # going a little faster the second 'day'
                        # down_time=timedelta(minutes=5),  # brief rest stop
                    ),
                    Split(
                        distance=50,
                        sub_split_mode=FixedDistanceSubSplitMode(
                            sub_split_distance=50
                        ),
                        rest_stop=RestStop(
                            name="McDonald's",
                            open_hours=FixedOpenHours(
                                hours="24hrs",
                            ),
                            address="7832 S Western Ave, Chicago, IL 60620",
                            alt="https://share.google/JGoFaIMStVTrwLUBB",
                        ),
                    ),
                ],
                # notice how sleep_time is not defined here, so it will default to 0
            ),
            Segment(
                splits=[
                    Split(
                        distance=50,
                        sub_split_mode=FixedDistanceSubSplitMode(
                            sub_split_distance=50
                        )
                    ),
                ],
                no_end_down_time=False
            )
        ],
        KOMs=[],
        start_time=datetime(2025, 12, 13, 8, 0, 0),
        init_moving_speed=17,
        min_moving_speed=15,
        down_time_ratio=0.05,
        split_decay=0.1
    )

    course_details = course.compute_course_detail()

    # keys to exclude from printing
    # see the Cycling.pace_calculator.HeadingKeys module for available keys
    keys_to_exclude: set[str] = {
        ADJUSTMENT_START
    }

    # we can also use the REST_STOP_DETAILS to exclude the rest stop details
    # keys_to_exclude.update(REST_STOP_DETAILS)

    # we can also rename certain keys for better readability
    keys_to_rename: dict[str, str] = {
        TOTAL_TIME: "Elapsed Time"
    }

    printer = CourseDetailPrinter(
        course_details=course_details,
        keys_to_exclude=keys_to_exclude,
        keys_to_rename=keys_to_rename,
        zebra_split_color=False,
    )

    # we can also reorder keys in the grid
    # here we want to display start_end span first before distance
    reordered_keys = [START_END, DISTANCE]

    printer.print(include_sub_splits=True, reordered_keys=reordered_keys)


if __name__ == '__main__':
    main()
