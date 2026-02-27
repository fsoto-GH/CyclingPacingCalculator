# LEGEND KEYS
from datetime import timedelta

KOM = "KOM"
KOM_TRY = "KOM-TRY"
REST = "REST"
REST_OPT = "REST-OPT"
START = "START"
FINISH = "FINISH"
HAZARD = "HAZARD"

LEGEND = {
    KOM: "♚",
    KOM_TRY: "♞",
    REST: "★",
    REST_OPT: "☆",
    START: "🏁",
    FINISH: "🏁",
    HAZARD: "☢"
}

LEGEND_DESCRIPTION = {
    KOM: "Go for KOM!",
    KOM_TRY: "Optional KOM!",
    REST: "Rest Stop",
    REST_OPT: "Optional Rest Stop",
    START: "Start",
    FINISH: "Finish",
}


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


class RestOptionalDetailLine(RestDetailLine):
    def __init__(self,
                 mile_mark: float,
                 distance: float,
                 name: str,
                 hours: str,
                 eta: str):
        super().__init__(mile_mark, distance, name, hours, eta)
        self.legend_key = REST_OPT

