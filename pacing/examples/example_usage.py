# This script demos how to use the CourseDetailPrinter
# Key details:
# 1) Define a Course object
# 2) Use the course_processor to `process_course`
# 3) Utilize the CourseDetailPrinter to display the details in a neat format

from datetime import timedelta, datetime

from colorama import Fore

from pacing.printer import HeadingKeys
from pacing.printer.CourseDetailPrinter import CourseDetailPrinter
from pacing.calculator.dtos.course import Course
from pacing.calculator.dtos.rest_stop import RestStop
from pacing.calculator.dtos.open_hours import WeeklyOpenHours, FixedOpenHours
from pacing.calculator.dtos.segment import Segment
from pacing.calculator.dtos.split import Split
from pacing.calculator.dtos.sub_split_mode import FixedDistanceSubSplitMode, CustomSubSplitMode, EvenSubSplitMode
from pacing.calculator.service.calculations.course_processor import process_course
from pacing.shared.CONSTANTS import DISTANCE


def main():
    # 1) Define a Course object
    course = Course(
        # either DISTANCE or TARGET_DISTANCE (distance-value-based or distance-marker-based)
        mode=DISTANCE,
        segments=[
            Segment(
                name="Chicago to St Ignace",  # you can also give it names for better readability in the output
                splits=[
                    Split(
                        distance=100,
                        sub_split_mode=CustomSubSplitMode(
                            # you can set a few different sub-split modes--fixed, even, or custom.
                            # custom mode does no validation, so computations will be off if distances do not match
                            sub_split_distances=[10, 20, 30, 40, 5]
                        ),
                        rest_stop=RestStop(
                            name="McDonald's",
                            # for open hours, you can set daily/weekly or fixed hours
                            # weekly goes by date and fixed is the same hours every day
                            # this can be used by the course processor to determine if the rest stop is open
                            open_hours=WeeklyOpenHours(
                                mon="6:00a -  9:00p",
                                tue="9:00a - 10:00p",
                            ),
                            address="7832 S Western Ave, Chicago, IL 60620",
                            alt="https://share.google/JGoFaIMStVTrwLUBB",
                        ),
                        # adjusted_time is a constant time adjustment that is added to the split time
                        # this can account for additional rest time that is not captured by the down_time calculation,
                        # such as an extended break, a climb that slows you down, or a nice tailwind
                        adjustment_time=timedelta(minutes=-5),
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
                            # you can also define separate sub-split modes for each splits
                            sub_split_distance=50
                        ),
                        moving_speed=20,  # perhaps downhill
                    ),
                ],
                sleep_time=timedelta(hours=11),
                # you can specify whether you want down_time on the last split or not
                # typically, you only want down_time in between splits,
                # as the last split will likely end at the rest stop
                # you can include it if you wish by setting this to False
                no_end_down_time=False
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
                        sub_split_mode=EvenSubSplitMode(
                            sub_split_count=10
                        ),
                        rest_stop=RestStop(
                            name="McDonald's",
                            open_hours=FixedOpenHours(
                                hours="24hrs",
                            ),
                            address="7832 S Western Ave, Chicago, IL 60620",
                            # link with more details or alternative rest stop option if this one is closed
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
                        # Fixed mode does perform some adjustments to ensure that sub-split distances make sense
                        # in this case the split distance is 50 but sub-split distance is 60,
                        # so it will just be one sub-split of 50
                        sub_split_mode=FixedDistanceSubSplitMode(
                            sub_split_distance=60
                        ),
                        # perhaps a last climb
                        adjustment_time=timedelta(minutes=-5)
                    ),
                ],
                no_end_down_time=False,
                sleep_time=timedelta(hours=8),
            )
        ],
        # KOMs=[],
        start_time=datetime(2025, 12, 13, 8, 0, 0),
        init_moving_speed=17,
        min_moving_speed=15,
        down_time_ratio=0.05,
        split_decay=0.1
    )

    # 2) Use the course_processor to `process_course`
    course_details = process_course(course)

    # 3) Utilize the CourseDetailPrinter to display the details in a neat format
    printer = CourseDetailPrinter(
        # Single Responsibility Principle: CourseDetailPrinter is solely responsible for formatting & printing details,
        # so it takes a CourseDetails object and has no knowledge of how the course details are calculated/structured
        course_details=course_details,
        # if you want to see zebra split coloring in the terminal output, set this to True. Default is False.
        # this only applies to splits; sub-splits are printed in the same color
        zebra_split_color=False,
        # snippet below shows that you can exclude keys that you don't want to see in the output
        # there is a handy REST_STOP_DETAILS set in HeadingKeys that includes all the rest stop related keys
        # you can use that and Union it with any other keys you want to exclude, such as ADJUSTMENT_START
        keys_to_exclude=HeadingKeys.REST_STOP_DETAILS | {HeadingKeys.ADJUSTMENT_START},
        # snippet below will rename Distance to Interval, but keep the rest of the column names unchanged
        keys_to_rename={HeadingKeys.DISTANCE: "Interval"},
        # code below will result in printing Distance (now renamed to 'Interval'), Pace, and Moving Speed columns first,
        # then the rest of the columns in default order
        reordered_keys=[HeadingKeys.DISTANCE, HeadingKeys.PACE, HeadingKeys.MOVING_SPEED],
        # you can also override the default colors using the Colorama Fore constants
        SEGMENT_COUNT_CLR=f"{Fore.LIGHTWHITE_EX}"
    )

    # define what details you want to see in the output by setting the booleans in the print function
    printer.print(include_sub_splits=True, include_rolling_summary=True)


if __name__ == '__main__':
    main()
