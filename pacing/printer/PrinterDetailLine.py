from dataclasses import dataclass
from datetime import datetime


@dataclass
class PrinterDetailLine:
    start_time: datetime
    end_time: datetime
    adjustment_time_hours: float
    elapsed_time_hours: float
    down_time_hours: float
    moving_time_hours: float
    distance: float
    sleep_time_hours: float
