from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal


DISTANCE = 'distance'
TARGET_DISTANCE = 'target_distance'


@dataclass
class RestStop:
    name: str
    open_hours: dict[Literal['0', '1', '2', '3', '4', '5', '6', 'Fixed'], str]
    address: str
    alt: str | None = None
    arrival_date: datetime | None = None


@dataclass
class Split:
    distance: float
    sub_split_mode: Literal['even', 'fixed', 'custom']
    sub_split_count: int | None = None
    sub_split_distance: float | None = None
    last_sub_split_threshold: float | None = None
    sub_split_distances: list[float] | None = None
    rest_stop: RestStop | None = None
    down_time: timedelta | None = None
    moving_speed: float | None = None
    adjustment_time: timedelta = timedelta(hours=0)


@dataclass
class Segment:
    splits: list[Split]
    down_time_ratio: float | None = None
    split_decay: float | None = None
    moving_speed: float | None = None
    min_moving_speed: float | None = None
    sleep_time: timedelta = timedelta(hours=0)
    no_end_down_time: bool = True


@dataclass
class Course:
    segments: list[Segment]
    mode: Literal['distance', 'target_distance']
    init_moving_speed: float
    min_moving_speed: float
    down_time_ratio: float = 0
    split_decay: float = 0
    start_time: datetime = datetime.today()

