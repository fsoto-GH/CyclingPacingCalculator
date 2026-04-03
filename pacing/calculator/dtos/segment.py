from dataclasses import dataclass
from datetime import timedelta

from pacing.calculator.dtos.split import Split


@dataclass
class Segment:
    splits: list[Split]
    down_time_ratio: float | None = None
    split_decay: float | None = None
    moving_speed: float | None = None
    min_moving_speed: float | None = None
    sleep_time: timedelta = timedelta(hours=0)
    no_end_down_time: bool = True  # if True, no down_time is added after the last split of the segment
    name: str | None = None
