"""Expand local recurring availability into exact UTC scheduler windows.

Local wall times in a DST gap are shifted forward by the gap to the first valid
wall time.  Ambiguous wall times use the earlier occurrence for interval starts
and the later occurrence for interval ends, so a repeated hour is not silently
excluded.  These rules make recurring availability deterministic while keeping
concrete windows in real elapsed UTC time.
"""

from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta, tzinfo
from heapq import heappop, heappush
from typing import overload
from zoneinfo import ZoneInfo

from studyflow.availability.unavailable import UnavailablePeriod, UnavailablePeriodDraft
from studyflow.availability.windows import AvailabilityWindow, AvailabilityWindowDraft
from studyflow.scheduling.contracts import MinuteWindow, PlanningDay
from studyflow.timezones import is_iana_timezone

_UTC_EPOCH = datetime(1970, 1, 1, tzinfo=UTC)
_MICROSECONDS_PER_MINUTE = 60_000_000
_MINUTES_PER_DAY = 1_440
_MINUTES_PER_WEEK = 10_080
_MONDAY_EPOCH_MINUTE = 4 * _MINUTES_PER_DAY

AvailabilityInput = AvailabilityWindow | AvailabilityWindowDraft
UnavailableInput = UnavailablePeriod | UnavailablePeriodDraft
NormalizedRule = tuple[int, time, time, bool]


def _ceil_div(numerator: int, denominator: int) -> int:
    return -((-numerator) // denominator)


def _run_contains(run: "_UtcRun", minute: int) -> bool:
    offset = (minute - _MONDAY_EPOCH_MINUTE) % _MINUTES_PER_WEEK
    if run.end_offset <= _MINUTES_PER_WEEK:
        return run.start_offset < offset < run.end_offset
    return offset > run.start_offset or offset < run.end_offset - _MINUTES_PER_WEEK


@dataclass(frozen=True, slots=True)
class _UtcRun:
    start_offset: int
    end_offset: int


@dataclass(frozen=True, slots=True, eq=False)
class CalendarWindows(Sequence[MinuteWindow]):
    """Lazy immutable concrete windows.

    UTC calendars use a compact weekly representation, so counts and either
    boundary stay constant-memory even when the horizon reaches ``date.max``.
    Other zones retain lazy day-by-day expansion because DST changes the UTC
    duration of individual occurrences.
    """

    rules: tuple[NormalizedRule, ...]
    blocked: tuple[tuple[int, int], ...]
    timezone_name: str
    planning_start_minute: int
    horizon_end_minute: int
    first_rule_date: date
    last_rule_date: date

    @property
    def window_count(self) -> int:
        if self.timezone_name == "UTC":
            return self._utc_count()
        return sum(1 for _ in self)

    def __len__(self) -> int:
        return self.window_count

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, Sequence):
            return False
        return len(self) == len(other) and all(
            left == right for left, right in zip(self, other, strict=True)
        )

    @overload
    def __getitem__(self, index: int) -> MinuteWindow: ...

    @overload
    def __getitem__(self, index: slice) -> tuple[MinuteWindow, ...]: ...

    def __getitem__(self, index: int | slice) -> MinuteWindow | tuple[MinuteWindow, ...]:
        if isinstance(index, slice):
            return tuple(self)[index]
        if not isinstance(index, int):
            raise TypeError("window index must be an integer or slice")
        count = self.window_count
        normalized = index if index >= 0 else count + index
        if not 0 <= normalized < count:
            raise IndexError("calendar window index out of range")
        if self.timezone_name == "UTC" and normalized == 0:
            return self._utc_boundary(first=True)
        if self.timezone_name == "UTC" and normalized == count - 1:
            return self._utc_boundary(first=False)
        for item_index, window in enumerate(self):
            if item_index == normalized:
                return window
        raise IndexError("calendar window index out of range")

    def __iter__(self) -> Iterator[MinuteWindow]:
        if self.timezone_name == "UTC":
            return self._iter_utc()
        return self._iter_zoned()

    def materialize(self) -> tuple[MinuteWindow, ...]:
        """Return ordinary solver windows after the caller checks ``len``."""

        return tuple(self)

    def _utc_runs(self) -> tuple[_UtcRun, ...]:
        occupied = [False] * _MINUTES_PER_WEEK
        for weekday, start_time, end_time, crosses_midnight in self.rules:
            start = weekday * _MINUTES_PER_DAY + start_time.hour * 60 + start_time.minute
            end = weekday * _MINUTES_PER_DAY + end_time.hour * 60 + end_time.minute
            if crosses_midnight:
                end += _MINUTES_PER_DAY
            for minute in range(start, end):
                occupied[minute % _MINUTES_PER_WEEK] = True
        if not any(occupied):
            return ()
        if all(occupied):
            return (_UtcRun(0, _MINUTES_PER_WEEK),)
        runs: list[_UtcRun] = []
        for minute, is_occupied in enumerate(occupied):
            if not is_occupied or occupied[(minute - 1) % _MINUTES_PER_WEEK]:
                continue
            end = minute + 1
            while occupied[end % _MINUTES_PER_WEEK]:
                end += 1
            runs.append(_UtcRun(minute, end))
        return tuple(runs)

    def _run_k_bounds(self, run: _UtcRun) -> tuple[int, int]:
        base_start = _MONDAY_EPOCH_MINUTE + run.start_offset
        base_end = _MONDAY_EPOCH_MINUTE + run.end_offset
        first = (self.planning_start_minute - base_end) // _MINUTES_PER_WEEK + 1
        stop = (self.horizon_end_minute - base_start + _MINUTES_PER_WEEK - 1) // _MINUTES_PER_WEEK
        return first, max(first, stop)

    def _utc_count(self) -> int:
        count = 0
        runs = self._utc_runs()
        if runs and runs[0].end_offset - runs[0].start_offset == _MINUTES_PER_WEEK:
            return len(
                _subtract(
                    ((self.planning_start_minute, self.horizon_end_minute),),
                    self.blocked,
                )
            )
        for run in runs:
            first, stop = self._run_k_bounds(run)
            count += stop - first
            base_start = _MONDAY_EPOCH_MINUTE + run.start_offset
            for blocked_start, blocked_end in self.blocked:
                low = max(first, _ceil_div(blocked_start - base_start, _MINUTES_PER_WEEK))
                high = min(stop, _ceil_div(blocked_end - base_start, _MINUTES_PER_WEEK))
                count -= max(0, high - low)
                first_start = base_start + first * _MINUTES_PER_WEEK
                if first_start < self.planning_start_minute:
                    count += int(blocked_start <= first_start < blocked_end)
                    count -= int(blocked_start <= self.planning_start_minute < blocked_end)
        for _, blocked_end in self.blocked:
            if not self.planning_start_minute < blocked_end < self.horizon_end_minute:
                continue
            if any(_run_contains(run, blocked_end) for run in runs):
                count += 1
        return count

    def _iter_utc_run(self, run: _UtcRun) -> Iterator[MinuteWindow]:
        base_start = _MONDAY_EPOCH_MINUTE + run.start_offset
        base_end = _MONDAY_EPOCH_MINUTE + run.end_offset
        occurrence, stop = self._run_k_bounds(run)
        blocked_index = 0
        while occurrence < stop:
            start = max(base_start + occurrence * _MINUTES_PER_WEEK, self.planning_start_minute)
            end = min(base_end + occurrence * _MINUTES_PER_WEEK, self.horizon_end_minute)
            while blocked_index < len(self.blocked) and self.blocked[blocked_index][1] <= start:
                blocked_index += 1
            fragments = [(start, end)]
            scan = blocked_index
            covering_end: int | None = None
            while scan < len(self.blocked) and self.blocked[scan][0] < end:
                block = self.blocked[scan]
                fragments = _subtract(fragments, (block,))
                if block[0] <= start and block[1] >= end:
                    covering_end = block[1]
                scan += 1
            for fragment_start, fragment_end in fragments:
                yield MinuteWindow(fragment_start, fragment_end)
            if covering_end is None:
                occurrence += 1
            else:
                occurrence = max(
                    occurrence + 1,
                    (covering_end - base_end) // _MINUTES_PER_WEEK + 1,
                )

    def _iter_utc(self) -> Iterator[MinuteWindow]:
        runs = self._utc_runs()
        if runs and runs[0].end_offset - runs[0].start_offset == _MINUTES_PER_WEEK:
            return iter(
                MinuteWindow(*fragment)
                for fragment in _subtract(
                    ((self.planning_start_minute, self.horizon_end_minute),),
                    self.blocked,
                )
            )
        return self._merge_utc_runs(runs)

    def _merge_utc_runs(self, runs: tuple[_UtcRun, ...]) -> Iterator[MinuteWindow]:
        iterators = [iter(self._iter_utc_run(run)) for run in runs]
        pending: list[tuple[MinuteWindow, int]] = []
        for iterator_index, iterator in enumerate(iterators):
            first = next(iterator, None)
            if first is not None:
                heappush(pending, (first, iterator_index))
        while pending:
            window, iterator_index = heappop(pending)
            yield window
            following = next(iterators[iterator_index], None)
            if following is not None:
                heappush(pending, (following, iterator_index))

    def _utc_boundary(self, *, first: bool) -> MinuteWindow:
        runs = self._utc_runs()
        if runs and runs[0].end_offset - runs[0].start_offset == _MINUTES_PER_WEEK:
            fragments = _subtract(
                ((self.planning_start_minute, self.horizon_end_minute),), self.blocked
            )
            if not fragments:
                raise IndexError("calendar window index out of range")
            return MinuteWindow(*fragments[0 if first else -1])
        candidates: list[MinuteWindow] = []
        for run in runs:
            first_occurrence, stop = self._run_k_bounds(run)
            occurrence = first_occurrence if first else stop - 1
            direction = 1 if first else -1
            base_start = _MONDAY_EPOCH_MINUTE + run.start_offset
            base_end = _MONDAY_EPOCH_MINUTE + run.end_offset
            while first_occurrence <= occurrence < stop:
                start = max(base_start + occurrence * _MINUTES_PER_WEEK, self.planning_start_minute)
                end = min(base_end + occurrence * _MINUTES_PER_WEEK, self.horizon_end_minute)
                fragments = _subtract(((start, end),), self.blocked)
                if fragments:
                    fragment = fragments[0 if first else -1]
                    candidates.append(MinuteWindow(*fragment))
                    break
                covering = next(
                    (block for block in self.blocked if block[0] <= start and block[1] >= end),
                    None,
                )
                if covering is None:
                    occurrence += direction
                elif first:
                    occurrence = max(
                        occurrence + 1,
                        (covering[1] - base_end) // _MINUTES_PER_WEEK + 1,
                    )
                else:
                    occurrence = min(
                        occurrence - 1,
                        (covering[0] - base_start - 1) // _MINUTES_PER_WEEK,
                    )
        if not candidates:
            raise IndexError("calendar window index out of range")
        return min(candidates) if first else max(candidates)

    def _iter_zoned(self) -> Iterator[MinuteWindow]:
        zone = ZoneInfo(self.timezone_name)
        rule_date = self.first_rule_date
        merged_start: int | None = None
        merged_end: int | None = None
        while True:
            intervals: list[tuple[int, int]] = []
            for weekday, start_time, end_time, crosses_midnight in self.rules:
                if rule_date.weekday() != weekday:
                    continue
                interval = _local_interval(rule_date, start_time, end_time, crosses_midnight, zone)
                if interval is None:
                    continue
                start, end = interval
                _, start_ceil = _minute_bounds(start)
                _, end_floor = _minute_bounds(end)
                clipped_start = max(start_ceil, self.planning_start_minute)
                clipped_end = min(end_floor, self.horizon_end_minute)
                if clipped_start < clipped_end:
                    intervals.append((clipped_start, clipped_end))
            for concrete_start, concrete_end in _merge_intervals(intervals):
                if merged_end is not None and concrete_start <= merged_end:
                    merged_end = max(merged_end, concrete_end)
                else:
                    if merged_start is not None and merged_end is not None:
                        for fragment in _subtract(((merged_start, merged_end),), self.blocked):
                            yield MinuteWindow(*fragment)
                    merged_start, merged_end = concrete_start, concrete_end
            if rule_date == self.last_rule_date:
                break
            rule_date += timedelta(days=1)
        if merged_start is not None and merged_end is not None:
            for fragment in _subtract(((merged_start, merged_end),), self.blocked):
                yield MinuteWindow(*fragment)


@dataclass(frozen=True, slots=True, eq=False)
class PlanningDays(Sequence[PlanningDay]):
    """Lazy account-local day boundaries for a planning horizon."""

    timezone_name: str
    local_start: date
    local_end: date
    planning_start_minute: int
    horizon_end_minute: int

    @property
    def day_count(self) -> int:
        return (self.local_end - self.local_start).days + 1

    def __len__(self) -> int:
        return self.day_count

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, Sequence):
            return False
        return len(self) == len(other) and all(
            left == right for left, right in zip(self, other, strict=True)
        )

    @overload
    def __getitem__(self, index: int) -> PlanningDay: ...

    @overload
    def __getitem__(self, index: slice) -> tuple[PlanningDay, ...]: ...

    def __getitem__(self, index: int | slice) -> PlanningDay | tuple[PlanningDay, ...]:
        if isinstance(index, slice):
            return tuple(self._day_at(item) for item in range(*index.indices(self.day_count)))
        if not isinstance(index, int):
            raise TypeError("planning day index must be an integer or slice")
        normalized = index if index >= 0 else self.day_count + index
        return self._day_at(normalized)

    def __iter__(self) -> Iterator[PlanningDay]:
        return (self._day_at(index) for index in range(self.day_count))

    def materialize(self) -> tuple[PlanningDay, ...]:
        """Return ordinary solver days after the caller checks ``len``."""

        return tuple(self)

    def _day_at(self, index: int) -> PlanningDay:
        if not 0 <= index < self.day_count:
            raise IndexError("planning day index out of range")
        local_date = self.local_start + timedelta(days=index)
        zone = ZoneInfo(self.timezone_name)
        day_start = _resolve_local(datetime.combine(local_date, time()), zone).astimezone(UTC)
        start_minute = max(_minute_bounds(day_start)[1], self.planning_start_minute)
        if local_date == self.local_end:
            end_minute = self.horizon_end_minute
        else:
            next_date = local_date + timedelta(days=1)
            day_end = _resolve_local(datetime.combine(next_date, time()), zone).astimezone(UTC)
            end_minute = min(_minute_bounds(day_end)[0], self.horizon_end_minute)
        return PlanningDay(index, start_minute, end_minute)


@dataclass(frozen=True, slots=True)
class ExpandedCalendar:
    """Lazy availability and local-day boundaries for solver input."""

    windows: CalendarWindows
    planning_days: PlanningDays


def _minute_bounds(value: datetime) -> tuple[int, int]:
    delta = value - _UTC_EPOCH
    microseconds = delta.days * 86_400 * 1_000_000 + delta.seconds * 1_000_000 + delta.microseconds
    floor, remainder = divmod(microseconds, _MICROSECONDS_PER_MINUTE)
    return floor, floor + bool(remainder)


def _require_aware(value: datetime, name: str) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{name} must be timezone-aware")
    return value.astimezone(UTC)


def _local_date_at(value: datetime, zone: tzinfo) -> date:
    try:
        return value.astimezone(zone).date()
    except OverflowError:
        return date.max if value.year == date.max.year else date.min


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
) -> tuple[datetime, datetime] | None:
    start_naive = datetime.combine(local_date, start_time)
    if crosses_midnight and local_date == date.max:
        start = _resolve_local(start_naive, zone)
        return start.astimezone(UTC), datetime.max.replace(tzinfo=UTC)
    end_date = local_date + timedelta(days=1) if crosses_midnight else local_date
    end_naive = datetime.combine(end_date, end_time)
    start = _resolve_local(start_naive, zone)
    end = _resolve_local(end_naive, zone, is_end=True)
    if end <= start:
        # A non-crossing wall interval ending at the first valid instant after
        # a spring-forward gap can collapse completely (for example, 02:00-
        # 03:00 in New York).  It contributes no elapsed UTC time this week;
        # retain errors for all other invalid interval orderings.
        if not crosses_midnight and end_time > start_time:
            return None
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
    wall_crosses_midnight = end_time <= start_time
    persisted_crosses_midnight = getattr(window, "crosses_midnight", None)
    if persisted_crosses_midnight is not None:
        if not isinstance(persisted_crosses_midnight, bool):
            raise ValueError("crosses_midnight must be a boolean")
        if persisted_crosses_midnight != wall_crosses_midnight:
            raise ValueError("crosses_midnight does not match availability wall-time ordering")
    return weekday, start_time, end_time, wall_crosses_midnight


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
    """Prepare lazy weekly-rule expansion through ``horizon_end``."""

    if not isinstance(timezone_name, str) or not is_iana_timezone(timezone_name):
        raise ValueError("timezone_name must be a valid IANA timezone")
    planning_start_utc = _require_aware(planning_start, "planning_start")
    horizon_end_utc = _require_aware(horizon_end, "horizon_end")
    if horizon_end_utc <= planning_start_utc:
        raise ValueError("horizon_end must be after planning_start")
    zone = ZoneInfo(timezone_name)
    planning_start_minute = _minute_bounds(planning_start_utc)[1]
    horizon_end_minute = _minute_bounds(horizon_end_utc)[0]

    local_start = _local_date_at(planning_start_utc, zone)
    local_end = _local_date_at(horizon_end_utc, zone)
    normalized_rules = tuple(sorted(_window_fields(window) for window in availability_windows))

    blocked_intervals: list[tuple[int, int]] = []
    for period in unavailable_periods:
        starts_at, ends_at = _period_bounds(period)
        starts_at_floor, _ = _minute_bounds(starts_at)
        _, ends_at_ceil = _minute_bounds(ends_at)
        clipped_start = max(starts_at_floor, planning_start_minute)
        clipped_end = min(ends_at_ceil, horizon_end_minute)
        if clipped_start < clipped_end:
            blocked_intervals.append((clipped_start, clipped_end))
    blocked = tuple(_merge_intervals(blocked_intervals))
    first_rule_date = local_start if local_start == date.min else local_start - timedelta(days=1)

    effective_local_end = local_end
    local_end_midnight = _resolve_local(datetime.combine(local_end, time()), zone).astimezone(UTC)
    if _minute_bounds(local_end_midnight)[1] >= horizon_end_minute:
        effective_local_end -= timedelta(days=1)

    windows = CalendarWindows(
        normalized_rules,
        blocked,
        timezone_name,
        planning_start_minute,
        horizon_end_minute,
        first_rule_date,
        local_end,
    )
    planning_days = PlanningDays(
        timezone_name,
        local_start,
        effective_local_end,
        planning_start_minute,
        horizon_end_minute,
    )
    return ExpandedCalendar(windows, planning_days)


expand_availability = expand_calendar
