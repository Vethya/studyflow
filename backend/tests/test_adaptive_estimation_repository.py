from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select

from studyflow.database import Base, Database
from studyflow.database.models import AcademicTask, StudentAccount
from studyflow.database.models import StudySession as SessionRow
from studyflow.database.models import StudySessionOutcome as OutcomeRow
from studyflow.estimation import CorrectionPrediction
from studyflow.estimation.repositories import SqlAlchemyAdaptivePredictionRepository
from studyflow.tasks.service import TaskCategory

NOW = datetime(2026, 9, 3, 12, tzinfo=UTC)


def _task(
    account_id: UUID,
    *,
    category: str = "other",
    completed_at: datetime | None = None,
    estimate_frozen_at: datetime | None = None,
) -> AcademicTask:
    return AcademicTask(
        id=uuid4(),
        account_id=account_id,
        title="Estimate task",
        category=category,
        deadline_at=NOW + timedelta(days=1),
        original_estimate_minutes=100,
        planned_duration_minutes=100,
        completed_at=completed_at,
        estimate_frozen_at=estimate_frozen_at,
    )


async def _database() -> tuple[Database, UUID, UUID]:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    owner_id, other_id = uuid4(), uuid4()
    async with database.transaction() as session:
        await session.run_sync(lambda sync: Base.metadata.create_all(sync.connection()))
        session.add_all(
            [
                StudentAccount(
                    id=owner_id,
                    email="owner@example.com",
                    name="Owner",
                    password_hash="$argon2id$hash",
                    email_verified_at=NOW,
                    timezone="UTC",
                ),
                StudentAccount(
                    id=other_id,
                    email="other@example.com",
                    name="Other",
                    password_hash="$argon2id$hash",
                    email_verified_at=NOW,
                    timezone="UTC",
                ),
            ]
        )
    return database, owner_id, other_id


async def _completed_task(
    database: Database,
    account_id: UUID,
    *,
    completed_at: datetime,
    actual_minutes: int,
    category: str = "other",
) -> AcademicTask:
    task = _task(
        account_id,
        category=category,
        completed_at=completed_at,
        estimate_frozen_at=completed_at - timedelta(hours=1),
    )
    async with database.transaction() as session:
        session.add(task)
        session.add(
            SessionRow(
                account_id=account_id,
                task_id=task.id,
                proposal_id=None,
                starts_at=completed_at - timedelta(hours=1),
                ends_at=completed_at,
                planned_duration_minutes=100,
            )
        )
        await session.flush()
        session.add(
            OutcomeRow(
                session_id=(
                    await session.scalar(select(SessionRow.id).where(SessionRow.task_id == task.id))
                ),
                kind="completed",
                actual_minutes=actual_minutes,
                remaining_minutes=0,
                recorded_at=completed_at,
                rescheduled_at=None,
            )
        )
    return task


def _prediction(
    *,
    minutes: int = 125,
    factor: Decimal = Decimal("1.25"),
    scope: str = "overall",
    history_count: int = 5,
) -> CorrectionPrediction:
    return CorrectionPrediction(
        predicted_minutes=minutes,
        correction_factor=factor,
        history_scope=scope,  # type: ignore[arg-type]
        history_count=history_count,
    )


@pytest.mark.anyio
async def test_history_is_account_scoped_orders_completion_ties_and_keeps_full_history() -> None:
    database, owner_id, other_id = await _database()
    try:
        owner_tasks = [
            await _completed_task(
                database,
                owner_id,
                completed_at=NOW + timedelta(minutes=index // 2),
                actual_minutes=100 + index,
                category="reading" if index % 2 else "other",
            )
            for index in range(25)
        ]
        await _completed_task(
            database,
            other_id,
            completed_at=NOW,
            actual_minutes=999,
        )
        repository = SqlAlchemyAdaptivePredictionRepository(database)

        history = await repository.history(owner_id)

        assert [record.task_id for record in history] == [
            task_id
            for _, task_id in sorted(
                (NOW + timedelta(minutes=index // 2), task.id)
                for index, task in enumerate(owner_tasks)
            )
        ]
        assert len(history) == 25
        assert all(record.actual_minutes != 999 for record in history)
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_evaluations_join_immutable_predictions_to_later_confirmed_actual_duration() -> None:
    database, owner_id, other_id = await _database()
    try:
        task = _task(owner_id)
        async with database.transaction() as session:
            session.add(task)
        repository = SqlAlchemyAdaptivePredictionRepository(database)
        assert await repository.save_prediction(owner_id, task.id, _prediction(), exposed=False)
        async with database.transaction() as session:
            row = await session.get(AcademicTask, task.id)
            assert row is not None
            row.completed_at = NOW
            row.estimate_frozen_at = NOW - timedelta(hours=1)
            session.add(
                SessionRow(
                    account_id=owner_id,
                    task_id=task.id,
                    proposal_id=None,
                    starts_at=NOW - timedelta(hours=1),
                    ends_at=NOW,
                    planned_duration_minutes=100,
                )
            )
            await session.flush()
            session.add(
                OutcomeRow(
                    session_id=(
                        await session.scalar(
                            select(SessionRow.id).where(SessionRow.task_id == task.id)
                        )
                    ),
                    kind="delayed",
                    actual_minutes=40,
                    remaining_minutes=0,
                    recorded_at=NOW,
                    rescheduled_at=None,
                )
            )
            foreign_session = SessionRow(
                account_id=other_id,
                task_id=task.id,
                proposal_id=None,
                starts_at=NOW - timedelta(hours=1),
                ends_at=NOW,
                planned_duration_minutes=100,
            )
            session.add(foreign_session)
            await session.flush()
            session.add(
                OutcomeRow(
                    session_id=foreign_session.id,
                    kind="completed",
                    actual_minutes=500,
                    remaining_minutes=0,
                    recorded_at=NOW,
                    rescheduled_at=None,
                )
            )

        evaluations = await repository.evaluations(owner_id)

        assert len(evaluations) == 1
        assert evaluations[0].task_id == task.id
        assert evaluations[0].original_minutes == 100
        assert evaluations[0].adaptive_minutes == 125
        assert evaluations[0].actual_minutes == 40
        assert evaluations[0].completed_at == NOW
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_predictions_are_account_scoped_and_only_replaceable_before_freeze() -> None:
    database, owner_id, other_id = await _database()
    try:
        task = _task(owner_id)
        async with database.transaction() as session:
            session.add(task)
        repository = SqlAlchemyAdaptivePredictionRepository(database)

        assert not await repository.save_prediction(other_id, task.id, _prediction(), exposed=True)
        assert await repository.save_prediction(owner_id, task.id, _prediction(), exposed=False)
        assert not await repository.save_prediction(
            owner_id,
            task.id,
            _prediction(minutes=150),
            exposed=True,
        )
        assert await repository.replace_prediction(
            owner_id,
            task.id,
            _prediction(minutes=150, factor=Decimal("1.5")),
            exposed=True,
        )
        async with database.transaction() as session:
            row = await session.get(AcademicTask, task.id)
            assert row is not None
            row.estimate_frozen_at = NOW
        assert not await repository.replace_prediction(
            owner_id,
            task.id,
            _prediction(minutes=175, factor=Decimal("1.75")),
            exposed=True,
        )

        evaluations = await repository.evaluations(owner_id)
        assert [(item.adaptive_minutes, item.actual_minutes) for item in evaluations] == [
            (150, None)
        ]
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_acknowledgment_replaces_a_category_specific_factor_for_its_account() -> None:
    database, owner_id, other_id = await _database()
    try:
        repository = SqlAlchemyAdaptivePredictionRepository(database)

        assert await repository.acknowledgment(owner_id, TaskCategory.READING) is None
        assert await repository.acknowledge(
            other_id,
            TaskCategory.READING,
            Decimal("2.5"),
            NOW,
        )
        assert await repository.acknowledge(
            owner_id,
            TaskCategory.READING,
            Decimal("2.5"),
            NOW,
        )
        assert await repository.acknowledge(
            owner_id,
            TaskCategory.READING,
            Decimal("1.5"),
            NOW + timedelta(minutes=1),
        )

        assert await repository.acknowledgment(owner_id, TaskCategory.READING) == Decimal("1.5")
        assert await repository.acknowledgment(other_id, TaskCategory.READING) == Decimal("2.5")
    finally:
        await database.stop()
