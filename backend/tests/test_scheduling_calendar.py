from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, date, datetime, time, timedelta
from uuid import uuid4

import pytest

from studyflow.availability.unavailable import UnavailablePeriodDraft
from studyflow.availability.windows import AvailabilityWindow, AvailabilityWindowDraft
from studyflow.scheduling import FeasibilityProblem, MinuteWindow, PlanningDay
from studyflow.scheduling.calendar import ExpandedCalendar, expand_calendar


def _run(
    windows: Sequence[AvailabilityWindow | AvailabilityWindowDraft],
    start: datetime,
    end: datetime,
    unavailable: list[UnavailablePeriodDraft] | None = None,
    timezone_name: str = "UTC",
) -> ExpandedCalendar:
    return expand_calendar(
        windows,
        unavailable or [],
        timezone_name=timezone_name,
        planning_start=start,
        horizon_end=end,
    )


def _minute(value: datetime) -> int:
    epoch = datetime(1970, 1, 1, tzinfo=UTC)
    return int((value - epoch).total_seconds() // 60)


def _exact_minute(value: datetime) -> int:
    delta = value - datetime(1970, 1, 1, tzinfo=UTC)
    return delta.days * 1_440 + delta.seconds // 60


def test_expands_ordinary_week_and_planning_days() -> None:
    start = datetime(2026, 1, 5, tzinfo=UTC)
    end = datetime(2026, 1, 12, tzinfo=UTC)

    result = _run([AvailabilityWindowDraft(0, time(9), time(11))], start, end)

    assert result.windows == (
        MinuteWindow(
            _minute(datetime(2026, 1, 5, 9, tzinfo=UTC)),
            _minute(datetime(2026, 1, 5, 11, tzinfo=UTC)),
        ),
    )
    assert result.planning_days == tuple(
        PlanningDay(
            index,
            _minute(start + timedelta(days=index)),
            _minute(start + timedelta(days=index + 1)),
        )
        for index in range(7)
    )


def test_preserves_cross_midnight_window_as_one_concrete_interval() -> None:
    start = datetime(2026, 1, 5, tzinfo=UTC)
    result = _run(
        [AvailabilityWindowDraft(0, time(22), time(2))],
        start,
        datetime(2026, 1, 6, 6, tzinfo=UTC),
    )

    assert result.windows == (
        MinuteWindow(
            _minute(datetime(2026, 1, 5, 22, tzinfo=UTC)),
            _minute(datetime(2026, 1, 6, 2, tzinfo=UTC)),
        ),
    )


@pytest.mark.parametrize(
    ("start_time", "end_time", "crosses_midnight"),
    [
        (time(9), time(10), True),
        (time(22), time(2), False),
    ],
)
def test_rejects_inconsistent_persisted_crossing_metadata(
    start_time: time, end_time: time, crosses_midnight: bool
) -> None:
    with pytest.raises(ValueError, match="crosses_midnight"):
        _run(
            [AvailabilityWindow(uuid4(), 0, start_time, end_time, crosses_midnight)],
            datetime(2026, 1, 5, tzinfo=UTC),
            datetime(2026, 1, 6, tzinfo=UTC),
        )


def test_merges_touching_and_overlapping_concrete_windows() -> None:
    start = datetime(2026, 1, 5, tzinfo=UTC)
    result = _run(
        [
            AvailabilityWindowDraft(0, time(9), time(10)),
            AvailabilityWindowDraft(0, time(10), time(11)),
            AvailabilityWindowDraft(0, time(10, 30), time(12)),
        ],
        start,
        datetime(2026, 1, 6, tzinfo=UTC),
    )

    assert result.windows == (
        MinuteWindow(
            _minute(datetime(2026, 1, 5, 9, tzinfo=UTC)),
            _minute(datetime(2026, 1, 5, 12, tzinfo=UTC)),
        ),
    )


def test_clips_past_and_horizon_from_windows_and_day_boundaries() -> None:
    start = datetime(2026, 1, 5, 10, 15, tzinfo=UTC)
    end = datetime(2026, 1, 5, 15, 45, tzinfo=UTC)

    result = _run([AvailabilityWindowDraft(0, time(8), time(18))], start, end)

    assert result.windows == (MinuteWindow(_minute(start), _minute(end)),)
    assert result.planning_days == (PlanningDay(0, _minute(start), _minute(end)),)


def test_subtracts_full_and_partial_unavailable_periods() -> None:
    start = datetime(2026, 1, 5, tzinfo=UTC)
    result = _run(
        [AvailabilityWindowDraft(0, time(9), time(17))],
        start,
        datetime(2026, 1, 6, tzinfo=UTC),
        [
            UnavailablePeriodDraft(
                datetime(2026, 1, 5, 9, 30, tzinfo=UTC), datetime(2026, 1, 5, 11, tzinfo=UTC)
            ),
            UnavailablePeriodDraft(
                datetime(2026, 1, 5, 15, tzinfo=UTC), datetime(2026, 1, 5, 18, tzinfo=UTC)
            ),
        ],
    )

    assert result.windows == (
        MinuteWindow(
            _minute(datetime(2026, 1, 5, 9, tzinfo=UTC)),
            _minute(datetime(2026, 1, 5, 9, 30, tzinfo=UTC)),
        ),
        MinuteWindow(
            _minute(datetime(2026, 1, 5, 11, tzinfo=UTC)),
            _minute(datetime(2026, 1, 5, 15, tzinfo=UTC)),
        ),
    )

    fully_blocked = _run(
        [AvailabilityWindowDraft(0, time(9), time(17))],
        start,
        datetime(2026, 1, 6, tzinfo=UTC),
        [
            UnavailablePeriodDraft(
                datetime(2026, 1, 5, 8, tzinfo=UTC), datetime(2026, 1, 5, 18, tzinfo=UTC)
            )
        ],
    )
    assert fully_blocked.windows == ()


def test_spring_forward_uses_actual_local_day_and_skips_nonexistent_hour() -> None:
    start = datetime(2026, 3, 8, 5, tzinfo=UTC)
    end = datetime(2026, 3, 9, 4, tzinfo=UTC)

    result = _run(
        [AvailabilityWindowDraft(6, time(1), time(4))],
        start,
        end,
        timezone_name="America/New_York",
    )

    assert result.windows == (
        MinuteWindow(
            _minute(datetime(2026, 3, 8, 6, tzinfo=UTC)),
            _minute(datetime(2026, 3, 8, 8, tzinfo=UTC)),
        ),
    )
    assert result.planning_days == (
        PlanningDay(
            0,
            _minute(datetime(2026, 3, 8, 5, tzinfo=UTC)),
            _minute(datetime(2026, 3, 9, 4, tzinfo=UTC)),
        ),
    )


def test_spring_gap_can_collapse_one_occurrence_without_aborting_expansion() -> None:
    start = datetime(2026, 3, 8, 5, tzinfo=UTC)
    end = datetime(2026, 3, 9, 4, tzinfo=UTC)

    collapsed = _run(
        [AvailabilityWindowDraft(6, time(2), time(3))],
        start,
        end,
        timezone_name="America/New_York",
    )
    partial = _run(
        [AvailabilityWindowDraft(6, time(1, 30), time(3))],
        start,
        end,
        timezone_name="America/New_York",
    )

    assert collapsed.windows == ()
    assert partial.windows == (
        MinuteWindow(
            _minute(datetime(2026, 3, 8, 6, 30, tzinfo=UTC)),
            _minute(datetime(2026, 3, 8, 7, tzinfo=UTC)),
        ),
    )


def test_fall_back_uses_later_ambiguous_end_and_longer_local_day() -> None:
    start = datetime(2026, 11, 1, 4, tzinfo=UTC)
    end = datetime(2026, 11, 2, 5, tzinfo=UTC)

    result = _run(
        [AvailabilityWindowDraft(6, time(1), time(4))],
        start,
        end,
        timezone_name="America/New_York",
    )

    assert result.windows == (
        MinuteWindow(
            _minute(datetime(2026, 11, 1, 5, tzinfo=UTC)),
            _minute(datetime(2026, 11, 1, 9, tzinfo=UTC)),
        ),
    )
    assert result.planning_days == (
        PlanningDay(
            0,
            _minute(datetime(2026, 11, 1, 4, tzinfo=UTC)),
            _minute(datetime(2026, 11, 2, 5, tzinfo=UTC)),
        ),
    )


def test_ambiguous_midnight_keeps_havana_planning_days_contiguous() -> None:
    start = datetime(2026, 10, 31, 4, tzinfo=UTC)
    end = datetime(2026, 11, 2, 5, tzinfo=UTC)

    result = _run([], start, end, timezone_name="America/Havana")

    assert len(result.planning_days) == 2
    assert all(
        following.start_minute == previous.end_minute
        for previous, following in zip(result.planning_days, result.planning_days[1:], strict=False)
    )
    FeasibilityProblem(
        (),
        planning_start_minute=result.planning_days[0].start_minute,
        planning_days=result.planning_days.materialize(),
    )


def test_output_is_deterministic_independent_of_input_order() -> None:
    start = datetime(2026, 1, 5, tzinfo=UTC)
    windows = [
        AvailabilityWindowDraft(0, time(12), time(15)),
        AvailabilityWindowDraft(0, time(9), time(11)),
    ]
    unavailable = [
        UnavailablePeriodDraft(
            datetime(2026, 1, 5, 10, tzinfo=UTC), datetime(2026, 1, 5, 10, 30, tzinfo=UTC)
        ),
        UnavailablePeriodDraft(
            datetime(2026, 1, 5, 13, tzinfo=UTC), datetime(2026, 1, 5, 14, tzinfo=UTC)
        ),
    ]

    first = _run(windows, start, datetime(2026, 1, 6, tzinfo=UTC), unavailable)
    second = _run(
        list(reversed(windows)),
        start,
        datetime(2026, 1, 6, tzinfo=UTC),
        list(reversed(unavailable)),
    )

    assert first == second


def test_date_max_horizon_stays_lazy_countable_and_indexable() -> None:
    start = datetime(2026, 1, 5, tzinfo=UTC)
    end = datetime.max.replace(tzinfo=UTC)

    result = _run(
        [
            AvailabilityWindowDraft(0, time(9), time(11)),
            AvailabilityWindowDraft(4, time(22), time(2)),
        ],
        start,
        end,
    )

    day_count = (date.max - start.date()).days + 1
    monday_count = (date.max - start.date()).days // 7 + 1
    friday_count = (date.max - (start.date() + timedelta(days=4))).days // 7 + 1
    assert len(result.planning_days) == day_count
    assert result.planning_days[0].day_index == 0
    assert result.planning_days[-1] == PlanningDay(
        day_count - 1,
        _exact_minute(datetime.combine(date.max, time(), tzinfo=UTC)),
        _exact_minute(end),
    )
    assert len(result.windows) == monday_count + friday_count
    assert result.windows[0] == MinuteWindow(
        _minute(datetime(2026, 1, 5, 9, tzinfo=UTC)),
        _minute(datetime(2026, 1, 5, 11, tzinfo=UTC)),
    )
    assert result.windows[-1] == MinuteWindow(
        _exact_minute(datetime.combine(date.max, time(22), tzinfo=UTC)),
        _exact_minute(end),
    )


def test_far_future_blocked_range_is_counted_without_expanding_each_week() -> None:
    start = datetime(2026, 1, 5, tzinfo=UTC)
    blocked_start = datetime(2030, 1, 1, tzinfo=UTC)
    blocked_end = datetime(9990, 1, 1, tzinfo=UTC)
    end = datetime.max.replace(tzinfo=UTC)

    result = _run(
        [AvailabilityWindowDraft(0, time(9), time(11))],
        start,
        end,
        [UnavailablePeriodDraft(blocked_start, blocked_end)],
    )

    all_mondays = (date.max - start.date()).days // 7 + 1
    first_blocked_monday = blocked_start.date() + timedelta(
        days=(-blocked_start.date().weekday()) % 7
    )
    blocked_mondays = (blocked_end.date() - first_blocked_monday).days // 7 + 1
    if first_blocked_monday + timedelta(days=(blocked_mondays - 1) * 7) >= blocked_end.date():
        blocked_mondays -= 1
    assert len(result.windows) == all_mondays - blocked_mondays
    assert result.windows[-1].start > _minute(blocked_end)


def test_lazy_utc_count_handles_clipped_and_continuous_availability() -> None:
    start = datetime(2026, 1, 5, 10, tzinfo=UTC)
    end = datetime(2026, 1, 12, 10, tzinfo=UTC)
    always_available = [AvailabilityWindowDraft(weekday, time(), time()) for weekday in range(7)]

    result = _run(
        always_available,
        start,
        end,
        [UnavailablePeriodDraft(start, start + timedelta(hours=1))],
    )

    assert len(result.windows) == 1
    assert result.windows.materialize() == (
        MinuteWindow(_minute(start + timedelta(hours=1)), _minute(end)),
    )


def test_date_max_does_not_overflow_positive_offset_timezone() -> None:
    result = _run(
        [],
        datetime(9999, 12, 30, tzinfo=UTC),
        datetime.max.replace(tzinfo=UTC),
        timezone_name="Asia/Phnom_Penh",
    )

    assert len(result.planning_days) == 2
    assert result.planning_days[-1].end_minute == _exact_minute(datetime.max.replace(tzinfo=UTC))
    assert len(result.windows) == 0


@pytest.mark.parametrize(
    "call",
    [
        lambda: _run([], datetime(2026, 1, 5), datetime(2026, 1, 6, tzinfo=UTC)),
        lambda: _run([], datetime(2026, 1, 6, tzinfo=UTC), datetime(2026, 1, 5, tzinfo=UTC)),
        lambda: _run(
            [],
            datetime(2026, 1, 5, tzinfo=UTC),
            datetime(2026, 1, 6, tzinfo=UTC),
            timezone_name="Not/AZone",
        ),
        lambda: _run(
            [AvailabilityWindowDraft(7, time(9), time(10))],
            datetime(2026, 1, 5, tzinfo=UTC),
            datetime(2026, 1, 6, tzinfo=UTC),
        ),
        lambda: _run(
            [AvailabilityWindowDraft(0, time(9, 0, 1), time(10))],
            datetime(2026, 1, 5, tzinfo=UTC),
            datetime(2026, 1, 6, tzinfo=UTC),
        ),
        lambda: _run(
            [],
            datetime(2026, 1, 5, tzinfo=UTC),
            datetime(2026, 1, 6, tzinfo=UTC),
            [UnavailablePeriodDraft(datetime(2026, 1, 5), datetime(2026, 1, 6, tzinfo=UTC))],
        ),
    ],
)
def test_rejects_invalid_calendar_inputs(call: object) -> None:
    with pytest.raises(ValueError):
        call()  # type: ignore[operator]
