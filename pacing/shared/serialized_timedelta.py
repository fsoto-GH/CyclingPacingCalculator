from datetime import timedelta
from typing import Annotated

from pydantic import PlainSerializer

from shared.utils import hours_to_pretty


def serialize_timedelta(delta: timedelta):
    """
    Serializes a timedelta to a human-readable format, e.g. "[a]d [b]h [c]m [d]s".
    This is used for the JSON serialization of the timedelta fields when they are not None.
    """
    return hours_to_pretty(delta).strip()


serialized_timedelta = Annotated[timedelta, PlainSerializer(serialize_timedelta, when_used='json-unless-none')]
