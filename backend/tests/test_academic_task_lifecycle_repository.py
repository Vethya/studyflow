from dataclasses import replace
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import select

from studyflow.database import Base, Database
from studyflow.database.models import AcademicTask, StudentAccount, TaskDeadlineHistory
from studyflow.database.models import StudySession as SessionRow
from studyflow.tasks.repositories import (
    SqlAlchemyAcademicTaskRepository,
    SqlAlchemyTaskDeadlineSessionInvalidator,
)
from studyflow.tasks.service import (
    EstimateFrozenError,
    NewAcademicTask,
    TaskCategory,
    TaskFilters,
    TaskMustBeStartedError,
    TaskPriority,
    TaskStatus,
)


@pytest.mark.anyio
async def test_earlier_deadline_invalidates_only_future_sessions_that_cross_it() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    account_id = uuid4()
    now = datetime(2026, 7, 29, 12, tzinfo=UTC)
    old_deadline = now + timedelta(days=2)
    new_deadline = now + timedelta(days=1)
    draft = NewAcademicTask(
        "Write report",
        TaskCategory.RESEARCH_WRITING,
        TaskPriority.HIGH,
        "Thesis",
        None,
        old_deadline,
        180,
    )
    try:
        async with database.transaction() as session:
            await session.run_sync(
                lambda sync_session: Base.metadata.create_all(sync_session.connection())
            )
            session.add(
                StudentAccount(
                    id=account_id,
                    email="student@example.com",
                    name="Student",
                    password_hash="$argon2id$hash",
                    email_verified_at=now,
                    timezone="UTC",
                )
            )
        repository = SqlAlchemyAcademicTaskRepository(
            database,
            SqlAlchemyTaskDeadlineSessionInvalidator(),
            clock=lambda: now,
        )
        task = await repository.create(account_id, draft)
        valid_id, invalid_id = uuid4(), uuid4()
        async with database.transaction() as session:
            session.add_all(
                [
                    SessionRow(
                        id=valid_id,
                        account_id=account_id,
                        task_id=task.id,
                        proposal_id=None,
                        starts_at=new_deadline - timedelta(hours=2),
                        ends_at=new_deadline,
                        planned_duration_minutes=120,
                    ),
                    SessionRow(
                        id=invalid_id,
                        account_id=account_id,
                        task_id=task.id,
                        proposal_id=None,
                        starts_at=new_deadline - timedelta(minutes=30),
                        ends_at=new_deadline + timedelta(minutes=30),
                        planned_duration_minutes=60,
                    ),
                ]
            )

        updated = await repository.update(
            account_id,
            task.id,
            replace(draft, deadline_at=new_deadline),
            now,
        )

        assert updated is not None and updated.deadline_at == new_deadline
        async with database.transaction() as session:
            remaining_ids = set(await session.scalars(select(SessionRow.id)))
        assert remaining_ids == {valid_id}
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_task_lifecycle_preserves_history_freezes_estimate_and_derives_status() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    account_id = uuid4()
    now = datetime(2026, 7, 29, 12, tzinfo=UTC)
    try:
        async with database.transaction() as session:
            await session.run_sync(
                lambda sync_session: Base.metadata.create_all(sync_session.connection())
            )
            session.add(
                StudentAccount(
                    id=account_id,
                    email="student@example.com",
                    name="Student",
                    password_hash="$argon2id$hash",
                    email_verified_at=now,
                    timezone="UTC",
                )
            )
        repository = SqlAlchemyAcademicTaskRepository(database, clock=lambda: now)
        draft = NewAcademicTask(
            "Write report",
            TaskCategory.RESEARCH_WRITING,
            TaskPriority.HIGH,
            "Thesis",
            None,
            now + timedelta(days=2),
            180,
        )
        task = await repository.create(account_id, draft)
        assert task.status is TaskStatus.NOT_STARTED

        updated = await repository.update(
            account_id,
            task.id,
            replace(draft, deadline_at=now + timedelta(days=3), original_estimate_minutes=240),
            now,
        )
        assert updated is not None and updated.original_estimate_minutes == 240
        async with database.transaction() as session:
            history = (await session.scalars(select(TaskDeadlineHistory))).one()
        assert history.previous_deadline_at.replace(tzinfo=UTC) == now + timedelta(days=2)
        assert history.new_deadline_at.replace(tzinfo=UTC) == now + timedelta(days=3)

        with pytest.raises(TaskMustBeStartedError):
            await repository.finish_early(account_id, task.id, now)
        assert await repository.mark_started(account_id, task.id, now)
        assert (await repository.get(account_id, task.id)).status is TaskStatus.IN_PROGRESS  # type: ignore[union-attr]
        with pytest.raises(EstimateFrozenError):
            await repository.update(
                account_id, task.id, replace(draft, original_estimate_minutes=300), now
            )
        async with database.transaction() as session:
            assert len(list(await session.scalars(select(TaskDeadlineHistory)))) == 1

        assert await repository.finish_early(account_id, task.id, now)
        assert await repository.finish_early(account_id, task.id, now + timedelta(hours=1))
        async with database.transaction() as session:
            finished_at = await session.scalar(
                select(AcademicTask.finished_early_at).where(AcademicTask.id == task.id)
            )
        assert finished_at is not None and finished_at.replace(tzinfo=UTC) == now
        overdue_draft = replace(draft, title="Overdue", deadline_at=now - timedelta(hours=1))
        overdue = await repository.create(account_id, overdue_draft)
        overdue_updated = await repository.update(
            account_id, overdue.id, replace(overdue_draft, title="Renamed overdue"), now
        )
        assert overdue_updated is not None and overdue_updated.title == "Renamed overdue"
        not_started = await repository.create(
            account_id, replace(draft, title="Not started", deadline_at=now + timedelta(days=4))
        )
        in_progress = await repository.create(
            account_id, replace(draft, title="In progress", deadline_at=now + timedelta(days=5))
        )
        assert await repository.mark_started(account_id, in_progress.id, now)

        expected_by_status = {
            TaskStatus.COMPLETED: task.id,
            TaskStatus.OVERDUE: overdue.id,
            TaskStatus.NOT_STARTED: not_started.id,
            TaskStatus.IN_PROGRESS: in_progress.id,
        }
        for task_status, expected_id in expected_by_status.items():
            assert [
                item.id
                for item in await repository.list(account_id, TaskFilters(status=task_status))
            ] == [expected_id]

        other_account_id = uuid4()
        assert await repository.update(other_account_id, task.id, draft, now) is None
        assert not await repository.finish_early(other_account_id, task.id, now)
        assert not await repository.delete(other_account_id, task.id)
        assert await repository.delete(account_id, task.id)
        assert await repository.get(account_id, task.id) is None
        async with database.transaction() as session:
            assert list(await session.scalars(select(TaskDeadlineHistory))) == []
    finally:
        await database.stop()
