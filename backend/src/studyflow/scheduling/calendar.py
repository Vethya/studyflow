"""Expand local recurring availability into exact UTC scheduler windows.

Local wall times in a DST gap are shifted forward by the gap to the first valid
wall time.  Ambiguous wall times use the earlier occurrence for interval starts
and the later occurrence for interval ends, so a repeated hour is not silently
excluded.  These rules make recurring availability deterministic while keeping
concrete windows in real elapsed UTC time.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta, tzinfo
from zoneinfo import ZoneInfo

from studyflow.availability.unavailable import UnavailablePeriod, UnavailablePeriodDraft
from studyflow.availability.windows import AvailabilityWindow, AvailabilityWindowDraft
from studyflow.scheduling.contracts import MinuteWindow, PlanningDay
from studyflow.timezones import is_iana_timezone

_UTC_EPOCH = datetime(1970, 1, 1, tzinfo=UTC)
_MICROSECONDS_PER_MINUTE = 60_000_000

AvailabilityInput = AvailabilityWindow | AvailabilityWindowDraft
UnavailableInput = UnavailablePeriod | UnavailablePeriodDraft


@dataclass(frozen=True, slots=True)
class ExpandedCalendar:
    """Concrete availability and local-day boundaries for solver input."""

    windows: tuple[MinuteWindow, ...]
    planning_days: tuple[PlanningDay, ...]


def _minute_bounds(value: datetime) -> tuple[int, int]:
    delta = value - _UTC_EPOCH
    microseconds = delta.days * 86_400 * 1_000_000 + delta.seconds * 1_000_000 + delta.microseconds
    floor, remainder = divmod(microseconds, _MICROSECONDS_PER_MINUTE)
    return floor, floor + bool(remainder)


def _require_aware(value: datetime, name: str) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{name} must be timezone-aware")
    return value.astimezone(UTC)


def _valid_local_candidates(value: datetime, zone: tzinfo) -> tuple[datetime, ...]:
    candidates: list[datetime] = []
    for fold in (0, 1):
        candidate = value.replace(tzinfo=zone, fold=fold)
        if candidate.astimezone(UTC).astimezone(zone).replace(tzinfo=None) == value and not any(
            candidate.astimezone(UTC) == existing.astimezone(UTC) for existing in candidates
        ):
            candidates.append(candidate)
    return tuple(candidates)


def _resolve_local(value: datetime, zone: tzinfo, *, is_end: bool = False) -> datetime:
    candidates = _valid_local_candidates(value, zone)
    if len(candidates) == 2:
        return candidates[-1 if is_end else 0]
    if len(candidates) == 1:
        return candidates[0]

    early = value.replace(tzinfo=zone, fold=0)
    late = value.replace(tzinfo=zone, fold=1)
    early_offset = early.utcoffset()
    late_offset = late.utcoffset()
    if early_offset is None or late_offset is None:
        raise ValueError("Could not resolve local wall time")
    gap = late_offset - early_offset
    if gap <= timedelta(0):
        raise ValueError("Could not resolve local wall time")
    shifted = value + gap
    shifted_candidates = _valid_local_candidates(shifted, zone)
    if not shifted_candidates:
        raise ValueError("Could not resolve local wall time after a DST gap")
    return shifted_candidates[-1 if is_end else 0]


def _local_interval(
    local_date: date,
    start_time: time,
    end_time: time,
    crosses_midnight: bool,
    zone: tzinfo,
) -> tuple[datetime, datetime]:
    start_naive = datetime.combine(local_date, start_time)
    end_date = local_date + timedelta(days=1) if crosses_midnight else local_date
    end_naive = datetime.combine(end_date, end_time)
    start = _resolve_local(start_naive, zone)
    end = _resolve_local(end_naive, zone, is_end=True)
    if end <= start:
        raise ValueError("Availability window must have positive duration")
    return start.astimezone(UTC), end.astimezone(UTC)


def _window_fields(window: AvailabilityInput) -> tuple[int, time, time, bool]:
    weekday = window.weekday
    start_time = window.start_time
    end_time = window.end_time
    if not 0 <= weekday <= 6:
        raise ValueError("Weekday must be between 0 and 6")
    if any(
        value.second or value.microsecond or value.tzinfo is not None
        for value in (start_time, end_time)
    ):
        raise ValueError("Availability times must be local minute values")
    crosses_midnight = getattr(window, "crosses_midnight", end_time <= start_time)
    if end_time <= start_time:
        crosses_midnight = True
    return weekday, start_time, end_time, crosses_midnight


def _period_bounds(period: UnavailableInput) -> tuple[datetime, datetime]:
    starts_at = _require_aware(period.starts_at, "Unavailable period starts_at")
    ends_at = _require_aware(period.ends_at, "Unavailable period ends_at")
    if ends_at <= starts_at:
        raise ValueError("Unavailable period ends_at must be after starts_at")
    return starts_at, ends_at


def _merge_intervals(intervals: Sequence[tuple[int, int]]) -> list[tuple[int, int]]:
    merged: list[list[int]] = []
    for start, end in sorted(intervals):
        if end <= start:
            continue
        if merged and start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return [(start, end) for start, end in merged]


def _subtract(
    available: Sequence[tuple[int, int]], blocked: Sequence[tuple[int, int]]
) -> list[tuple[int, int]]:
    remaining = list(available)
    for blocked_start, blocked_end in blocked:
        fragments: list[tuple[int, int]] = []
        for available_start, available_end in remaining:
            if blocked_end <= available_start or blocked_start >= available_end:
                fragments.append((available_start, available_end))
                continue
            if available_start < blocked_start:
                fragments.append((available_start, blocked_start))
            if blocked_end < available_end:
                fragments.append((blocked_end, available_end))
        remaining = fragments
    return remaining


def expand_calendar(
    availability_windows: Sequence[AvailabilityInput],
    unavailable_periods: Sequence[UnavailableInput],
    *,
    timezone_name: str,
    planning_start: datetime,
    horizon_end: datetime,
) -> ExpandedCalendar:
    """Expand weekly local rules through ``horizon_end`` into UTC minute ranges."""

    if not isinstance(timezone_name, str) or not is_iana_timezone(timezone_name):
        raise ValueError("timezone_name must be a valid IANA timezone")
    planning_start_utc = _require_aware(planning_start, "planning_start")
    horizon_end_utc = _require_aware(horizon_end, "horizon_end")
    if horizon_end_utc <= planning_start_utc:
        raise ValueError("horizon_end must be after planning_start")
    zone = ZoneInfo(timezone_name)
    planning_start_minute = _minute_bounds(planning_start_utc)[1]
    horizon_end_minute = _minute_bounds(horizon_end_utc)[0]

    local_start = planning_start_utc.astimezone(zone).date()
    local_end = horizon_end_utc.astimezone(zone).date()
    first_rule_date = local_start - timedelta(days=1)
    available_intervals: list[tuple[int, int]] = []
    for offset in range((local_end - first_rule_date).days + 1):
        rule_date = first_rule_date + timedelta(days=offset)
        for window in availability_windows:
            weekday, start_time, end_time, crosses_midnight = _window_fields(window)
            if rule_date.weekday() != weekday:
                continue
            start, end = _local_interval(rule_date, start_time, end_time, crosses_midnight, zone)
            _, start_ceil = _minute_bounds(start)
            _, end_floor = _minute_bounds(end)
            clipped_start = max(start_ceil, planning_start_minute)
            clipped_end = min(end_floor, horizon_end_minute)
            if clipped_start < clipped_end:
                available_intervals.append((clipped_start, clipped_end))

    blocked_intervals: list[tuple[int, int]] = []
    for period in unavailable_periods:
        starts_at, ends_at = _period_bounds(period)
        starts_at_floor, _ = _minute_bounds(starts_at)
        _, ends_at_ceil = _minute_bounds(ends_at)
        clipped_start = max(starts_at_floor, planning_start_minute)
        clipped_end = min(ends_at_ceil, horizon_end_minute)
        if clipped_start < clipped_end:
            blocked_intervals.append((clipped_start, clipped_end))

    available = _merge_intervals(available_intervals)
    blocked = _merge_intervals(blocked_intervals)
    windows = tuple(MinuteWindow(start, end) for start, end in _subtract(available, blocked))

    # Resolve each local midnight once.  A midnight transition can be
    # ambiguous, and resolving the same wall time with start/end fold policies
    # independently would make adjacent planning days overlap.
    local_midnights = {
        local_start + timedelta(days=day_offset): _resolve_local(
            datetime.combine(local_start + timedelta(days=day_offset), time()), zone
        )
        for day_offset in range((local_end - local_start).days + 2)
    }
    planning_days: list[PlanningDay] = []
    for day_offset in range((local_end - local_start).days + 1):
        local_date = local_start + timedelta(days=day_offset)
        day_start = local_midnights[local_date]
        day_end = local_midnights[local_date + timedelta(days=1)]
        day_start_minute = max(_minute_bounds(day_start.astimezone(UTC))[1], planning_start_minute)
        day_end_minute = min(_minute_bounds(day_end.astimezone(UTC))[0], horizon_end_minute)
        if day_start_minute < day_end_minute:
            planning_days.append(PlanningDay(len(planning_days), day_start_minute, day_end_minute))

    return ExpandedCalendar(windows, tuple(planning_days))


expand_availability = expand_calendar
