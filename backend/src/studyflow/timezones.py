"""Portable IANA timezone validation and conversion."""

from datetime import UTC, datetime, tzinfo
from functools import lru_cache
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError, available_timezones


@lru_cache(maxsize=1)
def iana_timezones() -> frozenset[str]:
    return frozenset(available_timezones())


def is_iana_timezone(value: str) -> bool:
    return value in iana_timezones()


def _zone(timezone: str) -> tzinfo:
    try:
        return ZoneInfo(timezone)
    except (ZoneInfoNotFoundError, ValueError):
        return UTC


def to_local_time(value: datetime, timezone: str) -> datetime:
    """Convert an instant to the account timezone; naive values are treated as UTC."""
    aware = value if value.tzinfo is not None else value.replace(tzinfo=UTC)
    return aware.astimezone(_zone(timezone))
