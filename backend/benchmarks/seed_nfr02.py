"""Database seeder for the SPEC NFR-02 performance profile (50 tasks / 250 sessions / 16 weeks)."""

import argparse
import asyncio
import hashlib
import os
import sys
from collections.abc import Sequence
from datetime import UTC, datetime, time, timedelta
from typing import Any
from uuid import UUID, uuid4

from argon2 import PasswordHasher
from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from studyflow.database.models.authentication import StudentAccount
from studyflow.database.models.availability import AvailabilityWindow, UnavailablePeriod
from studyflow.database.models.scheduling import (
    ProposalTaskAllocation,
    RecoverySnapshotOutcome,
    RecoveryTaskWork,
    ScheduleProposal,
    ScheduleRecoverySnapshot,
    StudySession,
    StudySessionOutcome,
)
from studyflow.database.models.tasks import AcademicTask, TaskDeadlineHistory
from studyflow.settings import Settings

BENCHMARK_EMAIL = "nfr02_benchmark@studyflow.dev"
BENCHMARK_PASSWORD = "BenchmarkPassword123!"
BENCHMARK_INPUT_FINGERPRINT = hashlib.sha256(b"studyflow-nfr02-workload-v1").hexdigest()
LEGACY_INPUT_FINGERPRINT = "0" * 64
TASK_TITLE_PREFIX = "NFR-02 Academic Task "
UNAVAILABLE_REASON_PREFIX = "NFR-02 Benchmark unavailable block #"
LEGACY_UNAVAILABLE_REASON_PREFIX = "Unavailable block #"
EXPECTED_DATA_COUNTS = {
    "tasks": 50,
    "sessions": 250,
    "availability_windows": 5,
    "unavailable_periods": 50,
    "schedule_proposals": 1,
    "proposal_allocations": 50,
}
BENCHMARK_TIMEZONE = "UTC"
BENCHMARK_SESSION_LENGTH_MINUTES = 60
BENCHMARK_MINIMUM_BREAK_MINUTES = 10
BENCHMARK_HORIZON_DAYS = 112
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


async def account_data_counts(session: AsyncSession, account_id: UUID) -> dict[str, int]:
    """Count the account-owned rows that affect the NFR-02 workload."""

    async def count_for(model: Any) -> int:
        value = await session.scalar(
            select(func.count()).select_from(model).where(model.account_id == account_id)
        )
        return int(value or 0)

    allocation_count = await session.scalar(
        select(func.count())
        .select_from(ProposalTaskAllocation)
        .join(ScheduleProposal, ProposalTaskAllocation.proposal_id == ScheduleProposal.id)
        .where(ScheduleProposal.account_id == account_id)
    )
    return {
        "tasks": await count_for(AcademicTask),
        "sessions": await count_for(StudySession),
        "availability_windows": await count_for(AvailabilityWindow),
        "unavailable_periods": await count_for(UnavailablePeriod),
        "schedule_proposals": await count_for(ScheduleProposal),
        "proposal_allocations": int(allocation_count or 0),
    }


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _validate_benchmark_preferences(account: StudentAccount) -> None:
    mismatches: list[str] = []
    if account.timezone != BENCHMARK_TIMEZONE:
        mismatches.append(f"timezone={account.timezone!r}")
    if account.preferred_session_length_minutes != BENCHMARK_SESSION_LENGTH_MINUTES:
        mismatches.append(
            f"preferred_session_length_minutes={account.preferred_session_length_minutes!r}"
        )
    if account.minimum_break_minutes != BENCHMARK_MINIMUM_BREAK_MINUTES:
        mismatches.append(f"minimum_break_minutes={account.minimum_break_minutes!r}")
    if not account.availability_timezone_confirmed:
        mismatches.append("availability_timezone_confirmed=False")
    if mismatches:
        expected = (
            f"timezone={BENCHMARK_TIMEZONE!r}, "
            f"preferred_session_length_minutes={BENCHMARK_SESSION_LENGTH_MINUTES}, "
            f"minimum_break_minutes={BENCHMARK_MINIMUM_BREAK_MINUTES}, "
            "availability_timezone_confirmed=True"
        )
        raise RuntimeError(
            "Refusing NFR-02 seed: the selected account's scheduling preferences do not "
            f"match the benchmark ({', '.join(mismatches)}; expected {expected})."
        )


async def _has_current_nfr02_horizon(session: AsyncSession, account_id: UUID) -> bool:
    tasks = (
        await session.scalars(select(AcademicTask).where(AcademicTask.account_id == account_id))
    ).all()
    unavailable = (
        await session.scalars(
            select(UnavailablePeriod).where(UnavailablePeriod.account_id == account_id)
        )
    ).all()
    if not tasks or not unavailable:
        return False

    now = datetime.now(UTC)
    deadlines = [_as_utc(task.deadline_at) for task in tasks]
    unavailable_endpoints = [
        (_as_utc(period.starts_at), _as_utc(period.ends_at)) for period in unavailable
    ]
    return (
        all(deadline > now for deadline in deadlines)
        and max(deadlines) >= now + timedelta(days=BENCHMARK_HORIZON_DAYS)
        and all(starts_at > now and ends_at > now for starts_at, ends_at in unavailable_endpoints)
    )


async def has_complete_nfr02_dataset(session: AsyncSession, account_id: UUID) -> bool:
    """Return whether this account already contains the complete seeded workload."""

    proposal = await session.scalar(
        select(ScheduleProposal).where(
            ScheduleProposal.account_id == account_id,
            ScheduleProposal.input_fingerprint.in_(
                {BENCHMARK_INPUT_FINGERPRINT, LEGACY_INPUT_FINGERPRINT}
            ),
        )
    )
    if proposal is None:
        return False

    counts = await account_data_counts(session, account_id)
    return counts == EXPECTED_DATA_COUNTS and await _has_current_nfr02_horizon(session, account_id)


async def _benchmark_reset_targets(
    session: AsyncSession,
    account_id: UUID,
) -> tuple[list[UUID], list[UUID], list[UUID], list[UUID], list[UUID]]:
    """Validate ownership and return task, proposal, session, and availability IDs."""
    tasks = (
        await session.scalars(select(AcademicTask).where(AcademicTask.account_id == account_id))
    ).all()
    expected_titles = {f"{TASK_TITLE_PREFIX}{index:02d}" for index in range(1, 51)}
    if len(tasks) != len(expected_titles) or {task.title for task in tasks} != expected_titles:
        raise RuntimeError(
            "Refusing --reset-existing: the account has tasks that are not exclusively "
            "owned by the NFR-02 benchmark."
        )
    task_ids = [task.id for task in tasks]

    unavailable = (
        await session.scalars(
            select(UnavailablePeriod).where(UnavailablePeriod.account_id == account_id)
        )
    ).all()
    actual_reasons = {period.reason for period in unavailable}
    expected_reason_sets = [
        {f"{prefix}{index}" for index in range(1, 51)}
        for prefix in (UNAVAILABLE_REASON_PREFIX, LEGACY_UNAVAILABLE_REASON_PREFIX)
    ]
    if len(unavailable) != 50 or actual_reasons not in expected_reason_sets:
        raise RuntimeError(
            "Refusing --reset-existing: the account has unavailable periods that are not "
            "exclusively owned by the NFR-02 benchmark."
        )
    unavailable_ids = [period.id for period in unavailable]

    windows = (
        await session.scalars(
            select(AvailabilityWindow).where(AvailabilityWindow.account_id == account_id)
        )
    ).all()
    expected_windows = {(weekday, time(9, 0), time(17, 0), False) for weekday in range(5)}
    actual_windows = {
        (
            window.weekday,
            window.local_start_time,
            window.local_end_time,
            window.crosses_midnight,
        )
        for window in windows
    }
    if len(windows) != 5 or actual_windows != expected_windows:
        raise RuntimeError(
            "Refusing --reset-existing: the account has availability windows that are not "
            "exclusively owned by the NFR-02 benchmark."
        )
    window_ids = [window.id for window in windows]

    proposals = (
        await session.scalars(
            select(ScheduleProposal).where(ScheduleProposal.account_id == account_id)
        )
    ).all()
    if len(proposals) > 1:
        raise RuntimeError(
            "Refusing --reset-existing: the account has multiple schedule proposals."
        )
    # The proposal may have been manually deleted; task and availability markers
    # below still provide a safe reset boundary for the remaining footprint.
    proposal_ids = [proposals[0].id] if proposals else []
    proposal_matches_benchmark_tasks = False
    if proposal_ids:
        allocations = (
            await session.scalars(
                select(ProposalTaskAllocation).where(
                    ProposalTaskAllocation.proposal_id.in_(proposal_ids)
                )
            )
        ).all()
        proposal_matches_benchmark_tasks = len(allocations) == 50 and {
            allocation.task_id for allocation in allocations
        } == set(task_ids)
        if not proposal_matches_benchmark_tasks:
            raise RuntimeError(
                "Refusing --reset-existing: the benchmark proposal contains allocations for "
                "unexpected tasks."
            )

    # API-generated benchmark proposals have a runtime fingerprint rather than
    # the fixed seeder fingerprint. Their complete allocation set is the
    # ownership marker in that case.
    known_benchmark_fingerprint = bool(proposals) and proposals[0].input_fingerprint in {
        BENCHMARK_INPUT_FINGERPRINT,
        LEGACY_INPUT_FINGERPRINT,
    }
    if proposals and not known_benchmark_fingerprint and not proposal_matches_benchmark_tasks:
        raise RuntimeError(
            "Refusing --reset-existing: the account has a schedule proposal that is not "
            "exclusively owned by the NFR-02 benchmark."
        )

    study_sessions = (
        await session.scalars(select(StudySession).where(StudySession.account_id == account_id))
    ).all()
    if any(
        study_session.task_id not in task_ids
        or (study_session.proposal_id is not None and study_session.proposal_id not in proposal_ids)
        for study_session in study_sessions
    ):
        raise RuntimeError(
            "Refusing --reset-existing: the account has study sessions outside the benchmark tasks."
        )
    session_ids = [study_session.id for study_session in study_sessions]

    snapshots = (
        await session.scalars(
            select(ScheduleRecoverySnapshot).where(
                ScheduleRecoverySnapshot.account_id == account_id
            )
        )
    ).all()
    if any(
        snapshot.proposal_id not in proposal_ids or snapshot.missed_session_id not in session_ids
        for snapshot in snapshots
    ):
        raise RuntimeError(
            "Refusing --reset-existing: the account has recovery snapshots outside the "
            "benchmark proposal."
        )

    recovery_work = (
        await session.scalars(
            select(RecoveryTaskWork).where(
                or_(
                    RecoveryTaskWork.proposal_id.in_(proposal_ids),
                    RecoveryTaskWork.task_id.in_(task_ids),
                )
            )
        )
    ).all()
    if any(
        work.proposal_id not in proposal_ids or work.task_id not in task_ids
        for work in recovery_work
    ):
        raise RuntimeError(
            "Refusing --reset-existing: recovery work is linked to unexpected benchmark rows."
        )

    snapshot_outcomes = (
        await session.scalars(
            select(RecoverySnapshotOutcome).where(
                or_(
                    RecoverySnapshotOutcome.proposal_id.in_(proposal_ids),
                    RecoverySnapshotOutcome.session_id.in_(session_ids),
                )
            )
        )
    ).all()
    if any(
        outcome.proposal_id not in proposal_ids or outcome.session_id not in session_ids
        for outcome in snapshot_outcomes
    ):
        raise RuntimeError(
            "Refusing --reset-existing: recovery outcomes are linked to unexpected benchmark rows."
        )

    return task_ids, proposal_ids, session_ids, unavailable_ids, window_ids


async def _reset_nfr02_dataset(
    session: AsyncSession,
    *,
    task_ids: list[UUID],
    proposal_ids: list[UUID],
    session_ids: list[UUID],
    unavailable_ids: list[UUID],
    window_ids: list[UUID],
) -> None:
    """Delete a validated NFR-02 footprint while preserving the student account."""
    if session_ids:
        await session.execute(
            delete(RecoverySnapshotOutcome).where(
                RecoverySnapshotOutcome.session_id.in_(session_ids)
            )
        )
        await session.execute(
            delete(StudySessionOutcome).where(StudySessionOutcome.session_id.in_(session_ids))
        )
    if proposal_ids:
        await session.execute(
            delete(RecoverySnapshotOutcome).where(
                RecoverySnapshotOutcome.proposal_id.in_(proposal_ids)
            )
        )
        await session.execute(
            delete(RecoveryTaskWork).where(RecoveryTaskWork.proposal_id.in_(proposal_ids))
        )
        await session.execute(
            delete(ScheduleRecoverySnapshot).where(
                ScheduleRecoverySnapshot.proposal_id.in_(proposal_ids)
            )
        )
        await session.execute(
            delete(ProposalTaskAllocation).where(
                ProposalTaskAllocation.proposal_id.in_(proposal_ids)
            )
        )
    if session_ids:
        await session.execute(delete(StudySession).where(StudySession.id.in_(session_ids)))
    if task_ids:
        await session.execute(
            delete(TaskDeadlineHistory).where(TaskDeadlineHistory.task_id.in_(task_ids))
        )
    if proposal_ids:
        await session.execute(delete(ScheduleProposal).where(ScheduleProposal.id.in_(proposal_ids)))
    if unavailable_ids:
        await session.execute(
            delete(UnavailablePeriod).where(UnavailablePeriod.id.in_(unavailable_ids))
        )
    if window_ids:
        await session.execute(
            delete(AvailabilityWindow).where(AvailabilityWindow.id.in_(window_ids))
        )
    if task_ids:
        await session.execute(delete(AcademicTask).where(AcademicTask.id.in_(task_ids)))


async def seed_nfr02_dataset(
    session: AsyncSession,
    *,
    email: str = BENCHMARK_EMAIL,
    password: str = BENCHMARK_PASSWORD,
    require_existing: bool = False,
    reset_existing: bool = False,
    dry_run: bool = False,
) -> UUID:
    """Seed the NFR-02 workload without replacing an existing student account."""
    normalized_email = email.strip().lower()
    existing_account = await session.scalar(
        select(StudentAccount).where(StudentAccount.email == normalized_email)
    )

    if existing_account is not None:
        _validate_benchmark_preferences(existing_account)
        complete_dataset = await has_complete_nfr02_dataset(session, existing_account.id)
        if complete_dataset and not reset_existing:
            return existing_account.id

        counts = await account_data_counts(session, existing_account.id)
        existing_data = {name: count for name, count in counts.items() if count}
        if existing_data:
            if not reset_existing:
                details = ", ".join(f"{name}={count}" for name, count in existing_data.items())
                raise RuntimeError(
                    f"Account {normalized_email} already contains data ({details}). "
                    "The NFR-02 seeder will not mix benchmark rows with existing student data. "
                    "Use --reset-existing only for a verified benchmark account."
                )

            reset_targets = await _benchmark_reset_targets(session, existing_account.id)
            if dry_run:
                print(
                    f"NFR-02 reset dry run: would remove {counts['tasks']} tasks, "
                    f"{counts['sessions']} sessions, {counts['availability_windows']} "
                    f"availability windows, {counts['unavailable_periods']} unavailable "
                    f"periods, and {counts['schedule_proposals']} schedule proposal(s) "
                    f"from account {existing_account.id}."
                )
                return existing_account.id

            await _reset_nfr02_dataset(
                session,
                task_ids=reset_targets[0],
                proposal_ids=reset_targets[1],
                session_ids=reset_targets[2],
                unavailable_ids=reset_targets[3],
                window_ids=reset_targets[4],
            )

        account_id = existing_account.id
        if dry_run:
            print(
                f"NFR-02 reset dry run: account {account_id} is empty; would seed the "
                "NFR-02 workload."
            )
            return account_id
    else:
        if require_existing:
            raise RuntimeError(
                f"No existing student account found for {normalized_email}. "
                "The configured-account seeder will not create or guess an account."
            )

        # Creation is retained for isolated local fixtures; the CLI requires an existing account.
        hasher = PasswordHasher()
        password_hash = hasher.hash(password)
        now = datetime.now(UTC).replace(microsecond=0)
        account = StudentAccount(
            id=uuid4(),
            email=normalized_email,
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

    # Seed rows under the selected account. Existing account credentials remain untouched.
    now = datetime.now(UTC).replace(microsecond=0)

    # 1. Create Weekly Availability Windows (Monday - Friday 09:00 - 17:00, UTC)
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
                reason=f"{UNAVAILABLE_REASON_PREFIX}{unavailable_count + 1}",
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
            title=f"{TASK_TITLE_PREFIX}{task_idx + 1:02d}",
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

    # 6. Create Accepted Schedule Proposal with 250 Study Sessions
    proposal = ScheduleProposal(
        id=uuid4(),
        account_id=account_id,
        kind="generation",
        status="feasible",
        input_fingerprint=BENCHMARK_INPUT_FINGERPRINT,
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
            available_minutes_before_deadline=capacity,
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
                proposal_id=None,
                starts_at=current_schedule_time,
                ends_at=session_end,
                planned_duration_minutes=60,
            )
            session.add(study_session)
            session_count += 1
            # 10 min break
            current_schedule_time = session_end + timedelta(minutes=10)

    if not dry_run:
        await session.commit()
    return account_id


async def run_seed(
    database_url: str,
    *,
    email: str = BENCHMARK_EMAIL,
    password: str = BENCHMARK_PASSWORD,
    require_existing: bool = False,
    reset_existing: bool = False,
    dry_run: bool = False,
) -> None:
    engine = create_async_engine(database_url)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with session_factory() as session:
            try:
                account_id = await seed_nfr02_dataset(
                    session,
                    email=email,
                    password=password,
                    require_existing=require_existing,
                    reset_existing=reset_existing,
                    dry_run=dry_run,
                )
            except Exception:
                await session.rollback()
                raise
            print(f"NFR-02 dataset ready for account ID: {account_id}")
            if require_existing:
                print("Existing account selected; its password and profile were not changed.")
            else:
                print(f"Credentials -> Email: {email} | Password: {password}")
    finally:
        await engine.dispose()


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed NFR-02 representative performance dataset")
    parser.add_argument(
        "--database-url",
        type=str,
        help="Database URL (defaults to STUDYFLOW_DATABASE_URL from settings)",
    )
    parser.add_argument(
        "--email",
        type=str,
        default=os.environ.get("NFR02_BENCHMARK_EMAIL"),
        help="Existing student account email (also settable via NFR02_BENCHMARK_EMAIL)",
    )
    parser.add_argument(
        "--reset-existing",
        action="store_true",
        help=("Delete a verified NFR-02 data footprint from the selected account before reseeding"),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what --reset-existing would remove without changing the database",
    )
    args = parser.parse_args()
    if not args.email:
        parser.error("--email or NFR02_BENCHMARK_EMAIL is required")
    if args.dry_run and not args.reset_existing:
        parser.error("--dry-run requires --reset-existing")
    settings = Settings()
    db_url = args.database_url or settings.database_url.get_secret_value()

    asyncio.run(
        run_seed(
            db_url,
            email=args.email,
            require_existing=True,
            reset_existing=args.reset_existing,
            dry_run=args.dry_run,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
