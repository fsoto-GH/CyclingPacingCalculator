from dataclasses import dataclass
from datetime import timedelta
from typing import Literal

from pydantic import BaseModel

from pacing.api.routes.calculator.dto.rest_stop import RestStop


@dataclass
class Split(BaseModel):
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
    name: str | None = None
