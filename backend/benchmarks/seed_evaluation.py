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
TASKS_PER_PARTICIPANT = 6
EVALUATION_NAMESPACE = "https://studyflow.local/evaluation/2026-09"
BASE_TIME = datetime(2026, 9, 1, 9, 0, tzinfo=UTC)


def stable_id(kind: str, participant_number: int, item_number: int = 0) -> UUID:
    return uuid5(
        NAMESPACE_URL,
        f"{EVALUATION_NAMESPACE}/{kind}/{participant_number}/{item_number}",
    )


def account_email(participant_number: int) -> str:
    return f"evaluation-participant-{participant_number:02d}@studyflow.local"


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
    """Create five participants, six predictions each, and completed/pending outcomes."""
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
        session.add(
            UnavailablePeriod(
                id=stable_id("unavailable", participant_number),
                account_id=account_id,
                starts_at=unavailable_start,
                ends_at=unavailable_start + timedelta(minutes=30),
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

        for task_number in range(1, TASKS_PER_PARTICIPANT + 1):
            task_id = stable_id("task", participant_number, task_number)
            original_minutes = 60
            adaptive_minutes = 80
            completed = task_number <= 5
            completed_at = BASE_TIME + timedelta(days=task_number, hours=1) if completed else None
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
                adaptive_estimate_minutes=adaptive_minutes,
                planned_source="adaptive",
                planned_duration_minutes=adaptive_minutes,
                estimate_frozen_at=BASE_TIME if completed else None,
                completed_at=completed_at,
                finished_early_at=None,
                created_at=BASE_TIME,
                updated_at=BASE_TIME,
            )
            session.add(task)
            session.add(
                AdaptiveEstimationPrediction(
                    task_id=task_id,
                    account_id=account_id,
                    category=task.category,
                    original_minutes=original_minutes,
                    predicted_minutes=adaptive_minutes,
                    correction_factor=Decimal("1.33"),
                    history_scope="category",
                    history_count=3,
                    exposed=True,
                    created_at=BASE_TIME,
                )
            )
            session.add(
                ProposalTaskAllocation(
                    proposal_id=proposal_id,
                    task_id=task_id,
                    deadline_at=task.deadline_at,
                    required_minutes=adaptive_minutes,
                    scheduled_minutes=adaptive_minutes,
                    unscheduled_minutes=0,
                    raw_calendar_capacity_minutes=480,
                    available_minutes_before_deadline=480,
                    shortfall_minutes=0,
                )
            )

            study_session_id = stable_id("session", participant_number, task_number)
            starts_at = BASE_TIME + timedelta(days=task_number, hours=2)
            study_session = StudySession(
                id=study_session_id,
                account_id=account_id,
                task_id=task_id,
                proposal_id=None,
                starts_at=starts_at,
                ends_at=starts_at + timedelta(minutes=adaptive_minutes),
                planned_duration_minutes=adaptive_minutes,
            )
            session.add(study_session)
            if completed:
                session.add(
                    StudySessionOutcome(
                        session_id=study_session_id,
                        kind="completed",
                        actual_minutes=70,
                        remaining_minutes=0,
                        recorded_at=starts_at + timedelta(minutes=adaptive_minutes),
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
