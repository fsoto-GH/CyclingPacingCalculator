from dataclasses import dataclass
from datetime import datetime
from typing import Annotated, Any

from pydantic import Field

from pacing.calculator.dtos.open_hours import OpenHours


@dataclass
class RestStop:
    name: str
    open_hours: Annotated[Any, Field(exclude=True)]
    address: str
    alt: str | None = None
    arrival_date: datetime | None = None

    @property
    def hours(self):
        return self.open_hours.open_hours

    