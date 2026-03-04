from dataclasses import dataclass
from datetime import datetime

from Cycling.pacing.calculator.dtos.open_hours import OpenHours


@dataclass
class RestStop:
    name: str
    open_hours: OpenHours
    address: str
    alt: str | None = None
    arrival_date: datetime | None = None
    