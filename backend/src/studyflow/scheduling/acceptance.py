"""Accept or reject inactive schedule proposals."""

import asyncio
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Protocol
from uuid import UUID

from studyflow.accounts.preferences import AccountPreferences
from studyflow.availability.unavailable import UnavailablePeriods
from studyflow.availability.windows import AvailabilityWindows
from studyflow.scheduling.outcomes import StudySessions
from studyflow.scheduling.proposals import (
    ScheduleProposalRepository,
    StudySessionRecord,
)
from studyflow.scheduling.recovery import (
    InvalidRecoveryTriggerError,
    RecoverySnapshotRepository,
    recovery_input_fingerprint,
)
from studyflow.scheduling.service import schedule_input_fingerprint, tasks_for_schedule
from studyflow.tasks.service import AcademicTasks


class StaleScheduleProposalError(ValueError):
    """Raised when schedule-affecting account input changed after generation."""


class ScheduleAcceptance(Protocol):
    async def accept(
        self, account_id: UUID, proposal_id: UUID
    ) -> tuple[StudySessionRecord, ...] | None: ...

    async def reject(self, account_id: UUID, proposal_id: UUID) -> bool: ...


DEFAULT_ACCEPTANCE_GRACE_PERIOD = timedelta(minutes=2)


class ScheduleAcceptanceService:
    def __init__(
        self,
        tasks: AcademicTasks,
        availability_windows: AvailabilityWindows,
        unavailable_periods: UnavailablePeriods,
        preferences: AccountPreferences,
        proposals: ScheduleProposalRepository,
        recovery_snapshots: RecoverySnapshotRepository | None = None,
        *,
        study_sessions: StudySessions | None = None,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
        acceptance_grace_period: timedelta = DEFAULT_ACCEPTANCE_GRACE_PERIOD,
    ) -> None:
        self._tasks = tasks
        self._availability_windows = availability_windows
        self._unavailable_periods = unavailable_periods
        self._preferences = preferences
        self._proposals = proposals
        self._recovery_snapshots = recovery_snapshots
        self._study_sessions = study_sessions
        self._clock = clock
        self._acceptance_grace_period = acceptance_grace_period

    async def accept(
        self, account_id: UUID, proposal_id: UUID
    ) -> tuple[StudySessionRecord, ...] | None:
        proposal = await self._proposals.get(account_id)
        if proposal is None or proposal.id != proposal_id:
            return None
        preferences = await self._preferences.get(account_id)
        if preferences is None:
            return None
        now = self._clock()
        raw_tasks, windows, unavailable = await asyncio.gather(
            self._tasks.list(account_id),
            self._availability_windows.list_windows(account_id),
            self._unavailable_periods.list_periods(account_id),
        )
        tasks = tuple(raw_tasks)
        if proposal.scenario is not None:
            task_by_id = {task.id: task for task in tasks}
            if any(
                session.task_id not in task_by_id
                or session.ends_at > task_by_id[session.task_id].deadline_at
                for session in proposal.sessions
            ):
                raise StaleScheduleProposalError(
                    "Scenario proposal exceeds a task's current deadline; generate a new proposal"
                )
        snapshots = self._recovery_snapshots
        persisted = await snapshots.get(account_id, proposal_id) if snapshots is not None else None
        if persisted is not None and snapshots is not None:
            try:
                current_snapshot = await snapshots.capture(
                    account_id,
                    persisted.missed_session_id,
                    now,
                    preferences.minimum_break_minutes,
                )
            except InvalidRecoveryTriggerError as error:
                raise StaleScheduleProposalError(
                    "Recovery inputs changed; generate a new proposal"
                ) from error
            if current_snapshot is None:
                raise StaleScheduleProposalError("Recovery inputs changed; generate a new proposal")
            current_fingerprint = recovery_input_fingerprint(
                tasks, windows, unavailable, preferences, current_snapshot
            )
        else:
            if self._study_sessions is not None:
                tasks = await tasks_for_schedule(account_id, tasks, self._study_sessions)
            current_fingerprint = schedule_input_fingerprint(
                tasks, windows, unavailable, preferences, scenario=proposal.scenario
            )
        if current_fingerprint != proposal.input_fingerprint:
            raise StaleScheduleProposalError("Schedule inputs changed; generate a new proposal")
        mutation_now = self._clock()
        return await self._proposals.accept(
            account_id,
            proposal_id,
            mutation_now,
            preferences.minimum_break_minutes,
            grace_period=self._acceptance_grace_period,
        )

    async def reject(self, account_id: UUID, proposal_id: UUID) -> bool:
        return await self._proposals.reject(account_id, proposal_id)
