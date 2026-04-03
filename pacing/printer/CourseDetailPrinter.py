from dataclasses import dataclass

from colorama import Fore
from colorama import Style

from printer.HeadingKeys import *
from printer.PrinterDetailLine import PrinterDetailLine
from printer.PrinterField import PrinterField
from printer.ToPrinterDetails import get_rolling_segment_details, to_printer_detail_line
from calculator.models.details.course_detail import CourseDetail
from calculator.models.details.segment_detail import SegmentDetail
from calculator.models.details.split_detail import SplitDetail
from calculator.models.details.sub_split_detail import SubSplitDetail
from shared.utils import hours_to_pretty, span_to_pretty


@dataclass
class CourseDetailPrinter:
    course_details: CourseDetail  # a CourseDetail object representing the course strategy
    keys_to_exclude: set[str] = None  # set of keys to exclude from printing
    keys_to_rename: dict[str: str] = None  # key: original key, value: new name to rename for printing
    reordered_keys: list[str] = None  # specifies which keys to print out first; you can reorder
    zebra_split_color: bool = False  # whether to color splits in alternating colors for better readability

    # the fields below can be customized for color and style on initialization

    GRID_SPACER_CLR: str = Fore.YELLOW + Style.BRIGHT  # this is the grid lines
    GRID_SPACER: str = f' │ '  # spacer between columns

    HEADER_SPACER: str = GRID_SPACER  # spacer for header line, should match the size of GRID_SPACER
    SEGMENT_HEADER_CLR: str = Fore.LIGHTBLUE_EX + Style.BRIGHT  # the text color for header keys

    SPLIT_DETAIL_CLR_EVEN: str = Fore.CYAN + Style.BRIGHT  # the text color for even split detail lines
    SPLIT_DETAIL_CLR_ODD = Fore.GREEN + Style.BRIGHT  # color for odd split detail lines, only if zebra_split_color=True

    SUB_SPLIT_DETAIL_STYLE: str = Fore.WHITE + Style.NORMAL  # the text color for sub-split detail lines

    SEGMENT_FOOTER_CLR: str = Fore.BLUE + Style.BRIGHT  # the text color for segment footer lines

    SEGMENT_SUMMARY_CLR: str = Fore.MAGENTA + Style.BRIGHT  # the text color for segment summary lines

    SEGMENT_COUNT_CLR: str = Fore.LIGHTYELLOW_EX + Style.BRIGHT  # the text color for segment count lines

    COURSE_SUMMARY_CLR: str = Fore.LIGHTRED_EX + Style.BRIGHT  # the text color for course summary lines

    DATE_FORMAT = '%m/%d %I:%M:%S %p'

    FIELD_PROPS = {
        DISTANCE: PrinterField(
            name="Distance",
            header_format=">8s",
            value_format='8.2f',
            width=8,
        ),
        START_END: PrinterField(
            name=f"{'Start':>7s}, {'End':>7s}",
            header_format=">16s",
            value_format='16s',
            value_transformer=span_to_pretty,
            width=16
        ),
        MOVING_SPEED: PrinterField(
            name="Moving Speed",
            header_format=">12s",
            value_format='12.2f',
            width=12
        ),
        MOVING_TIME: PrinterField(
            name="Moving Time",
            header_format=">19s",
            value_format='19s',
            value_transformer=hours_to_pretty,
            width=19
        ),
        DOWN_TIME: PrinterField(
            name="Down Time",
            header_format=">19s",
            value_format='19s',
            value_transformer=hours_to_pretty,
            width=19
        ),
        PACE: PrinterField(
            name="Pace",
            header_format=">6s",
            value_format='6.2f',
            width=6
        ),
        SPLIT_TIME: PrinterField(
            name="Split Time",
            header_format=">19s",
            value_format='19s',
            value_transformer=hours_to_pretty,
            width=19
        ),
        ADJUSTMENT_TIME: PrinterField(
            name="Adjustment Time",
            header_format=">19s",
            value_format='19s',
            value_transformer=hours_to_pretty,
            width=19
        ),
        ADJUSTMENT_START: PrinterField(
            name="Adjustment Start",
            header_format=">17s",
            value_format=DATE_FORMAT,
            width=17
        ),
        ACTIVE_TIME: PrinterField(
            name="Active Time",
            header_format=">19s",
            value_format='19s',
            value_transformer=hours_to_pretty,
            width=19
        ),
        START_TIME: PrinterField(
            name="Start Time",
            header_format=">17s",
            value_format=DATE_FORMAT,
            width=17
        ),
        END_TIME: PrinterField(
            name="End Time",
            header_format=">17s",
            value_format=DATE_FORMAT,
            width=17
        ),
        REST_STOP_NAME: PrinterField(
            name="Rest Stop Name",
            header_format="<20s",
            value_format='<20s',
            width=20
        ),
        REST_STOP_HOURS: PrinterField(
            name="Rest Stop Hours",
            header_format="<17s",
            value_format='>17s',
            width=17
        ),
        REST_STOP_ADDRESS: PrinterField(
            name="Rest Stop Address",
            header_format=">40s",
            value_format='>40s',
            width=40
        ),
        REST_STOP_ALT_URL: PrinterField(
            name="Alternate URL",
            header_format="<50s",
            value_format='<50s',
            width=50
        )
    }

    @property
    def __reordered_keys(self) -> list[str]:
        if self.reordered_keys is None:
            return list(self.__exposed_fields)

        exposed_fields = self.__exposed_fields
        ordered_keys: list[str] = []

        for key in self.reordered_keys:
            if key in exposed_fields:
                ordered_keys.append(key)

        for key in exposed_fields:
            if key not in ordered_keys:
                ordered_keys.append(key)

        return ordered_keys

    def print(self, include_sub_splits: bool = False, include_rolling_summary: bool = False) -> None:
        """
        This prints a grid containing a visual representation of the computed split details.
        This includes segment headers, split details, segment footers, and segment summaries.
        The segment summaries include a per-segment breakdown of key ratios AND a rolling segment summary.
        This can include sub-split details as well.

        :param include_sub_splits: indicates whether sub-split details should be printed
        :param include_rolling_summary: whether to include rolling summary per segment
        When the list is partial, the keys will be listed first in the order specified, followed by the remaining keys
        """
        keys_showing_ordered = self.__reordered_keys
        dash_count = self.__compute_dash_count(keys_showing_ordered)

        header = self.__get_header_line(keys_showing_ordered)
        for i, segment_detail in enumerate(self.course_details.segment_details):
            print(f'{self.SEGMENT_COUNT_CLR}Segment #{i + 1}'
                  f'{f" ({segment_detail.name})" if segment_detail.name else ""}')
            print(header)
            print(f'{self.GRID_SPACER_CLR}{"─" * dash_count}{Style.RESET_ALL}')

            for j, split in enumerate(segment_detail.split_details):
                if include_sub_splits:
                    if j != 0:
                        print(f'{self.SUB_SPLIT_DETAIL_STYLE}{"─" * dash_count}{Style.RESET_ALL}')
                    for sub_split in split.sub_splits:
                        sub_split_detail_line = self.__get_split_detail_line(sub_split,
                                                                             keys_showing_ordered,
                                                                             self.SUB_SPLIT_DETAIL_STYLE)
                        print(sub_split_detail_line)

                    print(f'{self.SUB_SPLIT_DETAIL_STYLE}{"─" * dash_count}{Style.RESET_ALL}')

                text_color = self.SPLIT_DETAIL_CLR_ODD
                if self.zebra_split_color:
                    text_color = self.SPLIT_DETAIL_CLR_ODD if j % 2 else self.SPLIT_DETAIL_CLR_EVEN
                split_detail_line = self.__get_split_detail_line(split, keys_showing_ordered, text_color)
                print(split_detail_line)

            print(f'{self.GRID_SPACER_CLR}{"─" * dash_count}{Style.RESET_ALL}')


            segment_footer = self.__get_segment_footer_line(segment_detail, keys_showing_ordered)
            print(segment_footer)
            print()

            if include_rolling_summary:
                segment_summary_line = self.__get_segment_rolling_summary(i)
                print(segment_summary_line)
            print()

        course_summary_line = self.__get_course_summary_line()
        print(course_summary_line)

    @property
    def __exposed_fields(self) -> list[str]:
        if self.keys_to_rename is None:
            self.keys_to_rename = {}

        if self.keys_to_exclude is None:
            self.keys_to_exclude = set()

        field_keys_showing = [key for key in self.FIELD_PROPS.keys() if key not in self.keys_to_exclude]

        return field_keys_showing

    def __get_header_line(self, keys_showing_ordered: list[str]) -> str:
        res = []
        for _k in keys_showing_ordered:
            header_override = self.keys_to_rename.get(_k, None)
            res.append(self.FIELD_PROPS[_k].formatted_header(header_override))

        return f'{self.SEGMENT_HEADER_CLR}{self.join_columns(res, self.SEGMENT_HEADER_CLR, spacer=self.HEADER_SPACER)}'

    def __get_split_detail_line(self,
                                split: SplitDetail | SubSplitDetail,
                                keys_showing_ordered: list[str],
                                text_color: str) -> str:
        res: list[str] = []
        for _k in keys_showing_ordered:
            if hasattr(split, _k):
                _v = self.FIELD_PROPS[_k].formatted_value(split.__getattribute__(_k))
            # rest stop fields are within an object that is only part of SplitDetail
            elif isinstance(split, SplitDetail) and split.rest_stop is not None:
                if _k == REST_STOP_HOURS:
                    value = split.rest_stop.open_hours.open_hours[split.end_time.weekday()]
                else:
                    value = split.rest_stop.__getattribute__(_k)
                _v = self.FIELD_PROPS[_k].formatted_value(value)
            else:
                _v = self.FIELD_PROPS[_k].formatted_value()
            res.append(_v)

        return self.join_columns(res, text_color)

    def join_columns(self, columns: list[str], text_style: str = Fore.WHITE, spacer: str | None = None) -> str:
        if spacer is None:
            spacer = self.GRID_SPACER
        res = [f'{text_style}{s}{Style.RESET_ALL}' for s in columns]
        return f"{self.GRID_SPACER_CLR}{spacer}{Style.RESET_ALL}".join(res)

    def __compute_dash_count(self, field_keys_showing: list[str]) -> int:
        spacers_spacing = len(self.GRID_SPACER) * (len(field_keys_showing) - 1)
        base_headers = sum(self.FIELD_PROPS[_k].width for _k in self.FIELD_PROPS if _k in field_keys_showing)
        return base_headers + spacers_spacing

    def __get_segment_footer_line(self, segment_detail: SegmentDetail, keys_showing_ordered: list[str]) -> str:
        res: list[str] = []
        for _k in keys_showing_ordered:
            if hasattr(segment_detail, _k):
                _v = self.FIELD_PROPS[_k].formatted_value(segment_detail.__getattribute__(_k))
            else:
                _v = self.FIELD_PROPS[_k].formatted_value()
            res.append(_v)

        return self.join_columns(res, self.SEGMENT_FOOTER_CLR)

    def __get_segment_rolling_summary(self, segment_index: int) -> str:
        def get_rolling_summary_line() -> str:
            key_width = '<14s'
            ratio_width = '13s'
            val_decimal_format = '>8.2%'
            raw_ratio_format = '>5.2f'

            def __compute_rolling_summary_tuple(_key: str, numerator: float, denominator: float) -> tuple[str, str, str]:
                val = f'{numerator / denominator:{val_decimal_format}}'
                raw = f'{numerator:{raw_ratio_format}} / {denominator:{raw_ratio_format}}'
                return _key, val, raw

            segment_details = self.course_details.segment_details[segment_index]
            segment_rolling_details = get_rolling_segment_details(self.course_details, segment_index)

            details: list[tuple[str, str, str]] = [
                ('Segment Time', '', f'{segment_details.elapsed_time_hours:{raw_ratio_format}} hours'),
                ('Active Time', '', f'{segment_details.active_time_hours:{raw_ratio_format}} hours'),
                ('Start - End', '', f'{segment_details.start_time:{self.DATE_FORMAT}} - {segment_details.end_time:{self.DATE_FORMAT}}'),
                ('', '', f'{segment_rolling_details.start_time:{self.DATE_FORMAT}} - {segment_rolling_details.end_time:{self.DATE_FORMAT}}'),
                ('Distance', '', f'{segment_details.distance:{raw_ratio_format}} ({segment_details.distance / (segment_details.elapsed_time_hours / 24):.2f}/day)'),
                ('', '', f'{segment_rolling_details.distance:{raw_ratio_format}} ({segment_rolling_details.distance / (segment_rolling_details.elapsed_time_hours / 24):.2f}/day)'),
                ('Adj. Time', '', f'{segment_details.adjustment_time_hours:{raw_ratio_format}} hours'),
                ('', '', f'{segment_rolling_details.adjustment_time_hours:{raw_ratio_format}} hours'),
                ('Sleep Time', '', f'{segment_details.sleep_time_hours:{raw_ratio_format}} hours'),
                ('', '', f'{segment_rolling_details.sleep_time_hours:{raw_ratio_format}} hours'),
                ('Elapsed Time', '', f'{segment_details.elapsed_time_hours:{raw_ratio_format}} hours'),
                ('', '', f'{segment_rolling_details.elapsed_time_hours:{raw_ratio_format}} hours'),
                # extended ratio section
                ('Adj.', '', ''),
                __compute_rolling_summary_tuple('   /Active',
                                                segment_details.adjustment_time_hours,
                                                segment_details.active_time_hours),
                __compute_rolling_summary_tuple('   /Segment',
                                                segment_details.adjustment_time_hours,
                                                segment_details.elapsed_time_hours),
                __compute_rolling_summary_tuple('',
                                                segment_rolling_details.adjustment_time_hours,
                                                segment_rolling_details.elapsed_time_hours),
                ('Down', '', ''),
                __compute_rolling_summary_tuple('   /Active',
                                                segment_details.down_time_hours,
                                                segment_details.active_time_hours),
                __compute_rolling_summary_tuple('   /Segment',
                                                segment_details.down_time_hours,
                                                segment_details.elapsed_time_hours),
                __compute_rolling_summary_tuple('',
                                                segment_rolling_details.down_time_hours,
                                                segment_rolling_details.elapsed_time_hours),
                ('Moving', '', ''),
                __compute_rolling_summary_tuple('   /Active',
                                                segment_details.moving_time_hours,
                                                segment_details.active_time_hours),
                __compute_rolling_summary_tuple('   /Segment',
                                                segment_details.moving_time_hours,
                                                segment_details.elapsed_time_hours),
                __compute_rolling_summary_tuple('',
                                                segment_rolling_details.moving_time_hours,
                                                segment_rolling_details.elapsed_time_hours),
                ('Sleep', '', ''),
                __compute_rolling_summary_tuple('   /Active',
                                                segment_details.sleep_time_hours,
                                                segment_details.active_time_hours),
                __compute_rolling_summary_tuple('   /Segment',
                                                segment_details.sleep_time_hours,
                                                segment_details.elapsed_time_hours),
                __compute_rolling_summary_tuple('',
                                                segment_rolling_details.sleep_time_hours,
                                                segment_rolling_details.elapsed_time_hours),
                __compute_rolling_summary_tuple('Down/Moving',
                                                segment_details.down_time_hours,
                                                segment_details.moving_time_hours),
                __compute_rolling_summary_tuple('',
                                                segment_rolling_details.down_time_hours,
                                                segment_rolling_details.moving_time_hours),
                __compute_rolling_summary_tuple('Move Ratio',
                                                segment_details.moving_time_hours,
                                                segment_details.elapsed_time_hours),
                __compute_rolling_summary_tuple('',
                                                segment_rolling_details.moving_time_hours,
                                                segment_rolling_details.elapsed_time_hours),
            ]

            _res: list[str] = []
            for (key, percent, ratio) in details:
                _res.append(f"{key:{key_width}}: {ratio:{ratio_width}} {f'({percent:>10s})' if percent else ''}")
            return '\n'.join(_res)

        return f'{self.SEGMENT_SUMMARY_CLR}{get_rolling_summary_line()}{Style.RESET_ALL}'

    def __get_course_summary_line(self) -> str:
        def get_summary_line(detail: PrinterDetailLine) -> str:
            key_width = '<14s'
            ratio_width = '13s'
            val_decimal_format = '>8.2%'
            raw_ratio_format = '>5.2f'

            def __compute_summary_tuple(_key: str, numerator: float, denominator: float) -> tuple[str, str, str]:
                val = f'{numerator / denominator:{val_decimal_format}}'
                raw = f'{numerator:{raw_ratio_format}} / {denominator:{raw_ratio_format}}'
                return _key, val, raw

            details: list[tuple[str, str, str]] = [
                ('Start - End', '', f'{detail.start_time:{self.DATE_FORMAT}} - {detail.end_time:{self.DATE_FORMAT}}'),
                ('Distance', '', f'{detail.distance:{raw_ratio_format}} ({detail.distance / (detail.elapsed_time_hours / 24):.2f}/day)'),
                ('Adj. Time', '', f'{detail.adjustment_time_hours:{raw_ratio_format}} hours'),
                ('Sleep Time', '', f'{detail.sleep_time_hours:{raw_ratio_format}} hours'),
                ('Elapsed Time', '', f'{detail.elapsed_time_hours:{raw_ratio_format}} hours'),
                __compute_summary_tuple('Adj./Elapsed',
                                        detail.adjustment_time_hours,
                                        detail.elapsed_time_hours),
                __compute_summary_tuple('Down/Elapsed',
                                        detail.down_time_hours,
                                        detail.elapsed_time_hours),
                __compute_summary_tuple('Moving/Elapsed',
                                        detail.moving_time_hours,
                                        detail.elapsed_time_hours),
                __compute_summary_tuple('Sleep/Elapsed',
                                        detail.sleep_time_hours,
                                        detail.elapsed_time_hours),
                __compute_summary_tuple('Down/Moving',
                                        detail.down_time_hours,
                                        detail.moving_time_hours),
                __compute_summary_tuple('Move Ratio',
                                        detail.moving_time_hours,
                                        detail.elapsed_time_hours),
            ]

            _res: list[str] = []
            for (key, percent, ratio) in details:
                _res.append(f"{key:{key_width}}: {ratio:{ratio_width}} {f'({percent:>10s})' if percent else ''}")

            return '\n'.join(_res)

        res = get_summary_line(to_printer_detail_line(self.course_details))

        return f'{self.COURSE_SUMMARY_CLR}{res}{Style.RESET_ALL}'
