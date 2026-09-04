from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import delete, select

from studyflow.database import Base, Database
from studyflow.database.models import (
    AcademicTask,
    AdaptiveEstimationPrediction,
    StudentAccount,
)
from studyflow.database.models import StudySession as SessionRow
from studyflow.database.models import StudySessionOutcome as OutcomeRow
from studyflow.estimation import AdaptiveEstimateUnavailableError, AdaptiveEstimator
from studyflow.estimation.repositories import SqlAlchemyAdaptivePredictionRepository
from studyflow.tasks.repositories import SqlAlchemyAcademicTaskRepository
from studyflow.tasks.service import (
    NewAcademicTask,
    PlannedDurationSource,
    TaskCategory,
    TaskFilters,
    TaskPriority,
)


async def _qualify_and_acknowledge(database: Database, account_id: UUID) -> AdaptiveEstimator:
    now = datetime.now(UTC)
    async with database.transaction() as session:
        for index in range(5):
            history = AcademicTask(
                account_id=account_id,
                title=f"Completed history {index}",
                category="reading",
                priority="medium",
                deadline_at=now + timedelta(days=1),
                original_estimate_minutes=100,
                adaptive_estimate_minutes=None,
                planned_source="original",
                planned_duration_minutes=100,
                estimate_frozen_at=now,
                completed_at=now,
            )
            session.add(history)
            await session.flush()
            session.add(
                SessionRow(
                    account_id=account_id,
                    task_id=history.id,
                    proposal_id=None,
                    starts_at=now - timedelta(hours=1),
                    ends_at=now,
                    planned_duration_minutes=100,
                )
            )
            await session.flush()
            session.add(
                OutcomeRow(
                    session_id=(
                        await session.scalar(
                            select(SessionRow.id).where(SessionRow.task_id == history.id)
                        )
                    ),
                    kind="completed",
                    actual_minutes=150,
                    remaining_minutes=0,
                    recorded_at=now,
                    rescheduled_at=None,
                )
            )
            session.add(
                AdaptiveEstimationPrediction(
                    task_id=history.id,
                    account_id=account_id,
                    category="reading",
                    original_minutes=100,
                    predicted_minutes=150,
                    correction_factor="1.5",
                    history_scope="category",
                    history_count=5,
                    exposed=True,
                )
            )
    estimator = AdaptiveEstimator(SqlAlchemyAdaptivePredictionRepository(database))
    assert await estimator.acknowledge(account_id, TaskCategory.READING)
    return estimator


@pytest.mark.anyio
async def test_task_repository_scopes_create_list_and_get_to_owner() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    account_id = uuid4()
    other_id = uuid4()
    try:
        async with database.transaction() as session:
            await session.run_sync(
                lambda sync_session: Base.metadata.create_all(sync_session.connection())
            )
            session.add_all(
                [
                    StudentAccount(
                        id=account_id,
                        email="student@example.com",
                        name="Student",
                        password_hash="$argon2id$hash",
                        email_verified_at=datetime.now(UTC),
                        timezone="UTC",
                    ),
                    StudentAccount(
                        id=other_id,
                        email="other@example.com",
                        name="Other",
                        password_hash="$argon2id$hash",
                        email_verified_at=datetime.now(UTC),
                        timezone="UTC",
                    ),
                ]
            )
        repository = SqlAlchemyAcademicTaskRepository(database)
        created = await repository.create(
            account_id,
            NewAcademicTask(
                "Read chapter 4",
                TaskCategory.READING,
                TaskPriority.MEDIUM,
                None,
                None,
                datetime.now(UTC) + timedelta(days=1),
                90,
            ),
        )
        later = await repository.create(
            account_id,
            NewAcademicTask(
                "Submit project",
                TaskCategory.PROJECT,
                TaskPriority.HIGH,
                "Algorithms",
                None,
                datetime.now(UTC) + timedelta(days=2),
                180,
            ),
        )

        assert [task.id for task in await repository.list(account_id)] == [created.id, later.id]
        assert [
            task.id
            for task in await repository.list(
                account_id, TaskFilters(course="Algorithms", priority=TaskPriority.HIGH)
            )
        ] == [later.id]
        assert await repository.list(other_id) == []
        assert await repository.get(other_id, created.id) is None
        assert (await repository.get(account_id, created.id)).planned_duration_minutes == 90  # type: ignore[union-attr]
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_task_repository_snapshots_qualified_adaptive_or_explicit_original_selection() -> (
    None
):
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    account_id = uuid4()
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
                    email_verified_at=datetime.now(UTC),
                    timezone="UTC",
                )
            )
        estimator = await _qualify_and_acknowledge(database, account_id)
        predictions = SqlAlchemyAdaptivePredictionRepository(database)
        repository = SqlAlchemyAcademicTaskRepository(
            database, estimator=estimator, prediction_repository=predictions
        )
        automatic = await repository.create(
            account_id,
            NewAcademicTask(
                "Adaptive task",
                TaskCategory.READING,
                TaskPriority.MEDIUM,
                None,
                None,
                datetime.now(UTC) + timedelta(days=1),
                60,
            ),
        )
        original = await repository.create(
            account_id,
            NewAcademicTask(
                "Original task",
                TaskCategory.READING,
                TaskPriority.MEDIUM,
                None,
                None,
                datetime.now(UTC) + timedelta(days=1),
                60,
                PlannedDurationSource.ORIGINAL,
            ),
        )

        assert (
            automatic.adaptive_estimate_minutes,
            automatic.planned_source,
            automatic.planned_duration_minutes,
        ) == (90, PlannedDurationSource.ADAPTIVE, 90)
        assert (
            original.adaptive_estimate_minutes,
            original.planned_source,
            original.planned_duration_minutes,
        ) == (90, PlannedDurationSource.ORIGINAL, 60)
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_task_repository_rejects_unavailable_adaptive_and_preserves_frozen_snapshot() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    account_id = uuid4()
    now = datetime.now(UTC)
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
        unavailable = SqlAlchemyAcademicTaskRepository(
            database,
            estimator=AdaptiveEstimator(SqlAlchemyAdaptivePredictionRepository(database)),
            prediction_repository=SqlAlchemyAdaptivePredictionRepository(database),
        )
        draft = NewAcademicTask(
            "Unavailable adaptive task",
            TaskCategory.READING,
            TaskPriority.MEDIUM,
            None,
            None,
            now + timedelta(days=1),
            60,
            PlannedDurationSource.ADAPTIVE,
        )
        with pytest.raises(AdaptiveEstimateUnavailableError):
            await unavailable.create(account_id, draft)
        assert await unavailable.list(account_id) == []

        estimator = await _qualify_and_acknowledge(database, account_id)
        predictions = SqlAlchemyAdaptivePredictionRepository(database)
        repository = SqlAlchemyAcademicTaskRepository(
            database, estimator=estimator, prediction_repository=predictions
        )
        created = await repository.create(
            account_id,
            NewAcademicTask(
                "Frozen adaptive task",
                TaskCategory.READING,
                TaskPriority.MEDIUM,
                None,
                None,
                now + timedelta(days=2),
                60,
            ),
        )
        assert await repository.mark_started(account_id, created.id, now)
        updated = await repository.update(
            account_id,
            created.id,
            NewAcademicTask(
                "Renamed frozen task",
                TaskCategory.READING,
                TaskPriority.HIGH,
                None,
                None,
                now + timedelta(days=3),
                60,
            ),
            now,
        )

        assert updated is not None
        assert (
            updated.original_estimate_minutes,
            updated.adaptive_estimate_minutes,
            updated.planned_source,
            updated.planned_duration_minutes,
        ) == (
            created.original_estimate_minutes,
            created.adaptive_estimate_minutes,
            created.planned_source,
            created.planned_duration_minutes,
        )
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_unstarted_original_estimate_edit_stays_constraint_valid_during_capture() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    account_id = uuid4()
    now = datetime.now(UTC)
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
        predictions = SqlAlchemyAdaptivePredictionRepository(database)
        repository = SqlAlchemyAcademicTaskRepository(
            database,
            estimator=AdaptiveEstimator(predictions),
            prediction_repository=predictions,
        )
        created = await repository.create(
            account_id,
            NewAcademicTask(
                "Original task",
                TaskCategory.READING,
                TaskPriority.MEDIUM,
                None,
                None,
                now + timedelta(days=1),
                60,
                PlannedDurationSource.ORIGINAL,
            ),
        )

        updated = await repository.update(
            account_id,
            created.id,
            NewAcademicTask(
                "Original task",
                TaskCategory.READING,
                TaskPriority.MEDIUM,
                None,
                None,
                now + timedelta(days=1),
                75,
                PlannedDurationSource.ORIGINAL,
            ),
            now,
        )

        assert updated is not None
        assert (
            updated.original_estimate_minutes,
            updated.adaptive_estimate_minutes,
            updated.planned_source,
            updated.planned_duration_minutes,
        ) == (75, None, PlannedDurationSource.ORIGINAL, 75)
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_unqualified_recapture_removes_the_prior_prediction_snapshot() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    account_id = uuid4()
    now = datetime.now(UTC)
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
        estimator = await _qualify_and_acknowledge(database, account_id)
        predictions = SqlAlchemyAdaptivePredictionRepository(database)
        repository = SqlAlchemyAcademicTaskRepository(
            database, estimator=estimator, prediction_repository=predictions
        )
        created = await repository.create(
            account_id,
            NewAcademicTask(
                "Adaptive task",
                TaskCategory.READING,
                TaskPriority.MEDIUM,
                None,
                None,
                now + timedelta(days=1),
                60,
            ),
        )
        async with database.transaction() as session:
            history_id = await session.scalar(
                select(AcademicTask.id)
                .where(
                    AcademicTask.account_id == account_id,
                    AcademicTask.completed_at.is_not(None),
                )
                .limit(1)
            )
            assert history_id is not None
            await session.execute(
                delete(AdaptiveEstimationPrediction).where(
                    AdaptiveEstimationPrediction.task_id == history_id
                )
            )
            await session.execute(delete(AcademicTask).where(AcademicTask.id == history_id))

        updated = await repository.update(
            account_id,
            created.id,
            NewAcademicTask(
                "Project task",
                TaskCategory.PROJECT,
                TaskPriority.MEDIUM,
                None,
                None,
                now + timedelta(days=1),
                60,
            ),
            now,
        )
        async with database.transaction() as session:
            prediction = await session.get(AdaptiveEstimationPrediction, created.id)

        assert updated is not None
        assert (
            updated.adaptive_estimate_minutes,
            updated.planned_source,
            updated.planned_duration_minutes,
        ) == (None, PlannedDurationSource.ORIGINAL, 60)
        assert prediction is None
    finally:
        await database.stop()
