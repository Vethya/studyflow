"""Regression checks for the deterministic evaluation resource seed."""

import sys
from pathlib import Path

import pytest
from sqlalchemy import func, select

sys.path.insert(0, str(Path(__file__).parents[1]))

from benchmarks.seed_evaluation import seed_evaluation_dataset
from studyflow.database import Base, Database
from studyflow.database.models.authentication import StudentAccount
from studyflow.database.models.scheduling import StudySessionOutcome
from studyflow.database.models.tasks import AcademicTask, AdaptiveEstimationPrediction


@pytest.mark.anyio
async def test_evaluation_seed_is_repeatable_and_keeps_pending_actuals_unset() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    try:
        async with database.transaction() as session:
            await session.run_sync(
                lambda sync_session: Base.metadata.create_all(sync_session.connection())
            )
            first_ids = await seed_evaluation_dataset(session)
            second_ids = await seed_evaluation_dataset(session)
            assert first_ids == second_ids

        async with database.transaction() as session:
            accounts = await session.scalar(select(func.count()).select_from(StudentAccount))
            tasks = await session.scalar(select(func.count()).select_from(AcademicTask))
            predictions = await session.scalar(
                select(func.count()).select_from(AdaptiveEstimationPrediction)
            )
            outcomes = await session.scalar(select(func.count()).select_from(StudySessionOutcome))
            pending = await session.scalar(
                select(func.count())
                .select_from(AcademicTask)
                .where(AcademicTask.completed_at.is_(None))
            )

        assert accounts == 5
        assert tasks == 30
        assert predictions == 30
        assert outcomes == 25
        assert pending == 5
    finally:
        await database.stop()
