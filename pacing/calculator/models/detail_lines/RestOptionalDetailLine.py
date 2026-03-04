from Cycling.pacing.shared.CONSTANTS import REST_OPT
from Cycling.pacing.calculator.models.detail_lines import RestDetailLine


class RestOptionalDetailLine(RestDetailLine):
    def __init__(self,
                 mile_mark: float,
                 distance: float,
                 name: str,
                 hours: str,
                 eta: str):
        super().__init__(mile_mark, distance, name, hours, eta)
        self.legend_key = REST_OPT

