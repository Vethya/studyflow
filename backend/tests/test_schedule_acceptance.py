from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import cast
from uuid import UUID, uuid4

import pytest

from studyflow.accounts.preferences import AccountPreferences, StudyPreferences
from studyflow.availability.unavailable import UnavailablePeriods
from studyflow.availability.windows import AvailabilityWindows
from studyflow.scheduling import (
    ProposalKind,
    ProposalStatus,
    ScheduleAcceptanceService,
    StaleScheduleProposalError,
    schedule_input_fingerprint,
)
from studyflow.scheduling.outcomes import StudySessions
from studyflow.scheduling.proposals import (
    ScheduleProposalRecord,
    ScheduleProposalRepository,
    StudySessionRecord,
)
from studyflow.scheduling.recovery import (
    InvalidRecoveryTriggerError,
    PersistedRecoverySnapshot,
    RecoverySnapshot,
    RecoverySnapshotRepository,
    recovery_input_fingerprint,
)
from studyflow.scheduling.scenarios import ScheduleScenario
from studyflow.tasks.service import (
    AcademicTaskRecord,
    AcademicTasks,
    TaskCategory,
    TaskPriority,
    TaskStatus,
)

ACCOUNT_ID = UUID("00000000-0000-0000-0000-000000000001")


class TasksStub:
    def __init__(self, tasks: list[AcademicTaskRecord] | None = None) -> None:
        self.tasks = tasks or []

    async def list(self, account_id: UUID, filters: object = None) -> list[AcademicTaskRecord]:
        return self.tasks


class WindowsStub:
    async def list_windows(self, account_id: UUID):  # type: ignore[no-untyped-def]
        return []


class PeriodsStub:
    async def list_periods(self, account_id: UUID):  # type: ignore[no-untyped-def]
        return []


@dataclass
class PreferencesStub:
    value: StudyPreferences | None

    async def get(self, account_id: UUID) -> StudyPreferences | None:
        return self.value


@dataclass
class RepositoryStub:
    proposal: ScheduleProposalRecord | None
    accept_calls: list[tuple[UUID, UUID, datetime, int]] = field(default_factory=list)
    reject_calls: list[tuple[UUID, UUID]] = field(default_factory=list)

    @property
    def proposal_id(self) -> UUID:
        assert self.proposal is not None
        return self.proposal.id

    async def get(self, account_id: UUID) -> ScheduleProposalRecord | None:
        return self.proposal

    async def accept(
        self,
        account_id: UUID,
        proposal_id: UUID,
        now: datetime,
        minimum_break_minutes: int,
        grace_period: timedelta = timedelta(seconds=0),
    ) -> tuple[StudySessionRecord, ...]:
        self.accept_calls.append((account_id, proposal_id, now, minimum_break_minutes))
        return ()

    async def reject(self, account_id: UUID, proposal_id: UUID) -> bool:
        self.reject_calls.append((account_id, proposal_id))
        return True


class RecoverySnapshotsStub:
    def __init__(
        self,
        persisted: PersistedRecoverySnapshot | None = None,
        snapshot: RecoverySnapshot | None = None,
        *,
        raise_invalid_trigger: bool = False,
    ) -> None:
        self.persisted = persisted
        self.snapshot = snapshot
        self.raise_invalid_trigger = raise_invalid_trigger

    async def get(self, account_id: UUID, proposal_id: UUID) -> PersistedRecoverySnapshot | None:
        return self.persisted

    async def capture(
        self,
        account_id: UUID,
        missed_session_id: UUID,
        now: datetime,
        minimum_break_minutes: int,
    ) -> RecoverySnapshot | None:
        if self.raise_invalid_trigger:
            raise InvalidRecoveryTriggerError("Invalid trigger session")
        return self.snapshot


class StudySessionsStub:
    def __init__(self, adjustments: dict[UUID, int] | None = None) -> None:
        self.adjustments = adjustments or {}

    async def task_schedule_adjustments(self, account_id: UUID) -> dict[UUID, int]:
        return self.adjustments


def _service(
    preferences: StudyPreferences | None,
    fingerprint: str,
    *,
    kind: ProposalKind = ProposalKind.GENERATION,
    clock: Callable[[], datetime] = lambda: datetime(2026, 8, 25, tzinfo=UTC),
    proposal: ScheduleProposalRecord | None = None,
    tasks: list[AcademicTaskRecord] | None = None,
    recovery_snapshots: RecoverySnapshotRepository | None = None,
    study_sessions: StudySessions | None = None,
) -> tuple[ScheduleAcceptanceService, RepositoryStub]:
    if proposal is None:
        proposal = ScheduleProposalRecord(
            uuid4(),
            ACCOUNT_ID,
            kind,
            "Manual revision" if kind is ProposalKind.REVISION else None,
            ProposalStatus.FEASIBLE,
            fingerprint,
            datetime(2026, 8, 24, tzinfo=UTC),
            (),
            (),
        )
    repository = RepositoryStub(proposal, [])
    service = ScheduleAcceptanceService(
        cast(AcademicTasks, TasksStub(tasks)),
        cast(AvailabilityWindows, WindowsStub()),
        cast(UnavailablePeriods, PeriodsStub()),
        cast(AccountPreferences, PreferencesStub(preferences)),
        cast(ScheduleProposalRepository, repository),
        recovery_snapshots=recovery_snapshots,
        study_sessions=study_sessions,
        clock=clock,
    )
    return service, repository


@pytest.mark.anyio
async def test_accept_recomputes_fingerprint_before_repository_mutation() -> None:
    preferences = StudyPreferences("UTC", 60, 10, False)
    fingerprint = schedule_input_fingerprint([], [], [], preferences)
    service, repository = _service(preferences, fingerprint)

    assert await service.accept(ACCOUNT_ID, repository.proposal_id) == ()
    assert repository.accept_calls == [
        (
            ACCOUNT_ID,
            repository.proposal_id,
            datetime(2026, 8, 25, tzinfo=UTC),
            10,
        )
    ]


@pytest.mark.anyio
async def test_ordinary_revision_without_recovery_snapshot_uses_schedule_fingerprint() -> None:
    preferences = StudyPreferences("UTC", 60, 10, False)
    fingerprint = schedule_input_fingerprint([], [], [], preferences)
    service, repository = _service(preferences, fingerprint, kind=ProposalKind.REVISION)

    assert await service.accept(ACCOUNT_ID, repository.proposal_id) == ()
    assert len(repository.accept_calls) == 1


@pytest.mark.anyio
async def test_accept_refreshes_clock_immediately_before_repository_mutation() -> None:
    preferences = StudyPreferences("UTC", 60, 10, False)
    fingerprint = schedule_input_fingerprint([], [], [], preferences)
    validation_now = datetime(2026, 8, 25, 10, tzinfo=UTC)
    mutation_now = datetime(2026, 8, 25, 10, 1, tzinfo=UTC)
    clock_values = iter((validation_now, mutation_now))
    service, repository = _service(
        preferences,
        fingerprint,
        clock=lambda: next(clock_values),
    )

    assert await service.accept(ACCOUNT_ID, repository.proposal_id) == ()
    assert repository.accept_calls == [(ACCOUNT_ID, repository.proposal_id, mutation_now, 10)]


@pytest.mark.anyio
async def test_accept_rejects_stale_proposal_before_repository_mutation() -> None:
    preferences = StudyPreferences("UTC", 60, 10, False)
    service, repository = _service(preferences, "a" * 64)

    with pytest.raises(StaleScheduleProposalError, match="changed"):
        await service.accept(ACCOUNT_ID, repository.proposal_id)
    assert repository.accept_calls == []


@pytest.mark.anyio
async def test_accept_returns_none_when_proposal_not_found_or_id_mismatch() -> None:
    preferences = StudyPreferences("UTC", 60, 10, False)
    fingerprint = schedule_input_fingerprint([], [], [], preferences)

    # 1. Proposal is None
    service_none, _ = _service(preferences, fingerprint)
    service_none._proposals.proposal = None  # type: ignore[attr-defined]
    assert await service_none.accept(ACCOUNT_ID, uuid4()) is None

    # 2. Proposal ID mismatch
    service_mismatch, repo = _service(preferences, fingerprint)
    assert await service_mismatch.accept(ACCOUNT_ID, uuid4()) is None
    assert repo.accept_calls == []


@pytest.mark.anyio
async def test_accept_returns_none_when_preferences_not_found() -> None:
    fingerprint = "a" * 64
    service, repo = _service(None, fingerprint)
    assert await service.accept(ACCOUNT_ID, repo.proposal_id) is None
    assert repo.accept_calls == []


def _task_record(
    task_id: UUID,
    deadline_at: datetime,
    *,
    planned_duration_minutes: int = 60,
    status: TaskStatus = TaskStatus.NOT_STARTED,
) -> AcademicTaskRecord:
    now = datetime(2026, 1, 1, tzinfo=UTC)
    return AcademicTaskRecord(
        id=task_id,
        account_id=ACCOUNT_ID,
        title=f"Task {task_id}",
        category=TaskCategory.ASSIGNMENT,
        priority=TaskPriority.MEDIUM,
        course=None,
        notes=None,
        deadline_at=deadline_at,
        original_estimate_minutes=planned_duration_minutes,
        planned_duration_minutes=planned_duration_minutes,
        created_at=now,
        updated_at=now,
        status=status,
    )


@pytest.mark.anyio
async def test_accept_rejects_when_scenario_session_exceeds_task_deadline() -> None:
    preferences = StudyPreferences("UTC", 60, 10, False)
    task_id = uuid4()
    task_deadline = datetime(2026, 8, 25, 10, 0, tzinfo=UTC)
    task = _task_record(task_id, task_deadline)

    scenario = ScheduleScenario(
        deadline_overrides=(),
        temporary_availability=(),
        temporary_blocked_periods=(),
    )

    # Case 1: Session ends after task deadline
    session_past_deadline = StudySessionRecord(
        id=uuid4(),
        account_id=ACCOUNT_ID,
        task_id=task_id,
        proposal_id=None,
        starts_at=datetime(2026, 8, 25, 9, 30, tzinfo=UTC),
        ends_at=datetime(2026, 8, 25, 10, 30, tzinfo=UTC),
        planned_duration_minutes=60,
    )
    proposal_past_deadline = ScheduleProposalRecord(
        uuid4(),
        ACCOUNT_ID,
        ProposalKind.GENERATION,
        None,
        ProposalStatus.FEASIBLE,
        "a" * 64,
        datetime(2026, 8, 24, tzinfo=UTC),
        (session_past_deadline,),
        (),
        scenario=scenario,
    )
    service_past, _ = _service(preferences, "a" * 64, proposal=proposal_past_deadline, tasks=[task])
    with pytest.raises(StaleScheduleProposalError, match="exceeds a task's current deadline"):
        await service_past.accept(ACCOUNT_ID, proposal_past_deadline.id)

    # Case 2: Session's task not found in tasks list
    session_unknown_task = StudySessionRecord(
        id=uuid4(),
        account_id=ACCOUNT_ID,
        task_id=uuid4(),
        proposal_id=None,
        starts_at=datetime(2026, 8, 25, 8, 0, tzinfo=UTC),
        ends_at=datetime(2026, 8, 25, 9, 0, tzinfo=UTC),
        planned_duration_minutes=60,
    )
    proposal_unknown = ScheduleProposalRecord(
        uuid4(),
        ACCOUNT_ID,
        ProposalKind.GENERATION,
        None,
        ProposalStatus.FEASIBLE,
        "a" * 64,
        datetime(2026, 8, 24, tzinfo=UTC),
        (session_unknown_task,),
        (),
        scenario=scenario,
    )
    service_unknown, _ = _service(preferences, "a" * 64, proposal=proposal_unknown, tasks=[task])
    with pytest.raises(StaleScheduleProposalError, match="exceeds a task's current deadline"):
        await service_unknown.accept(ACCOUNT_ID, proposal_unknown.id)


@pytest.mark.anyio
async def test_accept_succeeds_with_valid_scenario() -> None:
    preferences = StudyPreferences("UTC", 60, 10, False)
    task_id = uuid4()
    task_deadline = datetime(2026, 8, 25, 12, 0, tzinfo=UTC)
    task = _task_record(task_id, task_deadline)

    scenario = ScheduleScenario(
        deadline_overrides=(),
        temporary_availability=(),
        temporary_blocked_periods=(),
    )
    session_valid = StudySessionRecord(
        id=uuid4(),
        account_id=ACCOUNT_ID,
        task_id=task_id,
        proposal_id=None,
        starts_at=datetime(2026, 8, 25, 9, 0, tzinfo=UTC),
        ends_at=datetime(2026, 8, 25, 10, 0, tzinfo=UTC),
        planned_duration_minutes=60,
    )
    fingerprint = schedule_input_fingerprint([task], [], [], preferences, scenario=scenario)
    proposal_valid = ScheduleProposalRecord(
        uuid4(),
        ACCOUNT_ID,
        ProposalKind.GENERATION,
        None,
        ProposalStatus.FEASIBLE,
        fingerprint,
        datetime(2026, 8, 24, tzinfo=UTC),
        (session_valid,),
        (),
        scenario=scenario,
    )
    service, repo = _service(preferences, fingerprint, proposal=proposal_valid, tasks=[task])
    assert await service.accept(ACCOUNT_ID, proposal_valid.id) == ()
    assert len(repo.accept_calls) == 1


@pytest.mark.anyio
async def test_accept_with_recovery_snapshot_flows() -> None:
    preferences = StudyPreferences("UTC", 60, 10, False)
    proposal_id = uuid4()
    missed_session_id = uuid4()
    persisted = PersistedRecoverySnapshot(
        proposal_id=proposal_id,
        account_id=ACCOUNT_ID,
        missed_session_id=missed_session_id,
        captured_at=datetime(2026, 8, 24, 12, tzinfo=UTC),
        unfinished_work=(),
        unresolved_outcome_ids=(),
    )

    # 1. capture raises InvalidRecoveryTriggerError
    snapshots_invalid = RecoverySnapshotsStub(persisted=persisted, raise_invalid_trigger=True)
    service_invalid, repo_invalid = _service(
        preferences,
        "a" * 64,
        recovery_snapshots=cast(RecoverySnapshotRepository, snapshots_invalid),
    )
    repo_invalid.proposal = ScheduleProposalRecord(
        proposal_id,
        ACCOUNT_ID,
        ProposalKind.REVISION,
        "Recovery",
        ProposalStatus.FEASIBLE,
        "a" * 64,
        datetime(2026, 8, 24, tzinfo=UTC),
        (),
        (),
    )
    with pytest.raises(StaleScheduleProposalError, match="Recovery inputs changed"):
        await service_invalid.accept(ACCOUNT_ID, proposal_id)

    # 2. capture returns None
    snapshots_none = RecoverySnapshotsStub(persisted=persisted, snapshot=None)
    service_none, repo_none = _service(
        preferences,
        "a" * 64,
        recovery_snapshots=cast(RecoverySnapshotRepository, snapshots_none),
    )
    repo_none.proposal = repo_invalid.proposal
    with pytest.raises(StaleScheduleProposalError, match="Recovery inputs changed"):
        await service_none.accept(ACCOUNT_ID, proposal_id)

    # 3. capture returns valid snapshot and matching fingerprint -> success
    valid_snapshot = RecoverySnapshot(
        missed_session_id=missed_session_id,
        captured_at=datetime(2026, 8, 25, 10, tzinfo=UTC),
        unfinished_work=(),
        active_future_sessions=(),
        preserved_busy_sessions=(),
        unresolved_outcomes=(),
    )
    correct_fingerprint = recovery_input_fingerprint([], [], [], preferences, valid_snapshot)
    snapshots_ok = RecoverySnapshotsStub(persisted=persisted, snapshot=valid_snapshot)
    service_ok, repo_ok = _service(
        preferences,
        correct_fingerprint,
        recovery_snapshots=cast(RecoverySnapshotRepository, snapshots_ok),
    )
    repo_ok.proposal = ScheduleProposalRecord(
        proposal_id,
        ACCOUNT_ID,
        ProposalKind.REVISION,
        "Recovery",
        ProposalStatus.FEASIBLE,
        correct_fingerprint,
        datetime(2026, 8, 24, tzinfo=UTC),
        (),
        (),
    )
    assert await service_ok.accept(ACCOUNT_ID, proposal_id) == ()
    assert len(repo_ok.accept_calls) == 1


@pytest.mark.anyio
async def test_accept_with_study_sessions_adjustments() -> None:
    from dataclasses import replace

    preferences = StudyPreferences("UTC", 60, 10, False)
    task_id = uuid4()
    original_task = _task_record(
        task_id,
        datetime(2026, 8, 26, tzinfo=UTC),
        planned_duration_minutes=60,
    )
    study_sessions = StudySessionsStub(adjustments={task_id: 20})
    adjusted_task = replace(original_task, planned_duration_minutes=40)
    adjusted_fingerprint = schedule_input_fingerprint([adjusted_task], [], [], preferences)

    service, repo = _service(
        preferences,
        adjusted_fingerprint,
        tasks=[original_task],
        study_sessions=cast(StudySessions, study_sessions),
    )
    assert await service.accept(ACCOUNT_ID, repo.proposal_id) == ()
    assert len(repo.accept_calls) == 1


@pytest.mark.anyio
async def test_reject_delegates_to_repository() -> None:
    preferences = StudyPreferences("UTC", 60, 10, False)
    service, repo = _service(preferences, "a" * 64)
    proposal_id = uuid4()
    result = await service.reject(ACCOUNT_ID, proposal_id)
    assert result is True
    assert repo.reject_calls == [(ACCOUNT_ID, proposal_id)]
