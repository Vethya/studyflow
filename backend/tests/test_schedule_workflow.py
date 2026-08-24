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
from studyflow.database.models import StudentAccount
from studyflow.database.models import StudySession as SessionRow
from studyflow.scheduling import ProposalNotFeasibleError, ProposalStatus
from studyflow.scheduling.acceptance import ScheduleAcceptanceService
from studyflow.scheduling.repositories import SqlAlchemyScheduleProposalRepository
from studyflow.scheduling.service import ScheduleGenerationService
from studyflow.tasks.repositories import SqlAlchemyAcademicTaskRepository
from studyflow.tasks.service import (
    AcademicTaskService,
    NewAcademicTask,
    TaskCategory,
    TaskPriority,
)

NOW = datetime(2026, 8, 24, 8, tzinfo=UTC)


@dataclass(frozen=True)
class Workflow:
    database: Database
    account_id: UUID
    tasks: AcademicTaskService
    preferences: StudyPreferencesService
    availability: AvailabilityWindowService
    unavailable: UnavailablePeriodService
    proposals: SqlAlchemyScheduleProposalRepository
    generation: ScheduleGenerationService
    acceptance: ScheduleAcceptanceService


async def _workflow(*, minimum_break_minutes: int) -> Workflow:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    account_id = uuid4()
    async with database.transaction() as session:
        await session.run_sync(lambda sync: Base.metadata.create_all(sync.connection()))
        session.add(
            StudentAccount(
                id=account_id,
                email="student@example.com",
                name="Student",
                password_hash="$argon2id$hash",
                email_verified_at=NOW,
                timezone="UTC",
                availability_timezone_confirmed=True,
            )
        )
    tasks = AcademicTaskService(
        SqlAlchemyAcademicTaskRepository(database, clock=lambda: NOW), clock=lambda: NOW
    )
    preferences = StudyPreferencesService(SqlAlchemyStudyPreferencesRepository(database))
    await preferences.update(account_id, "UTC", 60, minimum_break_minutes)
    availability = AvailabilityWindowService(SqlAlchemyAvailabilityWindowRepository(database))
    unavailable = UnavailablePeriodService(
        SqlAlchemyUnavailablePeriodRepository(database, NoFutureSessions()), clock=lambda: NOW
    )
    proposals = SqlAlchemyScheduleProposalRepository(database)
    generation = ScheduleGenerationService(
        tasks,
        availability,
        unavailable,
        preferences,
        proposals,
        clock=lambda: NOW,
    )
    acceptance = ScheduleAcceptanceService(
        tasks,
        availability,
        unavailable,
        preferences,
        proposals,
        clock=lambda: NOW,
    )
    return Workflow(
        database,
        account_id,
        tasks,
        preferences,
        availability,
        unavailable,
        proposals,
        generation,
        acceptance,
    )


def _new_task(title: str, deadline: datetime, minutes: int) -> NewAcademicTask:
    return NewAcademicTask(
        title,
        TaskCategory.ASSIGNMENT,
        TaskPriority.HIGH,
        None,
        None,
        deadline,
        minutes,
    )


def _overlaps(
    left_start: datetime, left_end: datetime, right_start: datetime, right_end: datetime
) -> bool:
    return left_start < right_end and right_start < left_end


@pytest.mark.anyio
async def test_feasible_workflow_stays_inactive_until_acceptance_and_respects_constraints() -> None:
    workflow = await _workflow(minimum_break_minutes=10)
    try:
        first = await workflow.tasks.create(
            workflow.account_id,
            _new_task("Essay", datetime(2026, 8, 24, 16, tzinfo=UTC), 120),
        )
        second = await workflow.tasks.create(
            workflow.account_id,
            _new_task("Reading", datetime(2026, 8, 25, 12, tzinfo=UTC), 60),
        )
        windows = await workflow.availability.replace(
            workflow.account_id,
            [
                AvailabilityWindowDraft(0, time(9), time(17)),
                AvailabilityWindowDraft(1, time(9), time(12)),
            ],
        )
        blocked = UnavailablePeriodDraft(
            datetime(2026, 8, 24, 10, tzinfo=UTC),
            datetime(2026, 8, 24, 11, tzinfo=UTC),
            "Class",
        )
        await workflow.unavailable.create(workflow.account_id, blocked)

        preview = await workflow.generation.generate(workflow.account_id)
        assert preview is not None and preview.status is ProposalStatus.FEASIBLE
        async with workflow.database.transaction() as db_session:
            active_before = list(
                await db_session.scalars(select(SessionRow).where(SessionRow.proposal_id.is_(None)))
            )
        assert active_before == []

        accepted = await workflow.acceptance.accept(workflow.account_id, preview.id)
        assert accepted is not None
        assert [item.id for item in accepted] == [item.id for item in preview.sessions]
        assert all(item.proposal_id is None for item in accepted)

        ordered = sorted(accepted, key=lambda item: item.starts_at)
        task_by_id = {first.id: first, second.id: second}
        persisted_windows = [(item.weekday, item.start_time, item.end_time) for item in windows]
        for session in ordered:
            task = task_by_id[session.task_id]
            assert session.ends_at <= task.deadline_at
            assert any(
                session.starts_at.weekday() == weekday
                and start_time <= session.starts_at.time().replace(tzinfo=None)
                and session.ends_at.time().replace(tzinfo=None) <= end_time
                for weekday, start_time, end_time in persisted_windows
            )
            assert not _overlaps(
                session.starts_at, session.ends_at, blocked.starts_at, blocked.ends_at
            )
        for previous, following in pairwise(ordered):
            assert previous.ends_at <= following.starts_at
            assert following.starts_at - previous.ends_at >= timedelta(minutes=10)
        assert {
            task_id: sum(
                item.planned_duration_minutes for item in accepted if item.task_id == task_id
            )
            for task_id in task_by_id
        } == {first.id: 120, second.id: 60}
    finally:
        await workflow.database.stop()


@pytest.mark.anyio
async def test_overload_preview_is_exact_and_cannot_replace_active_schedule() -> None:
    workflow = await _workflow(minimum_break_minutes=0)
    try:
        task = await workflow.tasks.create(
            workflow.account_id,
            _new_task("Exam", datetime(2026, 8, 24, 10, tzinfo=UTC), 120),
        )
        await workflow.availability.replace(
            workflow.account_id, [AvailabilityWindowDraft(0, time(9), time(10))]
        )
        active_id = uuid4()
        async with workflow.database.transaction() as session:
            session.add(
                SessionRow(
                    id=active_id,
                    account_id=workflow.account_id,
                    task_id=task.id,
                    proposal_id=None,
                    starts_at=datetime(2026, 8, 25, 14, tzinfo=UTC),
                    ends_at=datetime(2026, 8, 25, 15, tzinfo=UTC),
                    planned_duration_minutes=60,
                )
            )

        preview = await workflow.generation.generate(workflow.account_id)
        assert preview is not None and preview.status is ProposalStatus.OVERLOAD
        allocation = preview.allocations[0]
        assert (
            allocation.required_minutes,
            allocation.available_minutes_before_deadline,
            allocation.shortfall_minutes,
            allocation.unscheduled_minutes,
        ) == (120, 60, 60, 60)
        with pytest.raises(ProposalNotFeasibleError):
            await workflow.acceptance.accept(workflow.account_id, preview.id)

        async with workflow.database.transaction() as session:
            active_after_failed_accept = list(
                await session.scalars(select(SessionRow).where(SessionRow.proposal_id.is_(None)))
            )
        assert [item.id for item in active_after_failed_accept] == [active_id]
        assert await workflow.acceptance.reject(workflow.account_id, preview.id)
        async with workflow.database.transaction() as session:
            active_after_reject = list(
                await session.scalars(select(SessionRow).where(SessionRow.proposal_id.is_(None)))
            )
        assert [item.id for item in active_after_reject] == [active_id]
        assert await workflow.proposals.get(workflow.account_id) is None
    finally:
        await workflow.database.stop()
