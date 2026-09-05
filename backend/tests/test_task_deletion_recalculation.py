"""Tests for task deletion recalculation (§7.8)."""

from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select

from studyflow.database import Base, Database
from studyflow.database.models import (
    AcademicTask,
    AdaptiveEstimationPrediction,
    StudentAccount,
)
from studyflow.database.models import StudySession as SessionRow
from studyflow.database.models import StudySessionOutcome as OutcomeRow
from studyflow.estimation import AdaptiveEstimator
from studyflow.estimation.repositories import SqlAlchemyAdaptivePredictionRepository
from studyflow.tasks.repositories import SqlAlchemyAcademicTaskRepository
from studyflow.tasks.service import (
    NewAcademicTask,
    PlannedDurationSource,
    TaskCategory,
    TaskPriority,
)


async def _seed_account(database: Database, account_id: UUID, now: datetime) -> None:
    async with database.transaction() as session:
        await session.run_sync(
            lambda sync_session: Base.metadata.create_all(sync_session.connection())
        )
        session.add(
            StudentAccount(
                id=account_id,
                email=f"user-{account_id}@example.com",
                name="Student",
                password_hash="$argon2id$hash",
                email_verified_at=now,
                timezone="UTC",
            )
        )


async def _create_completed_task(
    database: Database,
    account_id: UUID,
    *,
    category: TaskCategory,
    original_minutes: int,
    actual_minutes: int,
    completed_at: datetime,
    predicted_minutes: int | None = None,
) -> UUID:
    task_id = uuid4()
    session_id = uuid4()
    async with database.transaction() as session:
        task = AcademicTask(
            id=task_id,
            account_id=account_id,
            title=f"Task {task_id.hex[:6]}",
            category=category.value,
            priority="medium",
            course=None,
            notes=None,
            deadline_at=completed_at + timedelta(days=1),
            original_estimate_minutes=original_minutes,
            adaptive_estimate_minutes=predicted_minutes,
            planned_source="adaptive" if predicted_minutes is not None else "original",
            planned_duration_minutes=predicted_minutes or original_minutes,
            estimate_frozen_at=completed_at - timedelta(hours=2),
            completed_at=completed_at,
        )
        session.add(task)
        study_session = SessionRow(
            id=session_id,
            account_id=account_id,
            task_id=task_id,
            proposal_id=None,
            starts_at=completed_at - timedelta(hours=2),
            ends_at=completed_at,
            planned_duration_minutes=original_minutes,
        )
        session.add(study_session)
        outcome = OutcomeRow(
            session_id=session_id,
            kind="completed",
            actual_minutes=actual_minutes,
            remaining_minutes=0,
            recorded_at=completed_at,
            rescheduled_at=None,
        )
        session.add(outcome)
        if predicted_minutes is not None:
            prediction = AdaptiveEstimationPrediction(
                task_id=task_id,
                account_id=account_id,
                category=category.value,
                original_minutes=original_minutes,
                predicted_minutes=predicted_minutes,
                correction_factor=Decimal(predicted_minutes) / Decimal(original_minutes),
                history_scope="overall",
                history_count=5,
                exposed=True,
                created_at=completed_at - timedelta(hours=3),
            )
            session.add(prediction)
    return task_id


@pytest.mark.anyio
async def test_deleting_task_purges_sessions_outcomes_and_predictions() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    account_id = uuid4()
    now = datetime(2026, 9, 5, 12, 0, tzinfo=UTC)
    try:
        await _seed_account(database, account_id, now)
        task_id = await _create_completed_task(
            database,
            account_id,
            category=TaskCategory.READING,
            original_minutes=60,
            actual_minutes=90,
            completed_at=now - timedelta(days=1),
            predicted_minutes=80,
        )

        predictions = SqlAlchemyAdaptivePredictionRepository(database)
        estimator = AdaptiveEstimator(predictions)
        repository = SqlAlchemyAcademicTaskRepository(
            database, estimator=estimator, prediction_repository=predictions
        )

        # Confirm all rows exist
        async with database.transaction() as session:
            assert await session.get(AcademicTask, task_id) is not None
            assert (
                await session.scalar(select(SessionRow).where(SessionRow.task_id == task_id))
                is not None
            )
            assert await session.get(AdaptiveEstimationPrediction, task_id) is not None

        # Delete the task
        assert await repository.delete(account_id, task_id)

        # Confirm all rows are cleanly purged
        async with database.transaction() as session:
            assert await session.get(AcademicTask, task_id) is None
            assert (
                await session.scalar(select(SessionRow).where(SessionRow.task_id == task_id))
                is None
            )
            assert (
                await session.scalar(
                    select(OutcomeRow).where(
                        OutcomeRow.session_id.in_(
                            select(SessionRow.id).where(SessionRow.task_id == task_id)
                        )
                    )
                )
                is None
            )
            assert await session.get(AdaptiveEstimationPrediction, task_id) is None
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_deleting_task_drops_qualification_when_sample_falls_below_threshold() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    account_id = uuid4()
    now = datetime(2026, 9, 5, 12, 0, tzinfo=UTC)
    try:
        await _seed_account(database, account_id, now)
        predictions = SqlAlchemyAdaptivePredictionRepository(database)
        estimator = AdaptiveEstimator(predictions)
        repository = SqlAlchemyAcademicTaskRepository(
            database, estimator=estimator, prediction_repository=predictions
        )

        # Create exactly 5 completed tasks with accurate predictions (satisfies 10% MAE advantage)
        task_ids = []
        for i in range(5):
            tid = await _create_completed_task(
                database,
                account_id,
                category=TaskCategory.READING,
                original_minutes=100,
                actual_minutes=120,
                completed_at=now - timedelta(days=6 - i),
                predicted_minutes=120,  # 0 error for adaptive vs 20 error for original
            )
            task_ids.append(tid)

        # Account is currently qualified
        assert await estimator.is_qualified(account_id)

        # New task created while qualified gets adaptive estimate
        new_task = await repository.create(
            account_id,
            NewAcademicTask(
                "Qualified task",
                TaskCategory.READING,
                TaskPriority.MEDIUM,
                None,
                None,
                now + timedelta(days=2),
                100,
            ),
        )
        assert new_task.planned_source is PlannedDurationSource.ADAPTIVE
        assert new_task.adaptive_estimate_minutes is not None

        # Delete one completed task, dropping eligible count to 4 (< 5 minimum)
        assert await repository.delete(account_id, task_ids[0])

        # Account must now be unqualified
        assert not await estimator.is_qualified(account_id)

        # Subsequent task created after deletion falls back to Original Estimate
        subsequent_task = await repository.create(
            account_id,
            NewAcademicTask(
                "Post-deletion task",
                TaskCategory.READING,
                TaskPriority.MEDIUM,
                None,
                None,
                now + timedelta(days=3),
                100,
            ),
        )
        assert subsequent_task.planned_source is PlannedDurationSource.ORIGINAL
        assert subsequent_task.adaptive_estimate_minutes is None
        assert subsequent_task.planned_duration_minutes == 100
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_deleting_task_preserves_acknowledgment_when_factor_unchanged() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    account_id = uuid4()
    now = datetime(2026, 9, 5, 12, 0, tzinfo=UTC)
    try:
        await _seed_account(database, account_id, now)
        predictions = SqlAlchemyAdaptivePredictionRepository(database)
        estimator = AdaptiveEstimator(predictions)
        repository = SqlAlchemyAcademicTaskRepository(
            database, estimator=estimator, prediction_repository=predictions
        )

        # Create 5 completed tasks with high ratio (~2.5x)
        task_ids = []
        for i in range(5):
            tid = await _create_completed_task(
                database,
                account_id,
                category=TaskCategory.ASSIGNMENT,
                original_minutes=40,
                actual_minutes=100,  # 2.5x
                completed_at=now - timedelta(days=6 - i),
                predicted_minutes=100,
            )
            task_ids.append(tid)

        assert await estimator.is_qualified(account_id)

        # Acknowledge the large correction factor
        assert await estimator.acknowledge(account_id, TaskCategory.ASSIGNMENT)
        assert await predictions.acknowledgment(account_id, TaskCategory.ASSIGNMENT) is not None

        # Delete one completed task so qualification is lost, but factor is still 2.5x
        assert await repository.delete(account_id, task_ids[0])

        assert not await estimator.is_qualified(account_id)
        # Unchanged large factor acknowledgment is preserved across dequalification (§15.4)
        assert await predictions.acknowledgment(account_id, TaskCategory.ASSIGNMENT) is not None
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_deleting_task_removes_acknowledgment_when_factor_normalizes() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    account_id = uuid4()
    now = datetime(2026, 9, 5, 12, 0, tzinfo=UTC)
    try:
        await _seed_account(database, account_id, now)
        predictions = SqlAlchemyAdaptivePredictionRepository(database)
        estimator = AdaptiveEstimator(predictions)
        repository = SqlAlchemyAcademicTaskRepository(
            database, estimator=estimator, prediction_repository=predictions
        )

        # Create 5 tasks in READING with 1.2x (normal) and 5 in ASSIGNMENT with 3.0x (large)
        reading_ids = []
        for i in range(5):
            tid = await _create_completed_task(
                database,
                account_id,
                category=TaskCategory.READING,
                original_minutes=50,
                actual_minutes=60,  # 1.2x
                completed_at=now - timedelta(days=12 - i),
                predicted_minutes=60,
            )
            reading_ids.append(tid)

        assignment_ids = []
        for i in range(5):
            tid = await _create_completed_task(
                database,
                account_id,
                category=TaskCategory.ASSIGNMENT,
                original_minutes=40,
                actual_minutes=120,  # 3.0x
                completed_at=now - timedelta(days=6 - i),
                predicted_minutes=120,
            )
            assignment_ids.append(tid)

        assert await estimator.is_qualified(account_id)

        # Acknowledge the large ASSIGNMENT factor
        assert await estimator.acknowledge(account_id, TaskCategory.ASSIGNMENT)
        assert await predictions.acknowledgment(account_id, TaskCategory.ASSIGNMENT) is not None

        # Delete all 5 ASSIGNMENT tasks so category history is gone (overall is 1.2x normal)
        for tid in assignment_ids:
            assert await repository.delete(account_id, tid)

        # Still qualified from READING tasks, but ASSIGNMENT factor is normalized -> removed
        assert await estimator.is_qualified(account_id)
        assert await predictions.acknowledgment(account_id, TaskCategory.ASSIGNMENT) is None
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_deleting_task_preserves_unaffected_future_sessions() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    account_id = uuid4()
    now = datetime(2026, 9, 5, 12, 0, tzinfo=UTC)
    try:
        await _seed_account(database, account_id, now)
        predictions = SqlAlchemyAdaptivePredictionRepository(database)
        estimator = AdaptiveEstimator(predictions)
        repository = SqlAlchemyAcademicTaskRepository(
            database, estimator=estimator, prediction_repository=predictions
        )

        # Task A is completed in the past
        task_a = await _create_completed_task(
            database,
            account_id,
            category=TaskCategory.READING,
            original_minutes=60,
            actual_minutes=90,
            completed_at=now - timedelta(days=1),
        )

        # Task B has a future scheduled session
        task_b = await repository.create(
            account_id,
            NewAcademicTask(
                "Future task B",
                TaskCategory.PROJECT,
                TaskPriority.HIGH,
                None,
                None,
                now + timedelta(days=5),
                120,
            ),
        )
        session_b_id = uuid4()
        session_b_start = now + timedelta(days=1, hours=2)
        session_b_end = session_b_start + timedelta(hours=2)
        async with database.transaction() as session:
            session.add(
                SessionRow(
                    id=session_b_id,
                    account_id=account_id,
                    task_id=task_b.id,
                    proposal_id=None,
                    starts_at=session_b_start,
                    ends_at=session_b_end,
                    planned_duration_minutes=120,
                )
            )

        # Delete Task A
        assert await repository.delete(account_id, task_a)

        # Verify Task B and its future session remain completely unchanged
        task_b_record = await repository.get(account_id, task_b.id)
        assert task_b_record is not None
        assert task_b_record.planned_duration_minutes == 120

        async with database.transaction() as session:
            session_b = await session.get(SessionRow, session_b_id)
            assert session_b is not None
            assert session_b.starts_at.replace(tzinfo=UTC) == session_b_start
            assert session_b.ends_at.replace(tzinfo=UTC) == session_b_end
            assert session_b.invalidated_at is None
    finally:
        await database.stop()
