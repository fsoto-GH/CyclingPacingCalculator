from datetime import timedelta

from cue_sheet.DetailLines import KOM_TRY
from calculator.models.detail_lines import KOMDetailLine


class KOMOptionalDetailLine(KOMDetailLine):
    def __init__(self,
                 mile_mark: float,
                 distance: float,
                 name: str,
                 speed: float,
                 avg_grade: float,
                 orientation: str,
                 kom_time: timedelta):
        super().__init__(mile_mark, distance, name, speed, avg_grade, orientation, kom_time)
        self.legend_key = KOM_TRY
