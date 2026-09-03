"""Schedule generation orchestration."""

import asyncio
import hashlib
import json
from collections.abc import Callable, Sequence
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from typing import Protocol
from uuid import UUID, uuid4

from studyflow.accounts.preferences import AccountPreferences, StudyPreferences
from studyflow.availability.unavailable import UnavailablePeriod, UnavailablePeriods
from studyflow.availability.windows import AvailabilityWindow, AvailabilityWindows
from studyflow.scheduling.assembly import assemble_schedule_problem
from studyflow.scheduling.contracts import FeasibilityProblem, KernelStatus, OverloadResult
from studyflow.scheduling.overload import solve_with_overload
from studyflow.scheduling.proposals import (
    NewProposedSession,
    NewScheduleProposal,
    NewTaskAllocation,
    ProposalKind,
    ProposalStatus,
    ScheduleProposalRecord,
    ScheduleProposalRepository,
    StudySessionRecord,
    TaskAllocationRecord,
)
from studyflow.scheduling.scenarios import ScenarioValidationError, ScheduleScenario
from studyflow.tasks.service import AcademicTaskRecord, AcademicTasks

_UTC_EPOCH = datetime(1970, 1, 1, tzinfo=UTC)


class ScheduleGenerationFailedError(RuntimeError):
    """Raised when the solver cannot produce a proposal safely."""


class ScheduleGeneration(Protocol):
    async def generate(
        self,
        account_id: UUID,
        *,
        kind: ProposalKind = ProposalKind.GENERATION,
        revision_reason: str | None = None,
        scenario: ScheduleScenario | None = None,
    ) -> ScheduleProposalRecord | None: ...

    async def simulate(
        self, account_id: UUID, scenario: ScheduleScenario
    ) -> ScheduleProposalRecord | None: ...


def _utc_text(value: datetime) -> str:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("Schedule fingerprint instants must be timezone-aware")
    return value.astimezone(UTC).isoformat(timespec="microseconds").replace("+00:00", "Z")


def schedule_input_fingerprint(
    tasks: Sequence[AcademicTaskRecord],
    availability_windows: Sequence[AvailabilityWindow],
    unavailable_periods: Sequence[UnavailablePeriod],
    preferences: StudyPreferences,
    *,
    scenario: ScheduleScenario | None = None,
) -> str:
    """Hash the canonical schedule-affecting account input."""

    task_values = sorted(
        (
            str(task.id),
            _utc_text(task.deadline_at),
            task.planned_duration_minutes,
            task.priority.value,
            task.status.value,
        )
        for task in tasks
    )
    window_values = sorted(
        (
            window.weekday,
            window.start_time.isoformat(timespec="minutes"),
            window.end_time.isoformat(timespec="minutes"),
            window.crosses_midnight,
        )
        for window in availability_windows
    )
    unavailable_values = sorted(
        (_utc_text(period.starts_at), _utc_text(period.ends_at)) for period in unavailable_periods
    )
    payload = {
        "availability": window_values,
        "preferences": {
            "availability_confirmation_required": preferences.availability_confirmation_required,
            "minimum_break_minutes": preferences.minimum_break_minutes,
            "preferred_session_length_minutes": preferences.preferred_session_length_minutes,
            "timezone": preferences.timezone,
        },
        "tasks": task_values,
        "unavailable": unavailable_values,
        "version": 1,
    }
    if scenario is not None and not scenario.is_empty:
        payload["scenario"] = scenario.as_payload()
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


def _minute_datetime(value: int) -> datetime:
    return _UTC_EPOCH + timedelta(minutes=value)


class ScheduleGenerationService:
    def __init__(
        self,
        tasks: AcademicTasks,
        availability_windows: AvailabilityWindows,
        unavailable_periods: UnavailablePeriods,
        preferences: AccountPreferences,
        proposals: ScheduleProposalRepository,
        *,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
        solver: Callable[[FeasibilityProblem], OverloadResult] = solve_with_overload,
    ) -> None:
        self._tasks = tasks
        self._availability_windows = availability_windows
        self._unavailable_periods = unavailable_periods
        self._preferences = preferences
        self._proposals = proposals
        self._clock = clock
        self._solver = solver

    async def generate(
        self,
        account_id: UUID,
        *,
        kind: ProposalKind = ProposalKind.GENERATION,
        revision_reason: str | None = None,
        scenario: ScheduleScenario | None = None,
    ) -> ScheduleProposalRecord | None:
        return await self._run(
            account_id,
            kind=kind,
            revision_reason=revision_reason,
            scenario=scenario,
            persist=True,
        )

    async def simulate(
        self, account_id: UUID, scenario: ScheduleScenario
    ) -> ScheduleProposalRecord | None:
        return await self._run(account_id, scenario=scenario, persist=False)

    async def _run(
        self,
        account_id: UUID,
        *,
        kind: ProposalKind = ProposalKind.GENERATION,
        revision_reason: str | None = None,
        scenario: ScheduleScenario | None = None,
        persist: bool,
    ) -> ScheduleProposalRecord | None:
        preferences = await self._preferences.get(account_id)
        if preferences is None:
            return None
        tasks, windows, unavailable = await asyncio.gather(
            self._tasks.list(account_id),
            self._availability_windows.list_windows(account_id),
            self._unavailable_periods.list_periods(account_id),
        )
        normalized_scenario = (scenario or ScheduleScenario()).normalized()
        planning_start = self._clock()
        effective_tasks = self._apply_deadline_overrides(tasks, normalized_scenario, planning_start)
        fingerprint = schedule_input_fingerprint(
            tasks,
            windows,
            unavailable,
            preferences,
            scenario=normalized_scenario if not normalized_scenario.is_empty else None,
        )
        problem = assemble_schedule_problem(
            effective_tasks,
            windows,
            unavailable,
            preferences,
            planning_start=planning_start,
            temporary_availability=normalized_scenario.temporary_availability,
            temporary_blocked_periods=normalized_scenario.temporary_blocked_periods,
        )
        result = await asyncio.to_thread(self._solver, problem)
        draft = self._proposal_draft(
            result,
            effective_tasks,
            kind=kind,
            revision_reason=revision_reason,
            fingerprint=fingerprint,
            scenario=normalized_scenario if not normalized_scenario.is_empty else None,
        )
        if persist:
            return await self._proposals.replace(account_id, draft)
        return self._preview_record(account_id, draft, self._clock())

    @staticmethod
    def _apply_deadline_overrides(
        tasks: Sequence[AcademicTaskRecord],
        scenario: ScheduleScenario,
        planning_start: datetime,
    ) -> tuple[AcademicTaskRecord, ...]:
        task_by_id = {task.id: task for task in tasks}
        overrides = {item.task_id: item.deadline_at for item in scenario.deadline_overrides}
        unknown = sorted(set(overrides) - set(task_by_id))
        if unknown:
            raise ScenarioValidationError(f"Scenario contains unknown task id {unknown[0]}")
        for task_id, deadline_at in overrides.items():
            if deadline_at <= planning_start.astimezone(UTC):
                raise ScenarioValidationError(
                    f"Deadline override for task {task_id} must be in the future"
                )
        return tuple(
            replace(task, deadline_at=overrides.get(task.id, task.deadline_at)) for task in tasks
        )

    @staticmethod
    def _preview_record(
        account_id: UUID, proposal: NewScheduleProposal, created_at: datetime
    ) -> ScheduleProposalRecord:
        proposal_id = uuid4()
        sessions = tuple(
            StudySessionRecord(
                id=uuid4(),
                account_id=account_id,
                task_id=item.task_id,
                proposal_id=proposal_id,
                starts_at=item.starts_at,
                ends_at=item.ends_at,
                planned_duration_minutes=item.planned_duration_minutes,
            )
            for item in proposal.sessions
        )
        allocations = tuple(
            TaskAllocationRecord(
                proposal_id=proposal_id,
                task_id=item.task_id,
                deadline_at=item.deadline_at,
                required_minutes=item.required_minutes,
                scheduled_minutes=item.scheduled_minutes,
                unscheduled_minutes=item.unscheduled_minutes,
                raw_calendar_capacity_minutes=item.raw_calendar_capacity_minutes,
                available_minutes_before_deadline=item.available_minutes_before_deadline,
                shortfall_minutes=item.shortfall_minutes,
            )
            for item in proposal.allocations
        )
        return ScheduleProposalRecord(
            id=proposal_id,
            account_id=account_id,
            kind=proposal.kind,
            revision_reason=proposal.revision_reason,
            status=proposal.status,
            input_fingerprint=proposal.input_fingerprint,
            created_at=created_at.astimezone(UTC),
            sessions=sessions,
            allocations=allocations,
            scenario=proposal.scenario,
        )

    @staticmethod
    def _proposal_draft(
        result: OverloadResult,
        tasks: Sequence[AcademicTaskRecord],
        *,
        kind: ProposalKind,
        revision_reason: str | None,
        fingerprint: str,
        scenario: ScheduleScenario | None = None,
    ) -> NewScheduleProposal:
        if result.status is KernelStatus.FEASIBLE:
            status = ProposalStatus.FEASIBLE
        elif result.status is KernelStatus.OVERLOAD:
            status = ProposalStatus.OVERLOAD
        else:
            detail = result.detail or result.diagnostics.solver_status
            raise ScheduleGenerationFailedError(detail)

        task_by_id = {task.id: task for task in tasks}
        try:
            sessions = tuple(
                NewProposedSession(
                    task_id=UUID(session.task_id),
                    starts_at=_minute_datetime(session.start_minute),
                    ends_at=_minute_datetime(session.end_minute),
                    planned_duration_minutes=session.end_minute - session.start_minute,
                )
                for session in sorted(
                    result.sessions,
                    key=lambda item: (
                        item.start_minute,
                        item.end_minute,
                        item.task_id,
                        item.session_id,
                    ),
                )
            )
            allocations = tuple(
                NewTaskAllocation(
                    task_id=task_id,
                    deadline_at=task_by_id[task_id].deadline_at.astimezone(UTC),
                    required_minutes=allocation.required_minutes,
                    scheduled_minutes=allocation.scheduled_minutes,
                    unscheduled_minutes=allocation.unscheduled_minutes,
                    raw_calendar_capacity_minutes=allocation.raw_calendar_capacity_minutes,
                    available_minutes_before_deadline=allocation.available_minutes_before_deadline,
                    shortfall_minutes=allocation.shortfall_minutes,
                )
                for allocation in sorted(
                    result.allocations,
                    key=lambda item: (item.deadline_minute, item.task_id),
                )
                for task_id in (UUID(allocation.task_id),)
            )
        except (KeyError, ValueError) as error:
            raise ScheduleGenerationFailedError("Solver returned an unknown task") from error
        return NewScheduleProposal(
            kind=kind,
            revision_reason=revision_reason,
            status=status,
            input_fingerprint=fingerprint,
            sessions=sessions,
            allocations=allocations,
            scenario=scenario,
        )
