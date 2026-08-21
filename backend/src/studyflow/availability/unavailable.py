"""Dated unavailable periods and future-session invalidation boundary."""

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Protocol
from uuid import UUID


@dataclass(frozen=True, slots=True)
class UnavailablePeriodDraft:
    starts_at: datetime
    ends_at: datetime
    reason: str | None = None


@dataclass(frozen=True, slots=True)
class UnavailablePeriod:
    id: UUID
    starts_at: datetime
    ends_at: datetime
    reason: str | None


@dataclass(frozen=True, slots=True)
class UnavailablePeriodChange:
    period: UnavailablePeriod
    invalidated_future_session_ids: list[UUID]


class UnavailablePeriodRepository(Protocol):
    async def list_periods(self, account_id: UUID) -> list[UnavailablePeriod]: ...
    async def create(
        self, account_id: UUID, draft: UnavailablePeriodDraft
    ) -> UnavailablePeriodChange: ...
    async def update(
        self, account_id: UUID, period_id: UUID, draft: UnavailablePeriodDraft
    ) -> UnavailablePeriodChange | None: ...
    async def delete(self, account_id: UUID, period_id: UUID) -> bool: ...


def normalize_draft(draft: UnavailablePeriodDraft) -> UnavailablePeriodDraft:
    if draft.starts_at.utcoffset() is None or draft.ends_at.utcoffset() is None:
        raise ValueError("Unavailable period instants must be timezone-aware")
    starts_at = draft.starts_at.astimezone(UTC)
    ends_at = draft.ends_at.astimezone(UTC)
    if ends_at <= starts_at:
        raise ValueError("ends_at must be after starts_at")
    reason = draft.reason.strip() if draft.reason is not None else None
    reason = reason or None
    if reason is not None and len(reason) > 200:
        raise ValueError("reason cannot exceed 200 characters")
    return UnavailablePeriodDraft(starts_at, ends_at, reason)


class UnavailablePeriodService:
    def __init__(self, repository: UnavailablePeriodRepository) -> None:
        self._repository = repository

    async def list_periods(self, account_id: UUID) -> list[UnavailablePeriod]:
        return await self._repository.list_periods(account_id)

    async def create(
        self, account_id: UUID, draft: UnavailablePeriodDraft
    ) -> UnavailablePeriodChange:
        return await self._repository.create(account_id, normalize_draft(draft))

    async def update(
        self, account_id: UUID, period_id: UUID, draft: UnavailablePeriodDraft
    ) -> UnavailablePeriodChange | None:
        return await self._repository.update(account_id, period_id, normalize_draft(draft))

    async def delete(self, account_id: UUID, period_id: UUID) -> bool:
        return await self._repository.delete(account_id, period_id)


class UnavailablePeriods(Protocol):
    async def list_periods(self, account_id: UUID) -> list[UnavailablePeriod]: ...
    async def create(
        self, account_id: UUID, draft: UnavailablePeriodDraft
    ) -> UnavailablePeriodChange: ...
    async def update(
        self, account_id: UUID, period_id: UUID, draft: UnavailablePeriodDraft
    ) -> UnavailablePeriodChange | None: ...
    async def delete(self, account_id: UUID, period_id: UUID) -> bool: ...
