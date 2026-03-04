from Cycling.pacing.shared.CONSTANTS import REST
from Cycling.pacing.calculator.models.detail_lines import DetailLine


class RestDetailLine(DetailLine):
    def __init__(self,
                 mile_mark: float,
                 distance: float,
                 name: str,
                 hours: str,
                 eta: str):
        super().__init__(REST, mile_mark, distance, name)
        self.hours = hours
        self.eta = eta

    def __str__(self):
        return f"{super().__str__()}\n" \
               f"{'':6s}{self.hours} (ETA: {self.eta})"
