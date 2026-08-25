"""Accept or reject inactive schedule proposals."""

import asyncio
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Protocol
from uuid import UUID

from studyflow.accounts.preferences import AccountPreferences
from studyflow.availability.unavailable import UnavailablePeriods
from studyflow.availability.windows import AvailabilityWindows
from studyflow.scheduling.proposals import ScheduleProposalRepository, StudySessionRecord
from studyflow.scheduling.service import schedule_input_fingerprint
from studyflow.tasks.service import AcademicTasks


class StaleScheduleProposalError(ValueError):
    """Raised when schedule-affecting account input changed after generation."""


class ScheduleAcceptance(Protocol):
    async def accept(
        self, account_id: UUID, proposal_id: UUID
    ) -> tuple[StudySessionRecord, ...] | None: ...

    async def reject(self, account_id: UUID, proposal_id: UUID) -> bool: ...


class ScheduleAcceptanceService:
    def __init__(
        self,
        tasks: AcademicTasks,
        availability_windows: AvailabilityWindows,
        unavailable_periods: UnavailablePeriods,
        preferences: AccountPreferences,
        proposals: ScheduleProposalRepository,
        *,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self._tasks = tasks
        self._availability_windows = availability_windows
        self._unavailable_periods = unavailable_periods
        self._preferences = preferences
        self._proposals = proposals
        self._clock = clock

    async def accept(
        self, account_id: UUID, proposal_id: UUID
    ) -> tuple[StudySessionRecord, ...] | None:
        proposal = await self._proposals.get(account_id)
        if proposal is None or proposal.id != proposal_id:
            return None
        preferences = await self._preferences.get(account_id)
        if preferences is None:
            return None
        tasks, windows, unavailable = await asyncio.gather(
            self._tasks.list(account_id),
            self._availability_windows.list_windows(account_id),
            self._unavailable_periods.list_periods(account_id),
        )
        current_fingerprint = schedule_input_fingerprint(tasks, windows, unavailable, preferences)
        if current_fingerprint != proposal.input_fingerprint:
            raise StaleScheduleProposalError("Schedule inputs changed; generate a new proposal")
        return await self._proposals.accept(
            account_id,
            proposal_id,
            self._clock(),
            preferences.minimum_break_minutes,
        )

    async def reject(self, account_id: UUID, proposal_id: UUID) -> bool:
        return await self._proposals.reject(account_id, proposal_id)
