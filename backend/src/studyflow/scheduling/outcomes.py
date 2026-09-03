"""Immutable study-session outcome contracts and recording service."""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from typing import Protocol
from uuid import UUID

from studyflow.scheduling.proposals import StudySessionRecord

MAX_DURATION_MINUTES = 2_147_483_647
LARGE_ACTUAL_FACTOR = 2


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

    async def record(
        self,
        account_id: UUID,
        session_id: UUID,
        kind: SessionOutcomeKind,
        actual_minutes: int | None,
        remaining_minutes: int | None,
        large_actual_confirmed: bool,
        now: datetime,
    ) -> StudySessionOutcomeRecord | None: ...

    async def task_actual_minutes(self, account_id: UUID, task_id: UUID) -> int: ...


class StudySessions(Protocol):
    async def list(
        self, account_id: UUID, filters: StudySessionFilters
    ) -> list[StudySessionDetails]: ...

    async def get(self, account_id: UUID, session_id: UUID) -> StudySessionDetails | None: ...

    async def record_completed(
        self,
        account_id: UUID,
        session_id: UUID,
        actual_minutes: int,
        *,
        large_actual_confirmed: bool = False,
    ) -> StudySessionOutcomeRecord | None: ...

    async def record_delayed(
        self,
        account_id: UUID,
        session_id: UUID,
        actual_minutes: int,
        remaining_minutes: int | None = None,
        *,
        large_actual_confirmed: bool = False,
    ) -> StudySessionOutcomeRecord | None: ...

    async def record_missed(
        self, account_id: UUID, session_id: UUID
    ) -> StudySessionOutcomeRecord | None: ...

    async def task_actual_minutes(self, account_id: UUID, task_id: UUID) -> int: ...


class ProposedSessionOutcomeError(ValueError):
    """Raised when an outcome is recorded for an inactive proposal session."""


class FutureSessionOutcomeError(ValueError):
    """Raised when an outcome is recorded before the session has ended."""


class DuplicateSessionOutcomeError(ValueError):
    """Raised when an immutable outcome already exists for the session."""


class InvalidSessionOutcomeError(ValueError):
    """Raised when outcome minutes do not match the selected outcome."""


class LargeActualDurationConfirmationRequired(InvalidSessionOutcomeError):
    """Raised when an unusually large manual duration needs confirmation."""


def normalize_outcome_minutes(
    kind: SessionOutcomeKind,
    planned_minutes: int,
    actual_minutes: int | None,
    remaining_minutes: int | None,
    *,
    large_actual_confirmed: bool,
) -> tuple[int, int]:
    """Validate a user-entered outcome and return its persisted minute values."""
    if kind is SessionOutcomeKind.MISSED:
        return 0, planned_minutes
    if (
        type(actual_minutes) is not int
        or actual_minutes <= 0
        or actual_minutes > MAX_DURATION_MINUTES
    ):
        raise InvalidSessionOutcomeError("Actual minutes must be a positive integer")
    if actual_minutes > planned_minutes * LARGE_ACTUAL_FACTOR and not large_actual_confirmed:
        raise LargeActualDurationConfirmationRequired(
            "Confirm the unusually large actual duration before saving"
        )
    if kind is SessionOutcomeKind.COMPLETED:
        return actual_minutes, 0
    resolved_remaining = planned_minutes - actual_minutes
    if remaining_minutes is not None:
        resolved_remaining = remaining_minutes
    if (
        type(resolved_remaining) is not int
        or resolved_remaining <= 0
        or resolved_remaining > MAX_DURATION_MINUTES
    ):
        raise InvalidSessionOutcomeError("Delayed outcomes require positive remaining minutes")
    return actual_minutes, resolved_remaining


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

    async def record_completed(
        self,
        account_id: UUID,
        session_id: UUID,
        actual_minutes: int,
        *,
        large_actual_confirmed: bool = False,
    ) -> StudySessionOutcomeRecord | None:
        return await self._repository.record(
            account_id,
            session_id,
            SessionOutcomeKind.COMPLETED,
            actual_minutes,
            None,
            large_actual_confirmed,
            self._clock(),
        )

    async def record_delayed(
        self,
        account_id: UUID,
        session_id: UUID,
        actual_minutes: int,
        remaining_minutes: int | None = None,
        *,
        large_actual_confirmed: bool = False,
    ) -> StudySessionOutcomeRecord | None:
        return await self._repository.record(
            account_id,
            session_id,
            SessionOutcomeKind.DELAYED,
            actual_minutes,
            remaining_minutes,
            large_actual_confirmed,
            self._clock(),
        )

    async def record_missed(
        self, account_id: UUID, session_id: UUID
    ) -> StudySessionOutcomeRecord | None:
        return await self._repository.record(
            account_id,
            session_id,
            SessionOutcomeKind.MISSED,
            None,
            None,
            False,
            self._clock(),
        )

    async def task_actual_minutes(self, account_id: UUID, task_id: UUID) -> int:
        return await self._repository.task_actual_minutes(account_id, task_id)
