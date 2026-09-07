"""Seed the deterministic, pseudonymous evaluation dataset required by SPEC §24.1."""

import argparse
import asyncio
from datetime import UTC, datetime, time, timedelta
from decimal import Decimal
from uuid import NAMESPACE_URL, UUID, uuid5

from argon2 import PasswordHasher
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from studyflow.database.models.authentication import StudentAccount
from studyflow.database.models.availability import AvailabilityWindow, UnavailablePeriod
from studyflow.database.models.scheduling import (
    ProposalTaskAllocation,
    ScheduleProposal,
    StudySession,
    StudySessionOutcome,
)
from studyflow.database.models.tasks import AcademicTask, AdaptiveEstimationPrediction
from studyflow.settings import Settings

PARTICIPANT_COUNT = 5
COLD_START_TASK_COUNT = 5
CALIBRATION_TASK_COUNT = 5
TASKS_PER_PARTICIPANT = COLD_START_TASK_COUNT + CALIBRATION_TASK_COUNT + 1
EVALUATION_NAMESPACE = "https://studyflow.local/evaluation/2026-09"
BASE_TIME = datetime(2026, 9, 1, 9, 0, tzinfo=UTC)


def stable_id(kind: str, participant_number: int, item_number: int = 0) -> UUID:
    return uuid5(
        NAMESPACE_URL,
        f"{EVALUATION_NAMESPACE}/{kind}/{participant_number}/{item_number}",
    )


def account_email(participant_number: int) -> str:
    return f"evaluation-participant-{participant_number:02d}@studyflow.local"


def next_available_start(
    candidate: datetime,
    duration_minutes: int,
    unavailable_ranges: list[tuple[datetime, datetime]],
) -> datetime:
    """Find the next weekday session slot inside the evaluation availability window."""
    candidate = candidate.replace(second=0, microsecond=0)
    while True:
        if candidate.weekday() >= 5:
            candidate = (candidate + timedelta(days=1)).replace(hour=9, minute=0)
            continue
        if candidate.time() < time(9):
            candidate = candidate.replace(hour=9, minute=0)
        session_end = candidate + timedelta(minutes=duration_minutes)
        window_end = candidate.replace(hour=17, minute=0)
        if session_end > window_end or session_end.date() != candidate.date():
            candidate = (candidate + timedelta(days=1)).replace(hour=9, minute=0)
            continue
        overlapping_unavailable = next(
            (
                (unavailable_start, unavailable_end)
                for unavailable_start, unavailable_end in unavailable_ranges
                if candidate < unavailable_end and session_end > unavailable_start
            ),
            None,
        )
        if overlapping_unavailable is not None:
            candidate = overlapping_unavailable[1]
            continue
        return candidate


async def clear_existing(session: AsyncSession) -> None:
    """Remove only rows owned by this deterministic dataset so the seed is repeatable."""
    account_ids = [stable_id("account", number) for number in range(1, PARTICIPANT_COUNT + 1)]
    task_ids = [
        stable_id("task", participant, task_number)
        for participant in range(1, PARTICIPANT_COUNT + 1)
        for task_number in range(1, TASKS_PER_PARTICIPANT + 1)
    ]
    proposal_ids = [stable_id("proposal", number) for number in range(1, PARTICIPANT_COUNT + 1)]
    session_ids = [
        stable_id("session", participant, task_number)
        for participant in range(1, PARTICIPANT_COUNT + 1)
        for task_number in range(1, TASKS_PER_PARTICIPANT + 1)
    ]

    await session.execute(
        delete(StudySessionOutcome).where(StudySessionOutcome.session_id.in_(session_ids))
    )
    await session.execute(delete(StudySession).where(StudySession.id.in_(session_ids)))
    await session.execute(
        delete(ProposalTaskAllocation).where(ProposalTaskAllocation.proposal_id.in_(proposal_ids))
    )
    await session.execute(delete(ScheduleProposal).where(ScheduleProposal.id.in_(proposal_ids)))
    await session.execute(
        delete(AdaptiveEstimationPrediction).where(
            AdaptiveEstimationPrediction.task_id.in_(task_ids)
        )
    )
    await session.execute(delete(AcademicTask).where(AcademicTask.id.in_(task_ids)))
    await session.execute(
        delete(UnavailablePeriod).where(UnavailablePeriod.account_id.in_(account_ids))
    )
    await session.execute(
        delete(AvailabilityWindow).where(AvailabilityWindow.account_id.in_(account_ids))
    )
    await session.execute(delete(StudentAccount).where(StudentAccount.id.in_(account_ids)))
    await session.flush()


async def seed_evaluation_dataset(session: AsyncSession) -> list[UUID]:
    """Create the deterministic cold-start, calibration, and adaptive dataset."""
    await clear_existing(session)
    password_hash = PasswordHasher().hash("EvaluationPassword123!")
    account_ids: list[UUID] = []

    for participant_number in range(1, PARTICIPANT_COUNT + 1):
        account_id = stable_id("account", participant_number)
        account_ids.append(account_id)
        account = StudentAccount(
            id=account_id,
            email=account_email(participant_number),
            name=f"Evaluation Participant {participant_number:02d}",
            password_hash=password_hash,
            email_verified_at=BASE_TIME,
            timezone="UTC",
            availability_timezone_confirmed=True,
            preferred_session_length_minutes=60,
            minimum_break_minutes=10,
            created_at=BASE_TIME,
            updated_at=BASE_TIME,
        )
        session.add(account)

        for weekday in range(5):
            session.add(
                AvailabilityWindow(
                    id=stable_id("availability", participant_number, weekday),
                    account_id=account_id,
                    weekday=weekday,
                    local_start_time=time(9),
                    local_end_time=time(17),
                    crosses_midnight=False,
                )
            )

        unavailable_start = BASE_TIME + timedelta(days=participant_number, hours=2)
        unavailable_end = unavailable_start + timedelta(minutes=30)
        session.add(
            UnavailablePeriod(
                id=stable_id("unavailable", participant_number),
                account_id=account_id,
                starts_at=unavailable_start,
                ends_at=unavailable_end,
                reason="Evaluation block",
            )
        )

        proposal_id = stable_id("proposal", participant_number)
        session.add(
            ScheduleProposal(
                id=proposal_id,
                account_id=account_id,
                kind="generation",
                revision_reason=None,
                status="feasible",
                input_fingerprint=(f"evaluation-{participant_number}".ljust(64, "0"))[:64],
                scenario=None,
                created_at=BASE_TIME,
            )
        )

        next_session_start = BASE_TIME
        unavailable_ranges = [(unavailable_start, unavailable_end)]
        for task_number in range(1, TASKS_PER_PARTICIPANT + 1):
            task_id = stable_id("task", participant_number, task_number)
            original_minutes = 60
            adaptive_minutes = 80
            calibration = COLD_START_TASK_COUNT < task_number <= (
                COLD_START_TASK_COUNT + CALIBRATION_TASK_COUNT
            )
            adaptive_available = task_number == TASKS_PER_PARTICIPANT
            has_prediction = calibration or adaptive_available
            completed = task_number < TASKS_PER_PARTICIPANT
            planned_minutes = adaptive_minutes if adaptive_available else original_minutes
            task = AcademicTask(
                id=task_id,
                account_id=account_id,
                title=f"Evaluation Task {participant_number:02d}-{task_number:02d}",
                category=("reading" if task_number % 2 else "assignment"),
                priority="medium",
                course="EVAL-101",
                notes=None,
                deadline_at=BASE_TIME + timedelta(days=14),
                original_estimate_minutes=original_minutes,
                adaptive_estimate_minutes=adaptive_minutes if adaptive_available else None,
                planned_source="adaptive" if adaptive_available else "original",
                planned_duration_minutes=planned_minutes,
                estimate_frozen_at=BASE_TIME if completed else None,
                completed_at=None,
                finished_early_at=None,
                created_at=BASE_TIME,
                updated_at=BASE_TIME,
            )
            session.add(task)
            if has_prediction:
                session.add(
                    AdaptiveEstimationPrediction(
                        task_id=task_id,
                        account_id=account_id,
                        category=task.category,
                        original_minutes=original_minutes,
                        predicted_minutes=adaptive_minutes,
                        correction_factor=Decimal("1.33"),
                        history_scope="overall",
                        history_count=COLD_START_TASK_COUNT,
                        exposed=adaptive_available,
                        created_at=BASE_TIME + timedelta(days=task_number),
                    )
                )
            session.add(
                ProposalTaskAllocation(
                    proposal_id=proposal_id,
                    task_id=task_id,
                    deadline_at=task.deadline_at,
                    required_minutes=planned_minutes,
                    scheduled_minutes=planned_minutes,
                    unscheduled_minutes=0,
                    raw_calendar_capacity_minutes=480,
                    available_minutes_before_deadline=480,
                    shortfall_minutes=0,
                )
            )

            study_session_id = stable_id("session", participant_number, task_number)
            starts_at = next_available_start(
                next_session_start,
                planned_minutes,
                unavailable_ranges,
            )
            next_session_start = starts_at + timedelta(minutes=planned_minutes + 10)
            study_session = StudySession(
                id=study_session_id,
                account_id=account_id,
                task_id=task_id,
                proposal_id=None,
                starts_at=starts_at,
                ends_at=starts_at + timedelta(minutes=planned_minutes),
                planned_duration_minutes=planned_minutes,
            )
            session.add(study_session)
            if completed:
                outcome_recorded_at = starts_at + timedelta(minutes=planned_minutes)
                task.completed_at = outcome_recorded_at
                session.add(
                    StudySessionOutcome(
                        session_id=study_session_id,
                        kind="completed",
                        actual_minutes=80,
                        remaining_minutes=0,
                        recorded_at=outcome_recorded_at,
                        rescheduled_at=None,
                    )
                )

    return account_ids


async def run_seed(database_url: str) -> None:
    engine = create_async_engine(database_url)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with session_factory() as session:
            account_ids = await seed_evaluation_dataset(session)
            await session.commit()
            print(
                f"Seeded {len(account_ids)} evaluation participants with "
                f"{TASKS_PER_PARTICIPANT} predictions each."
            )
    finally:
        await engine.dispose()


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed the deterministic evaluation dataset")
    parser.add_argument(
        "--database-url",
        type=str,
        help="Database URL (defaults to STUDYFLOW_DATABASE_URL from environment/settings)",
    )
    args = parser.parse_args()
    database_url = args.database_url or Settings().database_url.get_secret_value()
    asyncio.run(run_seed(database_url))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
