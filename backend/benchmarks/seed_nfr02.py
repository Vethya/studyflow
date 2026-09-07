"""Database seeder for the SPEC NFR-02 performance profile (50 tasks / 250 sessions / 16 weeks)."""

import argparse
import asyncio
import sys
from collections.abc import Sequence
from datetime import UTC, datetime, time, timedelta
from uuid import UUID, uuid4

from argon2 import PasswordHasher
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from studyflow.database.models.authentication import StudentAccount
from studyflow.database.models.availability import AvailabilityWindow, UnavailablePeriod
from studyflow.database.models.scheduling import (
    ProposalTaskAllocation,
    ScheduleProposal,
    StudySession,
)
from studyflow.database.models.tasks import AcademicTask
from studyflow.settings import Settings

BENCHMARK_EMAIL = "nfr02_benchmark@studyflow.local"
BENCHMARK_PASSWORD = "BenchmarkPassword123!"
TASK_CATEGORIES = [
    "assignment",
    "reading",
    "exam_preparation",
    "project",
    "research_writing",
    "other",
]
TASK_PRIORITIES = ["low", "medium", "high"]


def compute_calendar_capacity_minutes(
    start_time: datetime,
    deadline_at: datetime,
    unavailable_ranges: Sequence[tuple[datetime, datetime]],
) -> int:
    """Compute available working calendar minutes between start_time and deadline_at."""
    total_minutes = 0
    current_day = start_time.date()
    end_date = deadline_at.date()

    while current_day <= end_date:
        if current_day.weekday() < 5:  # Monday through Friday
            win_start = datetime.combine(current_day, time(9, 0), tzinfo=UTC)
            win_end = datetime.combine(current_day, time(17, 0), tzinfo=UTC)
            eff_start = max(start_time, win_start)
            eff_end = min(deadline_at, win_end)
            if eff_end > eff_start:
                day_minutes = int((eff_end - eff_start).total_seconds() // 60)
                for u_start, u_end in unavailable_ranges:
                    ov_start = max(eff_start, u_start)
                    ov_end = min(eff_end, u_end)
                    if ov_end > ov_start:
                        day_minutes -= int((ov_end - ov_start).total_seconds() // 60)
                total_minutes += max(0, day_minutes)
        current_day += timedelta(days=1)

    return total_minutes


async def seed_nfr02_dataset(session: AsyncSession) -> UUID:
    """Seed 1 student, 50 tasks, 250 sessions, 16-week horizon, and 50 unavailable periods."""
    hasher = PasswordHasher()
    password_hash = hasher.hash(BENCHMARK_PASSWORD)

    # 1. Clean up existing benchmark account if present
    existing = await session.execute(
        select(StudentAccount).where(StudentAccount.email == BENCHMARK_EMAIL)
    )
    existing_account = existing.scalar_one_or_none()
    if existing_account is not None:
        await session.delete(existing_account)
        await session.flush()

    # 2. Create Student Account
    now = datetime.now(UTC).replace(microsecond=0)
    account = StudentAccount(
        id=uuid4(),
        email=BENCHMARK_EMAIL,
        name="NFR-02 Benchmark Participant",
        password_hash=password_hash,
        email_verified_at=now,
        timezone="UTC",
        availability_timezone_confirmed=True,
        preferred_session_length_minutes=60,
        minimum_break_minutes=10,
        created_at=now,
        updated_at=now,
    )
    session.add(account)
    await session.flush()
    account_id = account.id

    # 3. Create Weekly Availability Windows (Monday - Friday 09:00 - 17:00, UTC)
    for weekday in range(5):  # 0: Monday .. 4: Friday
        window = AvailabilityWindow(
            id=uuid4(),
            account_id=account_id,
            weekday=weekday,
            local_start_time=time(9, 0),
            local_end_time=time(17, 0),
            crosses_midnight=False,
        )
        session.add(window)

    # 4. Create 50 Unavailable Periods across the 16-week (112-day) horizon
    # 30-minute unavailable gap (11:00 - 11:30) on 50 separate weekdays
    unavailable_count = 0
    day_offset = 0
    base_date = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    unavailable_ranges: list[tuple[datetime, datetime]] = []
    while unavailable_count < 50 and day_offset < 112:
        current_day = base_date + timedelta(days=day_offset)
        if current_day.weekday() < 5:  # Weekday
            u_start = current_day.replace(hour=11, minute=0)
            u_end = current_day.replace(hour=11, minute=30)
            unavail = UnavailablePeriod(
                id=uuid4(),
                account_id=account_id,
                starts_at=u_start,
                ends_at=u_end,
                reason=f"Unavailable block #{unavailable_count + 1}",
            )
            session.add(unavail)
            unavailable_ranges.append((u_start, u_end))
            unavailable_count += 1
        day_offset += 1

    # 5. Create 50 Active Academic Tasks
    tasks: list[AcademicTask] = []
    for task_idx in range(50):
        # Deadlines distributed evenly across 16 weeks (from day 7 to day 112)
        deadline_day = 7 + (task_idx * 105 // 49)
        deadline_at = base_date + timedelta(days=deadline_day, hours=17)
        task = AcademicTask(
            id=uuid4(),
            account_id=account_id,
            title=f"NFR-02 Academic Task {task_idx + 1:02d}",
            category=TASK_CATEGORIES[task_idx % len(TASK_CATEGORIES)],
            priority=TASK_PRIORITIES[task_idx % len(TASK_PRIORITIES)],
            course=f"COURSE-{(task_idx % 5) + 101}",
            notes=f"Benchmark workload task {task_idx + 1}",
            deadline_at=deadline_at,
            original_estimate_minutes=300,  # 5 hours = 5 x 60 min sessions
            adaptive_estimate_minutes=None,
            planned_source="original",
            planned_duration_minutes=300,
            created_at=now,
            updated_at=now,
        )
        session.add(task)
        tasks.append(task)
    await session.flush()

    # 6. Create a current Schedule Proposal with 250 proposed Study Sessions
    proposal = ScheduleProposal(
        id=uuid4(),
        account_id=account_id,
        kind="generation",
        status="feasible",
        input_fingerprint="0" * 64,
        created_at=now,
    )
    session.add(proposal)
    await session.flush()

    # Generate 250 sessions (5 sessions per task, 60 minutes each)
    session_count = 0
    current_schedule_time = base_date.replace(hour=9, minute=0)
    planning_start = base_date.replace(hour=9, minute=0)
    for task in tasks:
        capacity = compute_calendar_capacity_minutes(
            planning_start,
            task.deadline_at,
            unavailable_ranges,
        )
        # Task allocations
        alloc = ProposalTaskAllocation(
            proposal_id=proposal.id,
            task_id=task.id,
            deadline_at=task.deadline_at,
            required_minutes=300,
            scheduled_minutes=300,
            unscheduled_minutes=0,
            raw_calendar_capacity_minutes=capacity,
            # This field reports the task's allocation. Raw calendar capacity is
            # kept separately above because several tasks share the same calendar.
            available_minutes_before_deadline=300,
            shortfall_minutes=0,
        )
        session.add(alloc)

        # 5 sessions of 60 mins
        for _ in range(5):
            # Advance to next valid weekday working slot
            while True:
                if current_schedule_time.weekday() >= 5:
                    current_schedule_time = (current_schedule_time + timedelta(days=1)).replace(
                        hour=9, minute=0, second=0, microsecond=0
                    )
                    continue
                if current_schedule_time.time() < time(9, 0):
                    current_schedule_time = current_schedule_time.replace(
                        hour=9, minute=0, second=0, microsecond=0
                    )
                    continue
                cand_end = current_schedule_time + timedelta(minutes=60)
                if cand_end.time() > time(17, 0) or cand_end.date() != current_schedule_time.date():
                    current_schedule_time = (current_schedule_time + timedelta(days=1)).replace(
                        hour=9, minute=0, second=0, microsecond=0
                    )
                    continue
                overlap = False
                for u_start, u_end in unavailable_ranges:
                    if current_schedule_time < u_end and cand_end > u_start:
                        current_schedule_time = u_end
                        overlap = True
                        break
                if overlap:
                    continue
                break

            session_end = current_schedule_time + timedelta(minutes=60)
            study_session = StudySession(
                id=uuid4(),
                account_id=account_id,
                task_id=task.id,
                proposal_id=proposal.id,
                starts_at=current_schedule_time,
                ends_at=session_end,
                planned_duration_minutes=60,
            )
            session.add(study_session)
            session_count += 1
            # 10 min break
            current_schedule_time = session_end + timedelta(minutes=10)

    await session.commit()
    return account_id


async def run_seed(database_url: str) -> None:
    engine = create_async_engine(database_url)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with session_factory() as session:
            account_id = await seed_nfr02_dataset(session)
            print(f"Successfully seeded NFR-02 dataset for account ID: {account_id}")
            print(f"Credentials -> Email: {BENCHMARK_EMAIL} | Password: {BENCHMARK_PASSWORD}")
    finally:
        await engine.dispose()


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed NFR-02 representative performance dataset")
    parser.add_argument(
        "--database-url",
        type=str,
        help="Database URL (defaults to STUDYFLOW_DATABASE_URL from settings)",
    )
    args = parser.parse_args()
    settings = Settings()
    db_url = args.database_url or settings.database_url.get_secret_value()

    asyncio.run(run_seed(db_url))
    return 0


if __name__ == "__main__":
    sys.exit(main())
