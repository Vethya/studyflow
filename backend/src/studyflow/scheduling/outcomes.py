"""Immutable study-session outcome contracts and missed-session service."""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from typing import Protocol
from uuid import UUID

from studyflow.scheduling.proposals import StudySessionRecord


class SessionOutcomeKind(StrEnum):
    COMPLETED = "completed"
    DELAYED = "delayed"
    MISSED = "missed"


@dataclass(frozen=True, slots=True)
class StudySessionOutcomeRecord:
    session_id: UUID
    kind: SessionOutcomeKind
    actual_minutes: int
    remaining_minutes: int
    recorded_at: datetime
    rescheduled_at: datetime | None


@dataclass(frozen=True, slots=True)
class StudySessionDetails:
    session: StudySessionRecord
    outcome: StudySessionOutcomeRecord | None


@dataclass(frozen=True, slots=True)
class StudySessionFilters:
    starts_from: datetime | None = None
    starts_to: datetime | None = None
    task_id: UUID | None = None


class StudySessionOutcomeRepository(Protocol):
    async def list(
        self, account_id: UUID, filters: StudySessionFilters
    ) -> list[StudySessionDetails]: ...

    async def get(self, account_id: UUID, session_id: UUID) -> StudySessionDetails | None: ...

    async def record_missed(
        self, account_id: UUID, session_id: UUID, now: datetime
    ) -> StudySessionOutcomeRecord | None: ...


class StudySessions(Protocol):
    async def list(
        self, account_id: UUID, filters: StudySessionFilters
    ) -> list[StudySessionDetails]: ...

    async def get(self, account_id: UUID, session_id: UUID) -> StudySessionDetails | None: ...

    async def record_missed(
        self, account_id: UUID, session_id: UUID
    ) -> StudySessionOutcomeRecord | None: ...


class ProposedSessionOutcomeError(ValueError):
    """Raised when an outcome is recorded for an inactive proposal session."""


class FutureSessionOutcomeError(ValueError):
    """Raised when an outcome is recorded before the session has ended."""


class DuplicateSessionOutcomeError(ValueError):
    """Raised when an immutable outcome already exists for the session."""


class StudySessionService:
    def __init__(
        self,
        repository: StudySessionOutcomeRepository,
        *,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self._repository = repository
        self._clock = clock

    async def list(
        self, account_id: UUID, filters: StudySessionFilters
    ) -> list[StudySessionDetails]:
        return await self._repository.list(account_id, filters)

    async def get(self, account_id: UUID, session_id: UUID) -> StudySessionDetails | None:
        return await self._repository.get(account_id, session_id)

    async def record_missed(
        self, account_id: UUID, session_id: UUID
    ) -> StudySessionOutcomeRecord | None:
        return await self._repository.record_missed(account_id, session_id, self._clock())
