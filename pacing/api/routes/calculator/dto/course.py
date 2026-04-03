from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from api.routes.calculator.dto.segment import Segment


@dataclass
class Course(BaseModel):
    segments: list[Segment]
    mode: Literal['distance', 'target_distance']
    init_moving_speed: float
    min_moving_speed: float
    down_time_ratio: float = 0
    split_decay: float = 0
    start_time: datetime = datetime.today()

