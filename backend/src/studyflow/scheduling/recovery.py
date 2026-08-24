"""Missed-session schedule recovery orchestration."""

import asyncio
import hashlib
import json
from collections.abc import Callable, Sequence
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from typing import Protocol
from uuid import UUID

from studyflow.accounts.preferences import AccountPreferences, StudyPreferences
from studyflow.availability.unavailable import UnavailablePeriod, UnavailablePeriods
from studyflow.availability.windows import AvailabilityWindow, AvailabilityWindows
from studyflow.scheduling.assembly import assemble_schedule_problem
from studyflow.scheduling.contracts import (
    KernelStatus,
    OverloadResult,
    TaskAllocation,
)
from studyflow.scheduling.outcomes import StudySessionOutcomeRecord
from studyflow.scheduling.overload import solve_with_overload
from studyflow.scheduling.proposals import (
    ProposalKind,
    ScheduleProposalRecord,
    ScheduleProposalRepository,
    StudySessionRecord,
)
from studyflow.scheduling.service import (
    ScheduleGenerationFailedError,
    ScheduleGenerationService,
    _utc_text,
    schedule_input_fingerprint,
)
from studyflow.tasks.service import AcademicTaskRecord, AcademicTasks

MISSED_REVISION_REASON = "Missed study session"


@dataclass(frozen=True, slots=True)
class RecoveryTaskWork:
    task_id: UUID
    unfinished_minutes: int


@dataclass(frozen=True, slots=True)
class RecoverySnapshot:
    missed_session_id: UUID
    captured_at: datetime
    unfinished_work: tuple[RecoveryTaskWork, ...]
    active_future_sessions: tuple[StudySessionRecord, ...]
    unresolved_outcomes: tuple[StudySessionOutcomeRecord, ...]


class InvalidRecoveryTriggerError(ValueError):
    """Raised when a session is not an unresolved missed-session trigger."""


class RecoverySnapshotRepository(Protocol):
    async def capture(
        self, account_id: UUID, missed_session_id: UUID, now: datetime
    ) -> RecoverySnapshot | None: ...

    async def save(
        self, account_id: UUID, proposal_id: UUID, snapshot: RecoverySnapshot
    ) -> bool: ...


class ScheduleRecovery(Protocol):
    async def propose(
        self, account_id: UUID, missed_session_id: UUID
    ) -> ScheduleProposalRecord | None: ...


def recovery_input_fingerprint(
    tasks: Sequence[AcademicTaskRecord],
    windows: Sequence[AvailabilityWindow],
    unavailable: Sequence[UnavailablePeriod],
    preferences: StudyPreferences,
    snapshot: RecoverySnapshot,
) -> str:
    """Hash schedule inputs plus the exact unfinished-work recovery snapshot."""

    payload = {
        "active_future_sessions": sorted(
            (
                str(item.id),
                str(item.task_id),
                _utc_text(item.starts_at),
                _utc_text(item.ends_at),
                item.planned_duration_minutes,
            )
            for item in snapshot.active_future_sessions
        ),
        "base_schedule_input": schedule_input_fingerprint(tasks, windows, unavailable, preferences),
        "missed_session_id": str(snapshot.missed_session_id),
        "unfinished_work": sorted(
            (str(item.task_id), item.unfinished_minutes) for item in snapshot.unfinished_work
        ),
        "unresolved_outcomes": sorted(
            (
                str(item.session_id),
                item.kind.value,
                item.actual_minutes,
                item.remaining_minutes,
                _utc_text(item.recorded_at),
                _utc_text(item.rescheduled_at) if item.rescheduled_at is not None else None,
            )
            for item in snapshot.unresolved_outcomes
        ),
        "version": 1,
    }
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


class ScheduleRecoveryService:
    def __init__(
        self,
        tasks: AcademicTasks,
        availability_windows: AvailabilityWindows,
        unavailable_periods: UnavailablePeriods,
        preferences: AccountPreferences,
        snapshots: RecoverySnapshotRepository,
        proposals: ScheduleProposalRepository,
        *,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
        solver: Callable[..., OverloadResult] = solve_with_overload,
    ) -> None:
        self._tasks = tasks
        self._availability_windows = availability_windows
        self._unavailable_periods = unavailable_periods
        self._preferences = preferences
        self._snapshots = snapshots
        self._proposals = proposals
        self._clock = clock
        self._solver = solver

    async def propose(
        self, account_id: UUID, missed_session_id: UUID
    ) -> ScheduleProposalRecord | None:
        now = self._clock()
        snapshot = await self._snapshots.capture(account_id, missed_session_id, now)
        if snapshot is None:
            return None
        preferences = await self._preferences.get(account_id)
        if preferences is None:
            return None
        tasks, windows, unavailable = await asyncio.gather(
            self._tasks.list(account_id),
            self._availability_windows.list_windows(account_id),
            self._unavailable_periods.list_periods(account_id),
        )
        work = {item.task_id: item.unfinished_minutes for item in snapshot.unfinished_work}
        recovery_tasks = tuple(
            replace(task, planned_duration_minutes=work[task.id])
            for task in tasks
            if task.id in work
        )
        current = tuple(task for task in recovery_tasks if task.deadline_at > now)
        overdue = tuple(task for task in recovery_tasks if task.deadline_at <= now)
        problem = assemble_schedule_problem(
            current, windows, unavailable, preferences, planning_start=now
        )
        result = await asyncio.to_thread(self._solver, problem)
        result = self._include_overdue(result, overdue)
        fingerprint = recovery_input_fingerprint(tasks, windows, unavailable, preferences, snapshot)
        draft = ScheduleGenerationService._proposal_draft(
            result,
            recovery_tasks,
            kind=ProposalKind.REVISION,
            revision_reason=MISSED_REVISION_REASON,
            fingerprint=fingerprint,
        )
        proposal = await self._proposals.replace(account_id, draft)
        if proposal is None:
            return None
        if not await self._snapshots.save(account_id, proposal.id, snapshot):
            raise ScheduleGenerationFailedError("Recovery snapshot could not be persisted")
        return proposal

    @staticmethod
    def _include_overdue(
        result: OverloadResult, overdue: Sequence[AcademicTaskRecord]
    ) -> OverloadResult:
        if not overdue:
            return result
        if result.status not in (KernelStatus.FEASIBLE, KernelStatus.OVERLOAD):
            return result
        overdue_allocations = tuple(
            TaskAllocation(
                task_id=str(task.id),
                deadline_minute=0,
                required_minutes=task.planned_duration_minutes,
                scheduled_minutes=0,
                unscheduled_minutes=task.planned_duration_minutes,
                raw_calendar_capacity_minutes=0,
                available_minutes_before_deadline=0,
                shortfall_minutes=task.planned_duration_minutes,
            )
            for task in overdue
        )
        return OverloadResult(
            KernelStatus.OVERLOAD,
            result.sessions,
            (*result.allocations, *overdue_allocations),
            result.diagnostics,
            result.detail,
        )
