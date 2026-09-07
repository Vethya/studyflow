"""Regression checks for the deterministic evaluation resource seed."""

import sys
from pathlib import Path

import pytest
from sqlalchemy import func, select

sys.path.insert(0, str(Path(__file__).parents[1]))

from benchmarks.seed_evaluation import (
    BASE_TIME,
    CALIBRATION_TASK_COUNT,
    COLD_START_TASK_COUNT,
    TASKS_PER_PARTICIPANT,
    seed_evaluation_dataset,
    stable_id,
)
from studyflow.database import Base, Database
from studyflow.database.models.authentication import StudentAccount
from studyflow.database.models.availability import AvailabilityWindow, UnavailablePeriod
from studyflow.database.models.scheduling import StudySession, StudySessionOutcome
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
        assert tasks == 5 * TASKS_PER_PARTICIPANT
        assert predictions == 5 * (CALIBRATION_TASK_COUNT + 1)
        assert outcomes == 5 * (TASKS_PER_PARTICIPANT - 1)
        assert pending == 5

        async with database.transaction() as session:
            seeded_tasks = (
                (
                    await session.execute(
                        select(AcademicTask).where(
                            AcademicTask.account_id == stable_id("account", 1)
                        )
                    )
                )
                .scalars()
                .all()
            )
            seeded_predictions = (
                (
                    await session.execute(
                        select(AdaptiveEstimationPrediction).where(
                            AdaptiveEstimationPrediction.account_id == stable_id("account", 1)
                        )
                    )
                )
                .scalars()
                .all()
            )

        tasks_by_number = {
            task.id: number
            for number in range(1, TASKS_PER_PARTICIPANT + 1)
            for task in seeded_tasks
            if task.id == stable_id("task", 1, number)
        }
        predictions_by_number = {
            tasks_by_number[prediction.task_id]: prediction
            for prediction in seeded_predictions
        }

        assert set(predictions_by_number) == set(
            range(COLD_START_TASK_COUNT + 1, TASKS_PER_PARTICIPANT + 1)
        )
        assert all(
            not predictions_by_number[number].exposed
            for number in range(COLD_START_TASK_COUNT + 1, TASKS_PER_PARTICIPANT)
        )
        assert predictions_by_number[TASKS_PER_PARTICIPANT].exposed
        assert all(
            task.adaptive_estimate_minutes is None
            and task.planned_source == "original"
            for task in seeded_tasks
            if tasks_by_number[task.id] <= COLD_START_TASK_COUNT + CALIBRATION_TASK_COUNT
        )
        adaptive_task = next(
            task for task in seeded_tasks if tasks_by_number[task.id] == TASKS_PER_PARTICIPANT
        )
        assert adaptive_task.adaptive_estimate_minutes == 80
        assert adaptive_task.planned_source == "adaptive"

        async with database.transaction() as session:
            windows = (
                (await session.execute(select(AvailabilityWindow))).scalars().all()
            )
            unavailable_periods = (
                (await session.execute(select(UnavailablePeriod))).scalars().all()
            )
            study_sessions = (
                (await session.execute(select(StudySession).order_by(StudySession.starts_at)))
                .scalars()
                .all()
            )

        windows_by_account = {}
        for window in windows:
            windows_by_account.setdefault(window.account_id, []).append(window)
        unavailable_by_account = {}
        for period in unavailable_periods:
            unavailable_by_account.setdefault(period.account_id, []).append(period)

        assert study_sessions[0].starts_at.replace(tzinfo=BASE_TIME.tzinfo) == BASE_TIME
        for study_session in study_sessions:
            assert study_session.starts_at.weekday() < 5
            assert study_session.starts_at.time() >= windows_by_account[
                study_session.account_id
            ][0].local_start_time
            assert study_session.ends_at.time() <= windows_by_account[
                study_session.account_id
            ][0].local_end_time
            assert all(
                not (
                    study_session.starts_at < period.ends_at
                    and study_session.ends_at > period.starts_at
                )
                for period in unavailable_by_account[study_session.account_id]
            )
    finally:
        await database.stop()
