"""Portable IANA timezone validation."""

from functools import lru_cache
from zoneinfo import available_timezones


@lru_cache(maxsize=1)
def iana_timezones() -> frozenset[str]:
    return frozenset(available_timezones())


def is_iana_timezone(value: str) -> bool:
    return value in iana_timezones()
