from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from pydantic import BaseModel


@dataclass
class RestStop(BaseModel):
    name: str
    open_hours: dict[Literal['0', '1', '2', '3', '4', '5', '6', 'Fixed'], str]
    address: str
    alt: str | None = None
    arrival_date: datetime | None = None