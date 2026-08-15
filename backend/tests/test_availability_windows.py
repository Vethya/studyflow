from datetime import UTC, time

import pytest

from studyflow.availability.windows import AvailabilityWindowDraft, merge_windows


def test_availability_windows_merge_touching_and_cross_midnight_intervals() -> None:
    merged = merge_windows(
        [
            AvailabilityWindowDraft(0, time(18), time(20)),
            AvailabilityWindowDraft(0, time(20), time(22)),
            AvailabilityWindowDraft(1, time(1), time(3)),
            AvailabilityWindowDraft(0, time(22), time(2)),
        ]
    )

    assert merged == [AvailabilityWindowDraft(0, time(18), time(3))]


def test_availability_windows_merge_across_the_week_boundary() -> None:
    merged = merge_windows(
        [
            AvailabilityWindowDraft(0, time(0), time(2)),
            AvailabilityWindowDraft(6, time(22), time(1)),
        ]
    )

    assert merged == [AvailabilityWindowDraft(6, time(22), time(2))]


def test_availability_windows_merge_touching_at_week_boundary() -> None:
    merged = merge_windows(
        [
            AvailabilityWindowDraft(0, time(0), time(2)),
            AvailabilityWindowDraft(6, time(22), time(0)),
        ]
    )

    assert merged == [AvailabilityWindowDraft(6, time(22), time(2))]


@pytest.mark.parametrize("invalid", [time(18, 0, 1), time(18, tzinfo=UTC)])
def test_availability_windows_reject_non_local_minute_times(invalid: time) -> None:
    with pytest.raises(ValueError, match="local minute values"):
        merge_windows([AvailabilityWindowDraft(0, invalid, time(22))])
