from datetime import UTC, datetime, timedelta, timezone
from uuid import UUID, uuid4

import pytest

from studyflow.availability.unavailable import (
    UnavailablePeriod,
    UnavailablePeriodChange,
    UnavailablePeriodDraft,
    UnavailablePeriodService,
)

ACCOUNT_ID = UUID("5b15bfef-8c44-45d5-a70e-574beb999fb3")


class RepositoryStub:
    def __init__(self) -> None:
        self.created: list[tuple[UUID, UnavailablePeriodDraft]] = []

    async def list_periods(self, account_id: UUID):  # type: ignore[no-untyped-def]
        return []

    async def create(self, account_id: UUID, draft: UnavailablePeriodDraft):  # type: ignore[no-untyped-def]
        self.created.append((account_id, draft))
        period = UnavailablePeriod(uuid4(), draft.starts_at, draft.ends_at, draft.reason)
        return UnavailablePeriodChange(period, [uuid4()])

    async def update(self, account_id: UUID, period_id: UUID, draft: UnavailablePeriodDraft):  # type: ignore[no-untyped-def]
        period = UnavailablePeriod(period_id, draft.starts_at, draft.ends_at, draft.reason)
        return UnavailablePeriodChange(period, [])

    async def delete(self, account_id: UUID, period_id: UUID) -> bool:
        return True


@pytest.mark.anyio
async def test_unavailable_period_normalizes_before_atomic_repository_change() -> None:
    repository = RepositoryStub()
    service = UnavailablePeriodService(repository)
    starts_at = datetime(2026, 8, 1, 19, tzinfo=timezone(timedelta(hours=7)))
    result = await service.create(
        ACCOUNT_ID,
        UnavailablePeriodDraft(starts_at, starts_at + timedelta(hours=2), " Exam "),
    )

    assert result.invalidated_future_session_ids
    assert repository.created == [
        (
            ACCOUNT_ID,
            UnavailablePeriodDraft(
                datetime(2026, 8, 1, 12, tzinfo=UTC),
                datetime(2026, 8, 1, 14, tzinfo=UTC),
                "Exam",
            ),
        )
    ]


@pytest.mark.anyio
async def test_unavailable_period_rejects_naive_or_reversed_instants() -> None:
    service = UnavailablePeriodService(RepositoryStub())
    naive = datetime(2026, 8, 1, 12)
    with pytest.raises(ValueError, match="timezone-aware"):
        await service.create(ACCOUNT_ID, UnavailablePeriodDraft(naive, naive + timedelta(hours=1)))
    aware = naive.replace(tzinfo=UTC)
    with pytest.raises(ValueError, match="after"):
        await service.create(ACCOUNT_ID, UnavailablePeriodDraft(aware, aware))
