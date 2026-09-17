from dataclasses import dataclass, replace
from datetime import UTC, datetime, time, timedelta
from typing import cast
from uuid import UUID, uuid4

import pytest

from studyflow.accounts.preferences import AccountPreferences, StudyPreferences
from studyflow.app import create_app
from studyflow.availability.unavailable import UnavailablePeriod, UnavailablePeriods
from studyflow.availability.windows import AvailabilityWindow, AvailabilityWindows
from studyflow.scheduling import (
    KernelStatus,
    OverloadResult,
    ProposalKind,
    ProposalStatus,
    ScheduledSession,
    ScheduleGeneration,
    ScheduleGenerationFailedError,
    ScheduleGenerationService,
    SolverDiagnostics,
    TaskAllocation,
    schedule_input_fingerprint,
)
from studyflow.scheduling.proposals import (
    NewProposedSession,
    NewScheduleProposal,
    NewTaskAllocation,
    ScheduleProposalRepository,
)
from studyflow.scheduling.scenarios import (
    ScenarioDeadlineOverride,
    ScenarioValidationError,
    ScheduleScenario,
)
from studyflow.scheduling.service import _utc_text
from studyflow.tasks.service import (
    AcademicTaskRecord,
    AcademicTasks,
    TaskCategory,
    TaskPriority,
    TaskStatus,
)

ACCOUNT_ID = UUID("00000000-0000-0000-0000-000000000001")
TASK_ID = UUID("00000000-0000-0000-0000-000000000002")


@dataclass
class TasksStub:
    records: list[AcademicTaskRecord]

    async def list(self, account_id: UUID, filters: object = None) -> list[AcademicTaskRecord]:
        return self.records


@dataclass
class WindowsStub:
    records: list[AvailabilityWindow]

    async def list_windows(self, account_id: UUID) -> list[AvailabilityWindow]:
        return self.records


@dataclass
class PeriodsStub:
    records: list[UnavailablePeriod]

    async def list_periods(self, account_id: UUID) -> list[UnavailablePeriod]:
        return self.records


@dataclass
class PreferencesStub:
    record: StudyPreferences | None

    async def get(self, account_id: UUID) -> StudyPreferences | None:
        return self.record


@dataclass
class ProposalsStub:
    replacements: list[tuple[UUID, NewScheduleProposal]]

    async def replace(self, account_id: UUID, proposal: NewScheduleProposal):  # type: ignore[no-untyped-def]
        self.replacements.append((account_id, proposal))
        return None

    async def get(self, account_id: UUID):  # type: ignore[no-untyped-def]
        return None

    async def reject(self, account_id: UUID, proposal_id: UUID) -> bool:
        return False


def _task(deadline: datetime) -> AcademicTaskRecord:
    created_at = datetime(2026, 8, 20, tzinfo=UTC)
    return AcademicTaskRecord(
        id=TASK_ID,
        account_id=ACCOUNT_ID,
        title="Exam",
        category=TaskCategory.EXAM_PREPARATION,
        priority=TaskPriority.HIGH,
        course=None,
        notes=None,
        deadline_at=deadline,
        original_estimate_minutes=60,
        planned_duration_minutes=60,
        created_at=created_at,
        updated_at=created_at,
        status=TaskStatus.NOT_STARTED,
    )


def _inputs() -> tuple[
    list[AcademicTaskRecord],
    list[AvailabilityWindow],
    list[UnavailablePeriod],
    StudyPreferences,
]:
    tasks = [_task(datetime(2026, 8, 26, 12, 0, 30, tzinfo=UTC))]
    windows = [AvailabilityWindow(uuid4(), 0, time(9), time(12), False)]
    periods = [
        UnavailablePeriod(
            uuid4(),
            datetime(2026, 8, 25, 10, tzinfo=UTC),
            datetime(2026, 8, 25, 11, tzinfo=UTC),
            "Appointment",
        )
    ]
    return tasks, windows, periods, StudyPreferences("UTC", 60, 10, False)


def test_fingerprint_is_deterministic_and_covers_scheduling_fields() -> None:
    tasks, windows, periods, preferences = _inputs()
    baseline = schedule_input_fingerprint(tasks, windows, periods, preferences)

    assert len(baseline) == 64
    assert set(baseline) <= set("0123456789abcdef")
    assert baseline == schedule_input_fingerprint(
        list(reversed(tasks)), list(reversed(windows)), list(reversed(periods)), preferences
    )
    variants = [
        schedule_input_fingerprint(
            [replace(tasks[0], planned_duration_minutes=90)], windows, periods, preferences
        ),
        schedule_input_fingerprint(
            tasks, windows, periods, replace(preferences, minimum_break_minutes=15)
        ),
        schedule_input_fingerprint(tasks, [replace(windows[0], weekday=1)], periods, preferences),
        schedule_input_fingerprint(
            tasks,
            windows,
            [replace(periods[0], ends_at=periods[0].ends_at + timedelta(minutes=30))],
            preferences,
        ),
    ]
    assert all(value != baseline for value in variants)


@pytest.mark.anyio
async def test_generate_maps_solver_output_and_preserves_exact_deadline() -> None:
    tasks, windows, periods, preferences = _inputs()
    repository = ProposalsStub([])
    start_minute = int(
        (datetime(2026, 8, 25, 9, tzinfo=UTC) - datetime(1970, 1, 1, tzinfo=UTC))
        / timedelta(minutes=1)
    )
    result = OverloadResult(
        KernelStatus.OVERLOAD,
        (
            ScheduledSession("later", str(TASK_ID), start_minute + 60, start_minute + 90),
            ScheduledSession("earlier", str(TASK_ID), start_minute, start_minute + 30),
        ),
        (
            TaskAllocation(
                str(TASK_ID),
                start_minute + 1_000,
                90,
                60,
                30,
                120,
                60,
                30,
            ),
        ),
        SolverDiagnostics("OPTIMAL", 0.1, 0, 0),
    )
    service = ScheduleGenerationService(
        cast(AcademicTasks, TasksStub(tasks)),
        cast(AvailabilityWindows, WindowsStub(windows)),
        cast(UnavailablePeriods, PeriodsStub(periods)),
        cast(AccountPreferences, PreferencesStub(preferences)),
        cast(ScheduleProposalRepository, repository),
        clock=lambda: datetime(2026, 8, 24, tzinfo=UTC),
        solver=lambda problem: result,
    )

    assert (
        await service.generate(
            ACCOUNT_ID,
            kind=ProposalKind.REVISION,
            revision_reason="Missed session",
        )
        is None
    )
    proposal = repository.replacements[0][1]
    assert proposal.kind is ProposalKind.REVISION
    assert proposal.revision_reason == "Missed session"
    assert proposal.status is ProposalStatus.OVERLOAD
    assert proposal.input_fingerprint == schedule_input_fingerprint(
        tasks, windows, periods, preferences
    )
    assert [item.starts_at for item in proposal.sessions] == [
        datetime(2026, 8, 25, 9, tzinfo=UTC),
        datetime(2026, 8, 25, 10, tzinfo=UTC),
    ]
    assert proposal.allocations[0].deadline_at == tasks[0].deadline_at
    assert proposal.allocations[0].unscheduled_minutes == 30


@pytest.mark.anyio
async def test_technical_failure_never_replaces_existing_proposal() -> None:
    tasks, windows, periods, preferences = _inputs()
    repository = ProposalsStub([])
    failure = OverloadResult(
        KernelStatus.TECHNICAL_FAILURE,
        (),
        (),
        SolverDiagnostics("UNKNOWN", 4.0, 0, 0),
        "Solver timed out",
    )
    service = ScheduleGenerationService(
        cast(AcademicTasks, TasksStub(tasks)),
        cast(AvailabilityWindows, WindowsStub(windows)),
        cast(UnavailablePeriods, PeriodsStub(periods)),
        cast(AccountPreferences, PreferencesStub(preferences)),
        cast(ScheduleProposalRepository, repository),
        solver=lambda problem: failure,
    )

    with pytest.raises(ScheduleGenerationFailedError, match="timed out"):
        await service.generate(ACCOUNT_ID)
    assert repository.replacements == []


@pytest.mark.anyio
async def test_missing_account_returns_none_before_loading_other_inputs() -> None:
    service = ScheduleGenerationService(
        cast(AcademicTasks, TasksStub([])),
        cast(AvailabilityWindows, WindowsStub([])),
        cast(UnavailablePeriods, PeriodsStub([])),
        cast(AccountPreferences, PreferencesStub(None)),
        cast(ScheduleProposalRepository, ProposalsStub([])),
    )

    assert await service.generate(ACCOUNT_ID) is None


def test_app_exposes_injected_schedule_generation_service() -> None:
    injected = cast(ScheduleGeneration, object())
    application = create_app(schedule_generation=injected)

    assert application.state.schedule_generation is injected


def test_utc_text_validates_timezone() -> None:
    naive_dt = datetime(2026, 8, 25, 10, 0)
    with pytest.raises(ValueError, match="timezone-aware"):
        _utc_text(naive_dt)


def test_preview_record_unit_and_simulate() -> None:
    session = NewProposedSession(
        task_id=TASK_ID,
        starts_at=datetime(2026, 8, 25, 9, 0, tzinfo=UTC),
        ends_at=datetime(2026, 8, 25, 10, 0, tzinfo=UTC),
        planned_duration_minutes=60,
    )
    allocation = NewTaskAllocation(
        task_id=TASK_ID,
        deadline_at=datetime(2026, 8, 26, 12, 0, tzinfo=UTC),
        required_minutes=60,
        scheduled_minutes=60,
        unscheduled_minutes=0,
        raw_calendar_capacity_minutes=180,
        available_minutes_before_deadline=180,
        shortfall_minutes=0,
    )
    proposal = NewScheduleProposal(
        kind=ProposalKind.GENERATION,
        revision_reason=None,
        status=ProposalStatus.FEASIBLE,
        input_fingerprint="f" * 64,
        sessions=(session,),
        allocations=(allocation,),
    )
    created_at = datetime(2026, 8, 24, 12, 0, tzinfo=UTC)
    preview = ScheduleGenerationService._preview_record(ACCOUNT_ID, proposal, created_at)

    assert isinstance(preview.id, UUID)
    assert preview.account_id == ACCOUNT_ID
    assert preview.kind is ProposalKind.GENERATION
    assert preview.status is ProposalStatus.FEASIBLE
    assert preview.created_at == created_at
    assert len(preview.sessions) == 1
    assert preview.sessions[0].proposal_id == preview.id
    assert preview.sessions[0].task_id == TASK_ID
    assert len(preview.allocations) == 1
    assert preview.allocations[0].proposal_id == preview.id
    assert preview.allocations[0].task_id == TASK_ID


@pytest.mark.anyio
async def test_simulate_does_not_persist_proposal() -> None:
    tasks, windows, periods, preferences = _inputs()
    repository = ProposalsStub([])
    result = OverloadResult(
        KernelStatus.FEASIBLE,
        (ScheduledSession("0", str(TASK_ID), 0, 60),),
        (TaskAllocation(str(TASK_ID), 100, 60, 60, 0, 180, 180, 0),),
        SolverDiagnostics("OPTIMAL", 0.1, 10, 5),
        None,
    )
    service = ScheduleGenerationService(
        cast(AcademicTasks, TasksStub(tasks)),
        cast(AvailabilityWindows, WindowsStub(windows)),
        cast(UnavailablePeriods, PeriodsStub(periods)),
        cast(AccountPreferences, PreferencesStub(preferences)),
        cast(ScheduleProposalRepository, repository),
        clock=lambda: datetime(2026, 8, 24, tzinfo=UTC),
        solver=lambda problem: result,
    )

    scenario = ScheduleScenario()
    preview = await service.simulate(ACCOUNT_ID, scenario)
    assert preview is not None
    assert preview.status is ProposalStatus.FEASIBLE
    assert repository.replacements == []  # not persisted!


@pytest.mark.anyio
async def test_apply_deadline_overrides_validation() -> None:
    tasks, windows, periods, preferences = _inputs()
    repository = ProposalsStub([])
    service = ScheduleGenerationService(
        cast(AcademicTasks, TasksStub(tasks)),
        cast(AvailabilityWindows, WindowsStub(windows)),
        cast(UnavailablePeriods, PeriodsStub(periods)),
        cast(AccountPreferences, PreferencesStub(preferences)),
        cast(ScheduleProposalRepository, repository),
        clock=lambda: datetime(2026, 8, 24, tzinfo=UTC),
    )

    # 1. Unknown task id
    unknown_id = uuid4()
    scenario_unknown = ScheduleScenario(
        deadline_overrides=(
            ScenarioDeadlineOverride(unknown_id, datetime(2026, 8, 28, tzinfo=UTC)),
        )
    )
    with pytest.raises(ScenarioValidationError, match="Scenario contains unknown task id"):
        await service.generate(ACCOUNT_ID, scenario=scenario_unknown)

    # 2. Past deadline override
    scenario_past = ScheduleScenario(
        deadline_overrides=(ScenarioDeadlineOverride(TASK_ID, datetime(2026, 8, 20, tzinfo=UTC)),)
    )
    with pytest.raises(ScenarioValidationError, match="must be in the future"):
        await service.generate(ACCOUNT_ID, scenario=scenario_past)

    # 3. Valid future deadline override
    new_deadline = datetime(2026, 8, 28, 12, 0, tzinfo=UTC)
    scenario_valid = ScheduleScenario(
        deadline_overrides=(ScenarioDeadlineOverride(TASK_ID, new_deadline),)
    )
    result = OverloadResult(
        KernelStatus.FEASIBLE,
        (ScheduledSession("0", str(TASK_ID), 0, 60),),
        (TaskAllocation(str(TASK_ID), 100, 60, 60, 0, 180, 180, 0),),
        SolverDiagnostics("OPTIMAL", 0.1, 10, 5),
        None,
    )
    service_valid = ScheduleGenerationService(
        cast(AcademicTasks, TasksStub(tasks)),
        cast(AvailabilityWindows, WindowsStub(windows)),
        cast(UnavailablePeriods, PeriodsStub(periods)),
        cast(AccountPreferences, PreferencesStub(preferences)),
        cast(ScheduleProposalRepository, repository),
        clock=lambda: datetime(2026, 8, 24, tzinfo=UTC),
        solver=lambda problem: result,
    )
    await service_valid.generate(ACCOUNT_ID, scenario=scenario_valid)
    proposal = repository.replacements[-1][1]
    assert proposal.allocations[0].deadline_at == new_deadline


@pytest.mark.anyio
async def test_overdue_work_converts_feasible_to_overload() -> None:
    future_task = _task(datetime(2026, 8, 26, 12, tzinfo=UTC))
    overdue_task_id = uuid4()
    overdue_task = replace(
        future_task,
        id=overdue_task_id,
        deadline_at=datetime(2026, 8, 20, tzinfo=UTC),  # past deadline
        planned_duration_minutes=45,
    )
    tasks = [future_task, overdue_task]
    _, windows, periods, preferences = _inputs()
    repository = ProposalsStub([])

    result = OverloadResult(
        KernelStatus.FEASIBLE,
        (ScheduledSession("0", str(future_task.id), 0, 60),),
        (TaskAllocation(str(future_task.id), 100, 60, 60, 0, 180, 180, 0),),
        SolverDiagnostics("OPTIMAL", 0.1, 10, 5),
        None,
    )
    service = ScheduleGenerationService(
        cast(AcademicTasks, TasksStub(tasks)),
        cast(AvailabilityWindows, WindowsStub(windows)),
        cast(UnavailablePeriods, PeriodsStub(periods)),
        cast(AccountPreferences, PreferencesStub(preferences)),
        cast(ScheduleProposalRepository, repository),
        clock=lambda: datetime(2026, 8, 24, tzinfo=UTC),
        solver=lambda problem: result,
    )

    await service.generate(ACCOUNT_ID)
    proposal = repository.replacements[0][1]
    assert proposal.status is ProposalStatus.OVERLOAD
    allocations_by_task = {a.task_id: a for a in proposal.allocations}
    assert overdue_task_id in allocations_by_task
    overdue_alloc = allocations_by_task[overdue_task_id]
    assert overdue_alloc.required_minutes == 45
    assert overdue_alloc.scheduled_minutes == 0
    assert overdue_alloc.unscheduled_minutes == 45
    assert overdue_alloc.shortfall_minutes == 45


@pytest.mark.anyio
async def test_overdue_work_ignored_if_completed_or_overridden() -> None:
    future_task = _task(datetime(2026, 8, 26, 12, tzinfo=UTC))
    completed_overdue_id = uuid4()
    completed_overdue = replace(
        future_task,
        id=completed_overdue_id,
        deadline_at=datetime(2026, 8, 20, tzinfo=UTC),
        status=TaskStatus.COMPLETED,
    )
    tasks = [future_task, completed_overdue]
    _, windows, periods, preferences = _inputs()
    repository = ProposalsStub([])

    result = OverloadResult(
        KernelStatus.FEASIBLE,
        (ScheduledSession("0", str(future_task.id), 0, 60),),
        (TaskAllocation(str(future_task.id), 100, 60, 60, 0, 180, 180, 0),),
        SolverDiagnostics("OPTIMAL", 0.1, 10, 5),
        None,
    )
    service = ScheduleGenerationService(
        cast(AcademicTasks, TasksStub(tasks)),
        cast(AvailabilityWindows, WindowsStub(windows)),
        cast(UnavailablePeriods, PeriodsStub(periods)),
        cast(AccountPreferences, PreferencesStub(preferences)),
        cast(ScheduleProposalRepository, repository),
        clock=lambda: datetime(2026, 8, 24, tzinfo=UTC),
        solver=lambda problem: result,
    )

    await service.generate(ACCOUNT_ID)
    proposal = repository.replacements[0][1]
    assert proposal.status is ProposalStatus.FEASIBLE
    assert len(proposal.allocations) == 1
    assert proposal.allocations[0].task_id == future_task.id


@pytest.mark.anyio
async def test_proposal_draft_rejects_unknown_task_from_solver() -> None:
    tasks, windows, periods, preferences = _inputs()
    repository = ProposalsStub([])
    unknown_task_id = str(uuid4())
    result = OverloadResult(
        KernelStatus.FEASIBLE,
        (ScheduledSession("0", unknown_task_id, 0, 60),),
        (TaskAllocation(unknown_task_id, 100, 60, 60, 0, 180, 180, 0),),
        SolverDiagnostics("OPTIMAL", 0.1, 10, 5),
        None,
    )
    service = ScheduleGenerationService(
        cast(AcademicTasks, TasksStub(tasks)),
        cast(AvailabilityWindows, WindowsStub(windows)),
        cast(UnavailablePeriods, PeriodsStub(periods)),
        cast(AccountPreferences, PreferencesStub(preferences)),
        cast(ScheduleProposalRepository, repository),
        clock=lambda: datetime(2026, 8, 24, tzinfo=UTC),
        solver=lambda problem: result,
    )

    with pytest.raises(ScheduleGenerationFailedError, match="unknown task"):
        await service.generate(ACCOUNT_ID)


@pytest.mark.anyio
async def test_generate_with_study_sessions_and_scenario() -> None:
    from studyflow.scheduling.outcomes import StudySessions
    from studyflow.scheduling.scenarios import ScenarioAvailabilityWindow

    class StudySessionsStub:
        async def task_schedule_adjustments(self, account_id: UUID) -> dict[UUID, int]:
            return {TASK_ID: 15}

    tasks, windows, periods, preferences = _inputs()
    repository = ProposalsStub([])
    result = OverloadResult(
        KernelStatus.FEASIBLE,
        (ScheduledSession("0", str(TASK_ID), 0, 45),),
        (TaskAllocation(str(TASK_ID), 100, 45, 45, 0, 180, 180, 0),),
        SolverDiagnostics("OPTIMAL", 0.1, 10, 5),
        None,
    )
    service = ScheduleGenerationService(
        cast(AcademicTasks, TasksStub(tasks)),
        cast(AvailabilityWindows, WindowsStub(windows)),
        cast(UnavailablePeriods, PeriodsStub(periods)),
        cast(AccountPreferences, PreferencesStub(preferences)),
        cast(ScheduleProposalRepository, repository),
        study_sessions=cast(StudySessions, StudySessionsStub()),
        clock=lambda: datetime(2026, 8, 24, tzinfo=UTC),
        solver=lambda problem: result,
    )

    scenario = ScheduleScenario(
        temporary_availability=(
            ScenarioAvailabilityWindow(
                datetime(2026, 8, 25, 14, 0, tzinfo=UTC),
                datetime(2026, 8, 25, 16, 0, tzinfo=UTC),
            ),
        )
    )
    await service.generate(ACCOUNT_ID, scenario=scenario)
    proposal = repository.replacements[0][1]
    assert proposal.scenario is not None
    assert proposal.allocations[0].required_minutes == 45
