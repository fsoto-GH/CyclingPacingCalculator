from dataclasses import dataclass

from Cycling.pacing.shared.CONSTANTS import MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY, SATURDAY, SUNDAY


@dataclass
class OpenHours:
    @property
    def open_hours(self):
        raise NotImplementedError('Subclasses must implement open_hours property')


@dataclass
class WeeklyOpenHours(OpenHours):
    """
    Represents the open hours for each day of the week.
    Each day can have its own hours, or be None if closed that day.
    """
    mon: str | None = None
    tue: str | None = None
    wed: str | None = None
    thu: str | None = None
    fri: str | None = None
    sat: str | None = None
    sun: str | None = None

    @property
    def open_hours(self):
        ordered_days = [self.mon, self.tue, self.wed, self.thu, self.fri, self.sat, self.sun]
        res = {}
        for i, hours in enumerate(ordered_days):
            if hours is not None:
                res[i] = hours

        return res


class FixedOpenHours(OpenHours):
    """
    Represents a set of hours that does not change per day.
    Example can be a store that is open 24hrs every day.
    """
    def __init__(self, hours):
        self.hours = hours

    @property
    def open_hours(self):
        return {
            MONDAY: self.hours,
            TUESDAY: self.hours,
            WEDNESDAY: self.hours,
            THURSDAY: self.hours,
            FRIDAY: self.hours,
            SATURDAY: self.hours,
            SUNDAY: self.hours,
        }
