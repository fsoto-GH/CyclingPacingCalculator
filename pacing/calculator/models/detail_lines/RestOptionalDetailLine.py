from shared.CONSTANTS import REST_OPT
from calculator.models.detail_lines import RestDetailLine


class RestOptionalDetailLine(RestDetailLine):
    def __init__(self,
                 mile_mark: float,
                 distance: float,
                 name: str,
                 hours: str,
                 eta: str):
        super().__init__(mile_mark, distance, name, hours, eta)
        self.legend_key = REST_OPT

