from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime, time, timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select

from studyflow.availability.repositories import SqlAlchemyFutureSessionInvalidator
from studyflow.availability.study_time import (
    StudyTimeBlockedPeriodChanges,
    StudyTimeBlockedPeriodUpdate,
    StudyTimeChanges,
    StudyTimePeriodNotFoundError,
    StudyTimeUpdateService,
)
from studyflow.availability.unavailable import UnavailablePeriodDraft
from studyflow.availability.windows import AvailabilityWindowDraft
from studyflow.database import Base, Database
from studyflow.database.models import AcademicTask, StudentAccount
from studyflow.database.models import StudySession as SessionRow
from studyflow.database.models import UnavailablePeriod as PeriodRow

NOW = datetime(2026, 9, 4, 10, tzinfo=UTC)
DRAFT = UnavailablePeriodDraft(NOW + timedelta(hours=1), NOW + timedelta(hours=2), "  Lunch  ")


@asynccontextmanager
async def study_time_database() -> AsyncIterator[tuple[Database, UUID, StudyTimeUpdateService]]:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    account_id = uuid4()
    try:
        async with database.transaction() as session:
            await session.run_sync(lambda sync: Base.metadata.create_all(sync.connection()))
            session.add(
                StudentAccount(
                    id=account_id,
                    email="study-time@example.com",
                    name="Student",
                    password_hash="hash",
                    timezone="UTC",
                    email_verified_at=NOW,
                )
            )
        yield (
            database,
            account_id,
            StudyTimeUpdateService(
                database, SqlAlchemyFutureSessionInvalidator(clock=lambda: NOW), clock=lambda: NOW
            ),
        )
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_grouped_update_persists_preferences_merges_windows_and_invalidates_sessions() -> (
    None
):
    async with study_time_database() as (database, account_id, service):
        task_id, session_id = uuid4(), uuid4()
        async with database.transaction() as session:
            session.add(
                AcademicTask(
                    id=task_id,
                    account_id=account_id,
                    title="Read",
                    category="reading",
                    deadline_at=NOW + timedelta(days=1),
                    original_estimate_minutes=60,
                    planned_duration_minutes=60,
                )
            )
            session.add(
                SessionRow(
                    id=session_id,
                    account_id=account_id,
                    task_id=task_id,
                    starts_at=DRAFT.starts_at,
                    ends_at=DRAFT.ends_at,
                    planned_duration_minutes=60,
                )
            )
        result = await service.apply(
            account_id,
            StudyTimeChanges(
                confirm_timezone=True,
                planning_preferences=("Asia/Bangkok", 45, 10),
                recurring_windows=(
                    AvailabilityWindowDraft(0, time(9), time(10)),
                    AvailabilityWindowDraft(0, time(10), time(11)),
                ),
                blocked_periods=StudyTimeBlockedPeriodChanges(add=(DRAFT,)),
            ),
        )
        assert result is not None
        assert result.timezone_confirmed
        assert result.planning_preferences is not None
        assert result.planning_preferences.timezone == "Asia/Bangkok"
        assert not result.planning_preferences.availability_confirmation_required
        assert result.recurring_windows is not None
        assert [(w.weekday, w.start_time, w.end_time) for w in result.recurring_windows] == [
            (0, time(9), time(11))
        ]
        assert result.added_blocked_periods[0].reason == "Lunch"
        assert result.invalidated_future_session_ids == [session_id]
        period_id = result.added_blocked_periods[0].id
        updated = await service.apply(
            account_id,
            StudyTimeChanges(
                blocked_periods=StudyTimeBlockedPeriodChanges(
                    update=(
                        StudyTimeBlockedPeriodUpdate(
                            period_id,
                            UnavailablePeriodDraft(
                                NOW + timedelta(hours=3), NOW + timedelta(hours=4)
                            ),
                        ),
                    )
                ),
            ),
        )
        assert updated is not None
        assert updated.updated_blocked_periods[0].starts_at == NOW + timedelta(hours=3)
        removed = await service.apply(
            account_id,
            StudyTimeChanges(
                recurring_windows=(),
                blocked_periods=StudyTimeBlockedPeriodChanges(remove=(period_id,)),
            ),
        )
        assert removed is not None
        assert removed.removed_blocked_period_ids == [period_id]
        assert removed.recurring_windows == []
        async with database.transaction() as session:
            assert await session.get(PeriodRow, period_id) is None
            row = await session.get(StudentAccount, account_id)
            assert row is not None
            assert (
                row.timezone,
                row.preferred_session_length_minutes,
                row.minimum_break_minutes,
            ) == ("Asia/Bangkok", 45, 10)


@pytest.mark.anyio
async def test_timezone_change_requires_confirmation_and_unknown_period_rolls_back_everything() -> (
    None
):
    async with study_time_database() as (database, account_id, service):
        assert await service.apply(uuid4(), StudyTimeChanges(confirm_timezone=True)) is None
        confirmed = await service.apply(account_id, StudyTimeChanges(confirm_timezone=True))
        assert confirmed is not None and confirmed.timezone_confirmed
        changed = await service.apply(
            account_id, StudyTimeChanges(planning_preferences=("Europe/London", 30, 5))
        )
        assert changed is not None and changed.planning_preferences is not None
        assert changed.planning_preferences.availability_confirmation_required
        with pytest.raises(StudyTimePeriodNotFoundError):
            await service.apply(
                account_id,
                StudyTimeChanges(
                    planning_preferences=("UTC", 120, 30),
                    blocked_periods=StudyTimeBlockedPeriodChanges(add=(DRAFT,), remove=(uuid4(),)),
                ),
            )
        async with database.transaction() as session:
            row = await session.get(StudentAccount, account_id)
            assert row is not None and row.timezone == "Europe/London"
            assert list(await session.scalars(select(PeriodRow))) == []


@pytest.mark.anyio
@pytest.mark.parametrize(
    "changes",
    [
        StudyTimeChanges(),
        StudyTimeChanges(planning_preferences=("Invalid/Zone", 30, 5)),
        StudyTimeChanges(planning_preferences=("UTC", 9, 5)),
        StudyTimeChanges(planning_preferences=("UTC", 241, 5)),
        StudyTimeChanges(planning_preferences=("UTC", 30, -1)),
        StudyTimeChanges(planning_preferences=("UTC", 30, 121)),
        StudyTimeChanges(blocked_periods=StudyTimeBlockedPeriodChanges()),
        StudyTimeChanges(
            blocked_periods=StudyTimeBlockedPeriodChanges(remove=(UUID(int=1), UUID(int=1)))
        ),
        StudyTimeChanges(
            blocked_periods=StudyTimeBlockedPeriodChanges(
                add=(UnavailablePeriodDraft(NOW - timedelta(hours=1), NOW),)
            )
        ),
    ],
)
async def test_invalid_grouped_changes_leave_persisted_preferences_unchanged(
    changes: StudyTimeChanges,
) -> None:
    async with study_time_database() as (database, account_id, service):
        with pytest.raises(ValueError):
            await service.apply(account_id, changes)
        async with database.transaction() as session:
            row = await session.get(StudentAccount, account_id)
            assert row is not None and row.timezone == "UTC"
