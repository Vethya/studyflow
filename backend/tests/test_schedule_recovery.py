from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, time, timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select

from studyflow.accounts.preferences import StudyPreferencesService
from studyflow.accounts.repositories import SqlAlchemyStudyPreferencesRepository
from studyflow.availability.repositories import (
    NoFutureSessions,
    SqlAlchemyAvailabilityWindowRepository,
    SqlAlchemyFutureSessionInvalidator,
    SqlAlchemyUnavailablePeriodRepository,
)
from studyflow.availability.unavailable import UnavailablePeriodService
from studyflow.availability.windows import AvailabilityWindowDraft, AvailabilityWindowService
from studyflow.database import Base, Database
from studyflow.database.models import (
    AcademicTask,
    RecoveryTaskWork,
    ScheduleProposal,
    StudentAccount,
)
from studyflow.database.models import ScheduleRecoverySnapshot as SnapshotRow
from studyflow.database.models import StudySession as SessionRow
from studyflow.database.models import StudySessionOutcome as OutcomeRow
from studyflow.scheduling import (
    InvalidRecoveryTriggerError,
    KernelStatus,
    ProposalKind,
    ProposalStatus,
    ScheduleGenerationFailedError,
    SolverDiagnostics,
)
from studyflow.scheduling.contracts import FeasibilityProblem, OverloadResult
from studyflow.scheduling.overload import solve_with_overload
from studyflow.scheduling.recovery import MISSED_REVISION_REASON, ScheduleRecoveryService
from studyflow.scheduling.recovery_repositories import (
    SqlAlchemyRecoverySnapshotRepository,
    SqlAlchemyTaskRecoveryProposalInvalidator,
)
from studyflow.scheduling.repositories import SqlAlchemyScheduleProposalRepository
from studyflow.tasks.repositories import SqlAlchemyAcademicTaskRepository
from studyflow.tasks.service import AcademicTaskService

NOW = datetime(2026, 8, 24, 12, tzinfo=UTC)


@dataclass(frozen=True)
class Harness:
    database: Database
    account_id: UUID
    task_id: UUID
    missed_session_id: UUID
    future_session_id: UUID
    recovery: ScheduleRecoveryService
    proposals: SqlAlchemyScheduleProposalRepository


async def _harness(
    *,
    deadline: datetime,
    future_minutes: int = 60,
    outcome_kind: str = "missed",
    windows: tuple[AvailabilityWindowDraft, ...] = (
        AvailabilityWindowDraft(0, time(13), time(18)),
    ),
    solver: Callable[[FeasibilityProblem], OverloadResult] | None = None,
    minimum_break_minutes: int = 0,
) -> Harness:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    account_id, task_id, missed_id, future_id = uuid4(), uuid4(), uuid4(), uuid4()
    async with database.transaction() as session:
        await session.run_sync(lambda sync: Base.metadata.create_all(sync.connection()))
        session.add_all(
            [
                StudentAccount(
                    id=account_id,
                    email="student@example.com",
                    name="Student",
                    password_hash="$argon2id$hash",
                    email_verified_at=NOW,
                    timezone="UTC",
                    availability_timezone_confirmed=True,
                ),
                AcademicTask(
                    id=task_id,
                    account_id=account_id,
                    title="Essay",
                    category="assignment",
                    priority="high",
                    deadline_at=deadline,
                    original_estimate_minutes=60,
                    planned_duration_minutes=60,
                ),
                SessionRow(
                    id=missed_id,
                    account_id=account_id,
                    task_id=task_id,
                    proposal_id=None,
                    starts_at=NOW - timedelta(hours=2),
                    ends_at=NOW - timedelta(hours=1),
                    planned_duration_minutes=60,
                ),
                OutcomeRow(
                    session_id=missed_id,
                    kind=outcome_kind,
                    actual_minutes=0,
                    remaining_minutes=60,
                    recorded_at=NOW - timedelta(minutes=30),
                    rescheduled_at=None,
                ),
            ]
        )
        if future_minutes:
            session.add(
                SessionRow(
                    id=future_id,
                    account_id=account_id,
                    task_id=task_id,
                    proposal_id=None,
                    starts_at=NOW + timedelta(hours=3),
                    ends_at=NOW + timedelta(hours=3, minutes=future_minutes),
                    planned_duration_minutes=future_minutes,
                )
            )
    tasks = AcademicTaskService(SqlAlchemyAcademicTaskRepository(database), clock=lambda: NOW)
    preferences = StudyPreferencesService(SqlAlchemyStudyPreferencesRepository(database))
    await preferences.update(account_id, "UTC", 60, minimum_break_minutes)
    availability = AvailabilityWindowService(SqlAlchemyAvailabilityWindowRepository(database))
    await availability.replace(account_id, list(windows))
    unavailable = UnavailablePeriodService(
        SqlAlchemyUnavailablePeriodRepository(database, NoFutureSessions()), clock=lambda: NOW
    )
    proposals = SqlAlchemyScheduleProposalRepository(database)
    recovery = ScheduleRecoveryService(
        tasks,
        availability,
        unavailable,
        preferences,
        SqlAlchemyRecoverySnapshotRepository(database),
        proposals,
        clock=lambda: NOW,
        solver=solver or solve_with_overload,
    )
    return Harness(database, account_id, task_id, missed_id, future_id, recovery, proposals)


@pytest.mark.anyio
async def test_recovery_counts_missed_and_future_work_once_and_leaves_active_schedule() -> None:
    harness = await _harness(deadline=NOW + timedelta(days=1))
    try:
        proposal = await harness.recovery.propose(harness.account_id, harness.missed_session_id)

        assert proposal is not None
        assert proposal.kind is ProposalKind.REVISION
        assert proposal.revision_reason == MISSED_REVISION_REASON
        assert proposal.status is ProposalStatus.FEASIBLE
        assert proposal.allocations[0].required_minutes == 120
        assert proposal.allocations[0].scheduled_minutes == 120
        async with harness.database.transaction() as session:
            active_ids = set(
                await session.scalars(select(SessionRow.id).where(SessionRow.proposal_id.is_(None)))
            )
            snapshot_work = await session.scalar(
                select(RecoveryTaskWork.unfinished_minutes).where(
                    RecoveryTaskWork.proposal_id == proposal.id,
                    RecoveryTaskWork.task_id == harness.task_id,
                )
            )
        assert active_ids == {harness.missed_session_id, harness.future_session_id}
        assert snapshot_work == 120
    finally:
        await harness.database.stop()


@pytest.mark.anyio
async def test_recovery_includes_invalidated_future_work_once() -> None:
    harness = await _harness(deadline=NOW + timedelta(days=1))
    try:
        async with harness.database.transaction() as session:
            invalidated = await SqlAlchemyFutureSessionInvalidator(
                clock=lambda: NOW
            ).remove_conflicting_future_sessions(
                session,
                harness.account_id,
                NOW + timedelta(hours=2),
                NOW + timedelta(hours=5),
            )
        assert invalidated == [harness.future_session_id]

        proposal = await harness.recovery.propose(
            harness.account_id,
            harness.missed_session_id,
        )

        assert proposal is not None
        assert proposal.allocations[0].required_minutes == 120
        assert proposal.allocations[0].scheduled_minutes == 120
        async with harness.database.transaction() as session:
            invalidated_session = await session.get(SessionRow, harness.future_session_id)
            invalidated_outcome = await session.get(OutcomeRow, harness.future_session_id)
        assert invalidated_session is not None
        assert invalidated_session.invalidated_at is not None
        assert invalidated_session.invalidated_at.replace(tzinfo=UTC) == NOW
        assert invalidated_outcome is not None
        assert invalidated_outcome.remaining_minutes == 60
    finally:
        await harness.database.stop()


@pytest.mark.anyio
async def test_recovery_preserves_break_after_in_progress_session() -> None:
    harness = await _harness(
        deadline=NOW + timedelta(days=1),
        windows=(AvailabilityWindowDraft(0, time(12), time(18)),),
        minimum_break_minutes=30,
    )
    in_progress_ends_at = NOW + timedelta(minutes=30)
    try:
        async with harness.database.transaction() as session:
            session.add(
                SessionRow(
                    id=uuid4(),
                    account_id=harness.account_id,
                    task_id=harness.task_id,
                    proposal_id=None,
                    starts_at=NOW - timedelta(minutes=15),
                    ends_at=in_progress_ends_at,
                    planned_duration_minutes=45,
                )
            )

        proposal = await harness.recovery.propose(
            harness.account_id,
            harness.missed_session_id,
        )

        assert proposal is not None
        assert proposal.status is ProposalStatus.FEASIBLE
        assert proposal.sessions
        assert min(item.starts_at for item in proposal.sessions) >= in_progress_ends_at + timedelta(
            minutes=30
        )
    finally:
        await harness.database.stop()


@pytest.mark.anyio
async def test_recovery_preserves_remaining_break_after_recent_session() -> None:
    harness = await _harness(
        deadline=NOW + timedelta(days=1),
        windows=(AvailabilityWindowDraft(0, time(12), time(18)),),
        minimum_break_minutes=30,
    )
    recent_session_id = uuid4()
    recent_session_ends_at = NOW - timedelta(minutes=10)
    try:
        async with harness.database.transaction() as session:
            session.add_all(
                [
                    SessionRow(
                        id=recent_session_id,
                        account_id=harness.account_id,
                        task_id=harness.task_id,
                        proposal_id=None,
                        starts_at=recent_session_ends_at - timedelta(minutes=45),
                        ends_at=recent_session_ends_at,
                        planned_duration_minutes=45,
                    ),
                    OutcomeRow(
                        session_id=recent_session_id,
                        kind="completed",
                        actual_minutes=45,
                        remaining_minutes=0,
                        recorded_at=NOW,
                        rescheduled_at=None,
                    ),
                ]
            )

        proposal = await harness.recovery.propose(
            harness.account_id,
            harness.missed_session_id,
        )

        assert proposal is not None
        assert proposal.status is ProposalStatus.FEASIBLE
        assert proposal.sessions
        assert min(
            item.starts_at for item in proposal.sessions
        ) >= recent_session_ends_at + timedelta(minutes=30)
    finally:
        await harness.database.stop()


@pytest.mark.anyio
async def test_recovery_reports_exact_overload_and_overdue_work() -> None:
    overload = await _harness(
        deadline=NOW + timedelta(hours=2),
        windows=(AvailabilityWindowDraft(0, time(13), time(14)),),
    )
    overdue = await _harness(deadline=NOW - timedelta(minutes=1), future_minutes=0, windows=())
    try:
        overload_proposal = await overload.recovery.propose(
            overload.account_id, overload.missed_session_id
        )
        assert overload_proposal is not None
        allocation = overload_proposal.allocations[0]
        assert overload_proposal.status is ProposalStatus.OVERLOAD
        assert (
            allocation.required_minutes,
            allocation.available_minutes_before_deadline,
            allocation.shortfall_minutes,
            allocation.unscheduled_minutes,
        ) == (120, 60, 60, 60)

        overdue_proposal = await overdue.recovery.propose(
            overdue.account_id, overdue.missed_session_id
        )
        assert overdue_proposal is not None
        allocation = overdue_proposal.allocations[0]
        assert overdue_proposal.status is ProposalStatus.OVERLOAD
        assert (
            allocation.required_minutes,
            allocation.available_minutes_before_deadline,
            allocation.shortfall_minutes,
            allocation.unscheduled_minutes,
        ) == (60, 0, 60, 60)
    finally:
        await overload.database.stop()
        await overdue.database.stop()


@pytest.mark.anyio
async def test_recovery_does_not_restore_completed_overdue_work() -> None:
    harness = await _harness(deadline=NOW - timedelta(minutes=1), future_minutes=0, windows=())
    try:
        async with harness.database.transaction() as session:
            task = await session.get(AcademicTask, harness.task_id)
            assert task is not None
            task.estimate_frozen_at = NOW - timedelta(hours=2)
            task.finished_early_at = NOW - timedelta(minutes=30)

        proposal = await harness.recovery.propose(
            harness.account_id,
            harness.missed_session_id,
        )

        assert proposal is not None
        assert proposal.status is ProposalStatus.FEASIBLE
        assert proposal.sessions == ()
        assert proposal.allocations == ()
    finally:
        await harness.database.stop()


@pytest.mark.anyio
async def test_task_deletion_invalidates_its_pending_recovery_proposal() -> None:
    harness = await _harness(deadline=NOW + timedelta(days=1))
    try:
        proposal = await harness.recovery.propose(harness.account_id, harness.missed_session_id)
        assert proposal is not None
        tasks = SqlAlchemyAcademicTaskRepository(
            harness.database,
            recovery_invalidator=SqlAlchemyTaskRecoveryProposalInvalidator(),
        )

        assert await tasks.delete(harness.account_id, harness.task_id)

        async with harness.database.transaction() as session:
            assert await session.get(AcademicTask, harness.task_id) is None
            assert await session.get(ScheduleProposal, proposal.id) is None
            assert await session.get(SnapshotRow, proposal.id) is None
            work_count = await session.scalar(select(func.count()).select_from(RecoveryTaskWork))
        assert work_count == 0
    finally:
        await harness.database.stop()


def test_recovery_snapshot_trigger_is_deleted_with_its_outcome() -> None:
    table = Base.metadata.tables["schedule_recovery_snapshots"]
    trigger_foreign_key = next(
        foreign_key
        for foreign_key in table.foreign_key_constraints
        if next(iter(foreign_key.columns)).name == "missed_session_id"
    )

    assert trigger_foreign_key.ondelete == "CASCADE"


@pytest.mark.anyio
async def test_recovery_owner_scopes_and_requires_unresolved_missed_trigger() -> None:
    harness = await _harness(deadline=NOW + timedelta(days=1), outcome_kind="completed")
    try:
        assert await harness.recovery.propose(uuid4(), harness.missed_session_id) is None
        with pytest.raises(InvalidRecoveryTriggerError):
            await harness.recovery.propose(harness.account_id, harness.missed_session_id)
        assert await harness.proposals.get(harness.account_id) is None
    finally:
        await harness.database.stop()


def _technical_failure(problem: FeasibilityProblem) -> OverloadResult:
    return OverloadResult(
        KernelStatus.TECHNICAL_FAILURE,
        (),
        (),
        SolverDiagnostics("UNKNOWN", 0, 0, 0),
        "Solver failed",
    )


@pytest.mark.anyio
async def test_recovery_technical_failure_persists_nothing() -> None:
    harness = await _harness(deadline=NOW + timedelta(days=1), solver=_technical_failure)
    try:
        with pytest.raises(ScheduleGenerationFailedError):
            await harness.recovery.propose(harness.account_id, harness.missed_session_id)
        assert await harness.proposals.get(harness.account_id) is None
        async with harness.database.transaction() as session:
            snapshot_count = await session.scalar(select(func.count()).select_from(SnapshotRow))
        assert snapshot_count == 0
    finally:
        await harness.database.stop()
