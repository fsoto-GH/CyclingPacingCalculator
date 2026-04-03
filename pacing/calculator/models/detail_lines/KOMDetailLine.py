from datetime import timedelta

from shared.CONSTANTS import KOM
from calculator.models.detail_lines import DetailLine


class KOMDetailLine(DetailLine):
    def __init__(self,
                 mile_mark: float,
                 distance: float,
                 name: str,
                 speed: float,
                 avg_grade: float,
                 orientation: str,
                 kom_time: timedelta):
        super().__init__(KOM, mile_mark, distance, name)
        self.speed = speed
        self.distance = distance  # this helps display distance of the KOM segment
        self.avg_grade = avg_grade
        self.orientation = orientation
        self.kom_time = kom_time

    def __str__(self):
        return f"{super().__str__()}\n" \
               f"{'':6s}{self.orientation} {self.distance}mi {self.avg_grade:.1f}%\n" \
               f"{'':6s}{self.speed:.1f}mph ({self.kom_time})"