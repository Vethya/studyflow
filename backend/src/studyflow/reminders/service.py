"""Select due study reminders and deliver each one at most once."""

import logging
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import Protocol
from uuid import UUID

logger = logging.getLogger(__name__)

AFTER_SESSION_MINIMUM_DELAY = timedelta(minutes=10)
AFTER_SESSION_LOOKBACK = timedelta(hours=24)
DEFAULT_BATCH_LIMIT = 100
DEFAULT_TIME_BUDGET_SECONDS = 60.0


class ReminderKind(StrEnum):
    BEFORE = "before"
    AFTER = "after"


@dataclass(frozen=True, slots=True)
class ReminderCandidate:
    kind: ReminderKind
    account_id: UUID
    session_id: UUID
    email: str
    name: str
    timezone: str
    task_title: str
    starts_at: datetime
    ends_at: datetime


@dataclass(frozen=True, slots=True)
class ReminderDispatchSummary:
    sent_before: int = 0
    sent_after: int = 0
    skipped: int = 0
    failed: int = 0


class ReminderDispatchRepository(Protocol):
    async def due_candidates(self, now: datetime, limit: int) -> list[ReminderCandidate]: ...

    async def claim(self, candidate: ReminderCandidate, sent_at: datetime) -> bool: ...

    async def release(self, candidate: ReminderCandidate) -> None: ...


class ReminderEmailSender(Protocol):
    async def send_before_session(self, candidate: ReminderCandidate) -> None: ...

    async def send_after_session(self, candidate: ReminderCandidate) -> None: ...


class ReminderDispatch(Protocol):
    async def dispatch(self) -> ReminderDispatchSummary: ...


class ReminderDispatchService:
    def __init__(
        self,
        repository: ReminderDispatchRepository,
        email_sender: ReminderEmailSender,
        *,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
        monotonic: Callable[[], float] = time.monotonic,
        batch_limit: int = DEFAULT_BATCH_LIMIT,
        time_budget_seconds: float = DEFAULT_TIME_BUDGET_SECONDS,
    ) -> None:
        self._repository = repository
        self._email_sender = email_sender
        self._clock = clock
        self._monotonic = monotonic
        self._batch_limit = batch_limit
        self._time_budget_seconds = time_budget_seconds

    async def dispatch(self) -> ReminderDispatchSummary:
        started = self._monotonic()
        now = self._clock().astimezone(UTC)
        candidates = await self._repository.due_candidates(now, self._batch_limit)
        sent_before = sent_after = skipped = failed = 0
        for candidate in candidates:
            # Unclaimed candidates stay eligible, so stopping early defers them to the next run
            # instead of letting a slow mail relay outlast the trigger's request timeout.
            if self._monotonic() - started > self._time_budget_seconds:
                skipped += 1
                continue
            if not await self._repository.claim(candidate, now):
                skipped += 1
                continue
            try:
                if candidate.kind is ReminderKind.BEFORE:
                    await self._email_sender.send_before_session(candidate)
                else:
                    await self._email_sender.send_after_session(candidate)
            except Exception as error:
                failed += 1
                logger.warning(
                    "Study reminder delivery failed",
                    extra={
                        "reminder_kind": candidate.kind.value,
                        "session_id": str(candidate.session_id),
                        "error_type": type(error).__name__,
                    },
                )
                await self._release(candidate)
                continue
            if candidate.kind is ReminderKind.BEFORE:
                sent_before += 1
            else:
                sent_after += 1
        return ReminderDispatchSummary(
            sent_before=sent_before,
            sent_after=sent_after,
            skipped=skipped,
            failed=failed,
        )

    async def _release(self, candidate: ReminderCandidate) -> None:
        try:
            await self._repository.release(candidate)
        except Exception as error:
            logger.error(
                "Study reminder claim could not be released",
                extra={
                    "reminder_kind": candidate.kind.value,
                    "session_id": str(candidate.session_id),
                    "error_type": type(error).__name__,
                },
            )
