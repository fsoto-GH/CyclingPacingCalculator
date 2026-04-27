from dataclasses import dataclass
from datetime import timedelta
from typing import Optional

from pydantic import BaseModel

from pacing.api.routes.calculator.dto.split import Split


@dataclass
class Segment(BaseModel):
    splits: list[Split]
    down_time_ratio: float | None = None
    split_delta: float | None = None
    moving_speed: float | None = None
    min_moving_speed: float | None = None
    sleep_time: timedelta = timedelta(hours=0)
    no_end_down_time: bool = True
    name: str | None = None
    nullified: bool = False
    fixed_elapsed_time_seconds: Optional[int] = None
