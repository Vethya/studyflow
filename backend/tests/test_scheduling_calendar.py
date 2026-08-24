from __future__ import annotations

from datetime import UTC, datetime, time, timedelta

import pytest

from studyflow.availability.unavailable import UnavailablePeriodDraft
from studyflow.availability.windows import AvailabilityWindowDraft
from studyflow.scheduling import MinuteWindow, PlanningDay
from studyflow.scheduling.calendar import ExpandedCalendar, expand_calendar


def _run(
    windows: list[AvailabilityWindowDraft],
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
