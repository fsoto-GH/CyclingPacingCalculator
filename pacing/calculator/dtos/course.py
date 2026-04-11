from dataclasses import dataclass
from datetime import datetime

from pacing.calculator.dtos.segment import Segment


@dataclass
class Course:
    mode: str
    segments: list[Segment]
    init_moving_speed: float
    min_moving_speed: float
    down_time_ratio: float = 0
    split_delta: float = 0
    start_time: datetime = datetime.today()
    # you can set course mode to base calculations on DISTANCE purely or distance points by setting to TARGET_DISTANCE
    # # TODO: Implement KOM, this might be a Printer object detail tbh
    # KOMs: list[KOMDetailLine | KOMOptionalDetailLine]
    # # TODO: Implement optional rest stops, this might be a Printer detail tbh
    # optional_rest_stops: list[RestStop] | None = None
