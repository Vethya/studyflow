from dataclasses import dataclass
from datetime import UTC, datetime, time, timedelta
from itertools import pairwise
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select

from studyflow.accounts.preferences import StudyPreferencesService
from studyflow.accounts.repositories import SqlAlchemyStudyPreferencesRepository
from studyflow.availability.repositories import (
    NoFutureSessions,
    SqlAlchemyAvailabilityWindowRepository,
    SqlAlchemyUnavailablePeriodRepository,
)
from studyflow.availability.unavailable import UnavailablePeriodDraft, UnavailablePeriodService
from studyflow.availability.windows import AvailabilityWindowDraft, AvailabilityWindowService
from studyflow.database import Base, Database
from studyflow.database.models import AcademicTask, StudentAccount
from studyflow.database.models import StudySession as SessionRow
from studyflow.database.models import StudySessionOutcome as OutcomeRow
from studyflow.scheduling import ProposalNotFeasibleError, ProposalStatus
from studyflow.scheduling.acceptance import ScheduleAcceptanceService
from studyflow.scheduling.outcome_repositories import SqlAlchemyStudySessionOutcomeRepository
from studyflow.scheduling.outcomes import StudySessionService
from studyflow.scheduling.recovery import ScheduleRecoveryService
from studyflow.scheduling.recovery_repositories import SqlAlchemyRecoverySnapshotRepository
from studyflow.scheduling.repositories import SqlAlchemyScheduleProposalRepository
from studyflow.tasks.repositories import SqlAlchemyAcademicTaskRepository
from studyflow.tasks.service import AcademicTaskService

NOW = datetime(2026, 8, 24, 12, tzinfo=UTC)


@dataclass(frozen=True)
class RecoveryWorkflow:
    database: Database
    account_id: UUID
    task_id: UUID
    past_session_id: UUID
    future_session_id: UUID
    outcomes: StudySessionService
    recovery: ScheduleRecoveryService
    acceptance: ScheduleAcceptanceService
    proposals: SqlAlchemyScheduleProposalRepository


async def _workflow(
    *,
    deadline: datetime,
    availability_end: time,
    minimum_break_minutes: int,
    future_start: datetime,
    unavailable: UnavailablePeriodDraft | None = None,
) -> RecoveryWorkflow:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    account_id, task_id, past_id, future_id = uuid4(), uuid4(), uuid4(), uuid4()
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
            ]
        )
    tasks = AcademicTaskService(SqlAlchemyAcademicTaskRepository(database), clock=lambda: NOW)
    preferences = StudyPreferencesService(SqlAlchemyStudyPreferencesRepository(database))
    await preferences.update(account_id, "UTC", 60, minimum_break_minutes)
    availability = AvailabilityWindowService(SqlAlchemyAvailabilityWindowRepository(database))
    await availability.replace(account_id, [AvailabilityWindowDraft(0, time(13), availability_end)])
    unavailable_periods = UnavailablePeriodService(
        SqlAlchemyUnavailablePeriodRepository(database, NoFutureSessions()), clock=lambda: NOW
    )
    if unavailable is not None:
        await unavailable_periods.create(account_id, unavailable)
    async with database.transaction() as session:
        session.add_all(
            [
                SessionRow(
                    id=past_id,
                    account_id=account_id,
                    task_id=task_id,
                    proposal_id=None,
                    starts_at=NOW - timedelta(hours=2),
                    ends_at=NOW - timedelta(hours=1),
                    planned_duration_minutes=60,
                ),
                SessionRow(
                    id=future_id,
                    account_id=account_id,
                    task_id=task_id,
                    proposal_id=None,
                    starts_at=future_start,
                    ends_at=future_start + timedelta(hours=1),
                    planned_duration_minutes=60,
                ),
            ]
        )
    proposal_repository = SqlAlchemyScheduleProposalRepository(database)
    snapshots = SqlAlchemyRecoverySnapshotRepository(database)
    outcomes = StudySessionService(
        SqlAlchemyStudySessionOutcomeRepository(database), clock=lambda: NOW
    )
    recovery = ScheduleRecoveryService(
        tasks,
        availability,
        unavailable_periods,
        preferences,
        snapshots,
        proposal_repository,
        clock=lambda: NOW,
    )
    acceptance = ScheduleAcceptanceService(
        tasks,
        availability,
        unavailable_periods,
        preferences,
        proposal_repository,
        snapshots,
        clock=lambda: NOW,
    )
    return RecoveryWorkflow(
        database,
        account_id,
        task_id,
        past_id,
        future_id,
        outcomes,
        recovery,
        acceptance,
        proposal_repository,
    )


@pytest.mark.anyio
async def test_feasible_missed_recovery_is_inactive_until_constraint_safe_acceptance() -> None:
    blocked = UnavailablePeriodDraft(
        datetime(2026, 8, 24, 14, tzinfo=UTC),
        datetime(2026, 8, 24, 15, tzinfo=UTC),
        "Class",
    )
    workflow = await _workflow(
        deadline=datetime(2026, 8, 24, 18, tzinfo=UTC),
        availability_end=time(18),
        minimum_break_minutes=10,
        future_start=datetime(2026, 8, 24, 16, tzinfo=UTC),
        unavailable=blocked,
    )
    try:
        outcome = await workflow.outcomes.record_missed(
            workflow.account_id, workflow.past_session_id
        )
        assert outcome is not None and outcome.remaining_minutes == 60
        preview = await workflow.recovery.propose(workflow.account_id, workflow.past_session_id)

        assert preview is not None and preview.status is ProposalStatus.FEASIBLE
        assert sum(item.planned_duration_minutes for item in preview.sessions) == 120
        assert preview.allocations[0].required_minutes == 120
        async with workflow.database.transaction() as session:
            active_before = list(
                await session.scalars(
                    select(SessionRow)
                    .where(SessionRow.proposal_id.is_(None))
                    .order_by(SessionRow.starts_at)
                )
            )
        assert [item.id for item in active_before] == [
            workflow.past_session_id,
            workflow.future_session_id,
        ]
        original_future = active_before[1]
        assert original_future.starts_at.replace(tzinfo=UTC) == datetime(
            2026, 8, 24, 16, tzinfo=UTC
        )

        ordered_preview = sorted(preview.sessions, key=lambda item: item.starts_at)
        for item in ordered_preview:
            assert item.starts_at.weekday() == 0
            assert time(13) <= item.starts_at.time().replace(tzinfo=None)
            assert item.ends_at.time().replace(tzinfo=None) <= time(18)
            assert item.ends_at <= datetime(2026, 8, 24, 18, tzinfo=UTC)
            assert not (item.starts_at < blocked.ends_at and blocked.starts_at < item.ends_at)
        for previous, following in pairwise(ordered_preview):
            assert previous.ends_at <= following.starts_at
            assert following.starts_at - previous.ends_at >= timedelta(minutes=10)

        accepted = await workflow.acceptance.accept(workflow.account_id, preview.id)
        assert accepted is not None
        assert {item.id for item in accepted} == {item.id for item in preview.sessions}
        async with workflow.database.transaction() as session:
            active_after = list(
                await session.scalars(select(SessionRow).where(SessionRow.proposal_id.is_(None)))
            )
            persisted_outcome = await session.get(OutcomeRow, workflow.past_session_id)
        assert {item.id for item in active_after} == {
            workflow.past_session_id,
            *(item.id for item in preview.sessions),
        }
        assert workflow.future_session_id not in {item.id for item in active_after}
        assert persisted_outcome is not None and persisted_outcome.rescheduled_at is not None
    finally:
        await workflow.database.stop()


@pytest.mark.anyio
async def test_overload_missed_recovery_is_exact_and_rejection_preserves_unfinished_work() -> None:
    workflow = await _workflow(
        deadline=datetime(2026, 8, 24, 14, tzinfo=UTC),
        availability_end=time(14),
        minimum_break_minutes=0,
        future_start=datetime(2026, 8, 24, 13, tzinfo=UTC),
    )
    try:
        outcome = await workflow.outcomes.record_missed(
            workflow.account_id, workflow.past_session_id
        )
        assert outcome is not None
        preview = await workflow.recovery.propose(workflow.account_id, workflow.past_session_id)
        assert preview is not None and preview.status is ProposalStatus.OVERLOAD
        allocation = preview.allocations[0]
        assert (
            allocation.required_minutes,
            allocation.scheduled_minutes,
            allocation.unscheduled_minutes,
            allocation.available_minutes_before_deadline,
            allocation.shortfall_minutes,
        ) == (120, 60, 60, 60, 60)

        with pytest.raises(ProposalNotFeasibleError):
            await workflow.acceptance.accept(workflow.account_id, preview.id)
        async with workflow.database.transaction() as session:
            active_after_failed_accept = set(
                await session.scalars(select(SessionRow.id).where(SessionRow.proposal_id.is_(None)))
            )
            unresolved = await session.get(OutcomeRow, workflow.past_session_id)
        assert active_after_failed_accept == {
            workflow.past_session_id,
            workflow.future_session_id,
        }
        assert unresolved is not None and unresolved.rescheduled_at is None
        assert await workflow.proposals.get(workflow.account_id) is not None

        assert await workflow.acceptance.reject(workflow.account_id, preview.id)
        assert await workflow.proposals.get(workflow.account_id) is None
        async with workflow.database.transaction() as session:
            active_after_reject = set(
                await session.scalars(select(SessionRow.id).where(SessionRow.proposal_id.is_(None)))
            )
            unresolved = await session.get(OutcomeRow, workflow.past_session_id)
        assert active_after_reject == active_after_failed_accept
        assert unresolved is not None and unresolved.remaining_minutes == 60
        assert unresolved.rescheduled_at is None
    finally:
        await workflow.database.stop()
