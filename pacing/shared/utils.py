import math
from datetime import timedelta


def format_field(val: str, formatting: str):
    return f'{val:{formatting}}'


def hours_to_pretty(hours_timedelta: timedelta | float):
    """
    Converts decimal hours to days, hours, minutes, and seconds.
    Leading zeroes can be omitted and last precision can be reduced to minutes.
    The last precision is rounded.

    :param hours_timedelta: the amount to convert
    :return: string representing the day, hour, minute, and second of the decimal hours
    """

    if type(hours_timedelta) == timedelta:
        is_neg = hours_timedelta.total_seconds() < 0
        decimal_hours = hours_timedelta.total_seconds() / 3600
    else:
        is_neg = hours_timedelta < 0
        decimal_hours = hours_timedelta

    if is_neg:
        decimal_hours *= -1
    days = decimal_hours // 24
    hours = decimal_hours % 24
    minutes = (decimal_hours - int(decimal_hours)) * 60
    seconds = (minutes - int(minutes)) * 60

    return f"{'-' if is_neg else ' '}{math.floor(days):2d}d {math.floor(hours):2d}h {math.floor(minutes):2d}m " \
           f"{seconds:5.2f}s"


def span_to_pretty(span: tuple[float, float]):
    start_distance, end_distance = span
    return f"{start_distance:7.2f}, {end_distance:7.2f}"


def to_hours(total_seconds: float):
    return total_seconds / 3600
