from pacing.shared.CONSTANTS import LEGEND


class DetailLine:
    def __init__(self,
                 legend_key: str,
                 mile_mark: float,
                 distance: float | None,
                 name: str,
                 description: str | None = None):
        self.mile_mark = mile_mark
        self.distance = distance  # this helps display distance between this and previous marker
        self.legend_key = legend_key
        self.name = name
        self.description = description

    def __str__(self):
        base = f"{LEGEND.get(self.legend_key, ' ')} {self.mile_mark:6.1f}mi" \
               f"{(f' ({self.distance}mi):' if self.distance else ':')}\n" \
               f"{'':6s}{self.name}"
        return f"{base}\n{'':6s}{self.description}" if self.description else base
