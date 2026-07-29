from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest

from studyflow.availability.unavailable import (
    UnavailablePeriodDraft,
    UnavailablePeriodService,
)

ACCOUNT_ID = UUID("5b15bfef-8c44-45d5-a70e-574beb999fb3")


class RepositoryStub:
    async def list_periods(self, account_id: UUID):  # type: ignore[no-untyped-def]
        return []

    async def create(self, account_id: UUID, draft: UnavailablePeriodDraft):  # type: ignore[no-untyped-def]
        return type("Period", (), {"id": uuid4()})()

    async def update(self, account_id: UUID, period_id: UUID, draft: UnavailablePeriodDraft):  # type: ignore[no-untyped-def]
        return type("Period", (), {"id": period_id})()

    async def delete(self, account_id: UUID, period_id: UUID) -> bool:
        return True


class InvalidatorStub:
    def __init__(self) -> None:
        self.calls: list[tuple[UUID, datetime, datetime]] = []

    async def remove_conflicting_future_sessions(
        self, account_id: UUID, starts_at: datetime, ends_at: datetime
    ) -> list[UUID]:
        self.calls.append((account_id, starts_at, ends_at))
        return [uuid4()]


@pytest.mark.anyio
async def test_unavailable_period_normalizes_utc_and_invalidates_future_sessions() -> None:
    invalidator = InvalidatorStub()
    service = UnavailablePeriodService(RepositoryStub(), invalidator)
    starts_at = datetime(2026, 8, 1, 12, tzinfo=UTC)
    result = await service.create(
        ACCOUNT_ID,
        UnavailablePeriodDraft(starts_at, starts_at + timedelta(hours=2), "Exam"),
    )

    assert result.invalidated_future_session_ids
    assert invalidator.calls[0][0] == ACCOUNT_ID


@pytest.mark.anyio
async def test_unavailable_period_rejects_naive_or_reversed_instants() -> None:
    service = UnavailablePeriodService(RepositoryStub(), InvalidatorStub())
    naive = datetime(2026, 8, 1, 12)
    with pytest.raises(ValueError, match="timezone-aware"):
        await service.create(ACCOUNT_ID, UnavailablePeriodDraft(naive, naive + timedelta(hours=1)))
    aware = naive.replace(tzinfo=UTC)
    with pytest.raises(ValueError, match="after"):
        await service.create(ACCOUNT_ID, UnavailablePeriodDraft(aware, aware))
