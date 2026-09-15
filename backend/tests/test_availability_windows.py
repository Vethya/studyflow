from datetime import UTC, time
from uuid import UUID, uuid4

import pytest

from studyflow.availability.windows import (
    AvailabilityTimezoneConfirmation,
    AvailabilityWindow,
    AvailabilityWindowChange,
    AvailabilityWindowDraft,
    AvailabilityWindowService,
    merge_windows,
)


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


@pytest.mark.anyio
async def test_availability_window_service_and_draft_validations() -> None:
    # Weekday out of range (line 47)
    with pytest.raises(ValueError, match="Weekday must be between 0 and 6"):
        merge_windows([AvailabilityWindowDraft(7, time(9), time(10))])

    # Merged window exceeds 24 hours (line 75)
    with pytest.raises(ValueError, match="A merged availability window cannot exceed 24 hours"):
        merge_windows(
            [
                AvailabilityWindowDraft(0, time(0, 0), time(23, 0)),
                AvailabilityWindowDraft(0, time(22, 0), time(2, 0)),
            ]
        )

    # AvailabilityWindowService confirm_timezone delegation (line 121)
    class StubRepo:
        async def list_windows(self, account_id: UUID) -> list[AvailabilityWindow]:
            return []

        async def replace(
            self, account_id: UUID, windows: list[AvailabilityWindowDraft]
        ) -> AvailabilityWindowChange:
            return AvailabilityWindowChange([], [])

        async def confirm_timezone(
            self, account_id: UUID
        ) -> AvailabilityTimezoneConfirmation | None:
            return AvailabilityTimezoneConfirmation([])

    service = AvailabilityWindowService(StubRepo())
    assert await service.list_windows(uuid4()) == []
    assert (await service.replace(uuid4(), [])).windows == []
    res = await service.confirm_timezone(uuid4())
    assert res is not None and res.invalidated_future_session_ids == []
