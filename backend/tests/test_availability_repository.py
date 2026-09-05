from collections.abc import Sequence
from datetime import UTC, datetime, time, timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from studyflow.availability.repositories import (
    SqlAlchemyAvailabilityWindowRepository,
    SqlAlchemyFutureSessionInvalidator,
)
from studyflow.availability.windows import AvailabilityWindow, AvailabilityWindowDraft
from studyflow.database import Base, Database
from studyflow.database.models import (
    AcademicTask,
    StudentAccount,
)
from studyflow.database.models import (
    AvailabilityWindow as AvailabilityWindowRow,
)
from studyflow.database.models import (
    StudySession as SessionRow,
)
from studyflow.database.models import (
    StudySessionOutcome as OutcomeRow,
)
from studyflow.database.models import (
    UnavailablePeriod as UnavailablePeriodRow,
)
from studyflow.scheduling.contracts import MinuteWindow

NOW = datetime(2026, 9, 4, 10, tzinfo=UTC)


class FailingCalendarInvalidator:
    async def remove_sessions_outside_availability(
        self,
        session: AsyncSession,
        account_id: UUID,
        windows: Sequence[AvailabilityWindow],
    ) -> list[UUID]:
        account = await session.get(StudentAccount, account_id)
        assert account is not None
        account.name = "Invalidation side effect"
        await session.flush()
        raise RuntimeError("calendar invalidation failed")


@pytest.mark.anyio
async def test_availability_repository_replaces_owned_windows_and_confirms_timezone() -> None:
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
                        availability_timezone_confirmed=False,
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
        repository = SqlAlchemyAvailabilityWindowRepository(database)
        stored = await repository.replace(
            account_id, [AvailabilityWindowDraft(0, time(22), time(2))]
        )

        assert stored[0].crosses_midnight is True
        assert await repository.list_windows(other_id) == []
        assert await repository.confirm_timezone(account_id)
        async with database.transaction() as session:
            account = await session.get(StudentAccount, account_id)
        assert account is not None and account.availability_timezone_confirmed is True
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_replacing_windows_invalidates_sessions_outside_new_calendar() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    account_id, task_id = uuid4(), uuid4()
    session_ids = {
        "valid": uuid4(),
        "outside": uuid4(),
        "blocked": uuid4(),
    }
    session_day = datetime(2026, 9, 11, tzinfo=UTC)
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
                        email_verified_at=NOW,
                        timezone="UTC",
                    ),
                    AcademicTask(
                        id=task_id,
                        account_id=account_id,
                        title="Read",
                        category="reading",
                        deadline_at=NOW + timedelta(days=14),
                        original_estimate_minutes=180,
                        planned_duration_minutes=180,
                    ),
                    UnavailablePeriodRow(
                        account_id=account_id,
                        starts_at=session_day + timedelta(hours=13),
                        ends_at=session_day + timedelta(hours=14),
                    ),
                    AvailabilityWindowRow(
                        account_id=account_id,
                        weekday=4,
                        local_start_time=time(9),
                        local_end_time=time(10),
                        crosses_midnight=False,
                    ),
                ]
            )
            session.add_all(
                [
                    SessionRow(
                        id=session_ids["valid"],
                        account_id=account_id,
                        task_id=task_id,
                        starts_at=session_day + timedelta(hours=12),
                        ends_at=session_day + timedelta(hours=13),
                        planned_duration_minutes=60,
                    ),
                    SessionRow(
                        id=session_ids["outside"],
                        account_id=account_id,
                        task_id=task_id,
                        starts_at=session_day + timedelta(hours=14),
                        ends_at=session_day + timedelta(hours=15),
                        planned_duration_minutes=60,
                    ),
                    SessionRow(
                        id=session_ids["blocked"],
                        account_id=account_id,
                        task_id=task_id,
                        starts_at=session_day + timedelta(hours=13),
                        ends_at=session_day + timedelta(hours=14),
                        planned_duration_minutes=60,
                    ),
                ]
            )

        repository = SqlAlchemyAvailabilityWindowRepository(
            database, SqlAlchemyFutureSessionInvalidator(clock=lambda: NOW)
        )
        await repository.replace(account_id, [AvailabilityWindowDraft(4, time(12), time(14))])

        async with database.transaction() as session:
            valid = await session.get(SessionRow, session_ids["valid"])
            outside = await session.get(SessionRow, session_ids["outside"])
            blocked = await session.get(SessionRow, session_ids["blocked"])
            outcomes = list(await session.scalars(select(OutcomeRow)))

        assert valid is not None and valid.invalidated_at is None
        assert outside is not None and outside.invalidated_at == NOW.replace(tzinfo=None)
        assert blocked is not None and blocked.invalidated_at == NOW.replace(tzinfo=None)
        assert {outcome.session_id for outcome in outcomes} == {
            session_ids["outside"],
            session_ids["blocked"],
        }
        assert all(outcome.remaining_minutes == 60 for outcome in outcomes)
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_confirming_timezone_revalidates_sessions_in_the_new_timezone() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    account_id, task_id = uuid4(), uuid4()
    invalid_session_id, valid_session_id = uuid4(), uuid4()
    session_day = datetime(2026, 9, 11, tzinfo=UTC)
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
                        email_verified_at=NOW,
                        timezone="America/New_York",
                        availability_timezone_confirmed=False,
                    ),
                    AcademicTask(
                        id=task_id,
                        account_id=account_id,
                        title="Read",
                        category="reading",
                        deadline_at=NOW + timedelta(days=14),
                        original_estimate_minutes=120,
                        planned_duration_minutes=120,
                    ),
                    AvailabilityWindowRow(
                        account_id=account_id,
                        weekday=4,
                        local_start_time=time(10),
                        local_end_time=time(11),
                        crosses_midnight=False,
                    ),
                ]
            )
            session.add_all(
                [
                    SessionRow(
                        id=invalid_session_id,
                        account_id=account_id,
                        task_id=task_id,
                        starts_at=session_day + timedelta(hours=10),
                        ends_at=session_day + timedelta(hours=11),
                        planned_duration_minutes=60,
                    ),
                    SessionRow(
                        id=valid_session_id,
                        account_id=account_id,
                        task_id=task_id,
                        starts_at=session_day + timedelta(hours=14),
                        ends_at=session_day + timedelta(hours=15),
                        planned_duration_minutes=60,
                    ),
                ]
            )
        repository = SqlAlchemyAvailabilityWindowRepository(
            database, SqlAlchemyFutureSessionInvalidator(clock=lambda: NOW)
        )
        assert await repository.confirm_timezone(account_id)

        async with database.transaction() as session:
            invalid = await session.get(SessionRow, invalid_session_id)
            valid = await session.get(SessionRow, valid_session_id)
            account = await session.get(StudentAccount, account_id)

        assert invalid is not None and invalid.invalidated_at == NOW.replace(tzinfo=None)
        assert valid is not None and valid.invalidated_at is None
        assert account is not None and account.availability_timezone_confirmed is True
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_redundant_timezone_confirmation_does_not_invalidate_sessions() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    account_id, task_id, session_id = uuid4(), uuid4(), uuid4()
    session_day = datetime(2026, 9, 11, tzinfo=UTC)
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
                        email_verified_at=NOW,
                        timezone="UTC",
                        availability_timezone_confirmed=True,
                    ),
                    AcademicTask(
                        id=task_id,
                        account_id=account_id,
                        title="Scenario work",
                        category="reading",
                        deadline_at=NOW + timedelta(days=14),
                        original_estimate_minutes=60,
                        planned_duration_minutes=60,
                    ),
                    AvailabilityWindowRow(
                        account_id=account_id,
                        weekday=4,
                        local_start_time=time(10),
                        local_end_time=time(11),
                        crosses_midnight=False,
                    ),
                    SessionRow(
                        id=session_id,
                        account_id=account_id,
                        task_id=task_id,
                        starts_at=session_day + timedelta(hours=14),
                        ends_at=session_day + timedelta(hours=15),
                        planned_duration_minutes=60,
                    ),
                ]
            )

        repository = SqlAlchemyAvailabilityWindowRepository(
            database, SqlAlchemyFutureSessionInvalidator(clock=lambda: NOW)
        )
        assert await repository.confirm_timezone(account_id)

        async with database.transaction() as session:
            row = await session.get(SessionRow, session_id)
        assert row is not None and row.invalidated_at is None
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_window_replacement_rolls_back_when_calendar_invalidation_fails() -> None:
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
                    email_verified_at=NOW,
                    timezone="UTC",
                )
            )
            session.add(
                AvailabilityWindowRow(
                    account_id=account_id,
                    weekday=4,
                    local_start_time=time(9),
                    local_end_time=time(10),
                    crosses_midnight=False,
                )
            )

        repository = SqlAlchemyAvailabilityWindowRepository(database, FailingCalendarInvalidator())
        with pytest.raises(RuntimeError, match="calendar invalidation failed"):
            await repository.replace(account_id, [AvailabilityWindowDraft(4, time(12), time(13))])

        assert [
            (window.weekday, window.start_time, window.end_time)
            for window in await repository.list_windows(account_id)
        ] == [(4, time(9), time(10))]
        async with database.transaction() as session:
            account = await session.get(StudentAccount, account_id)
        assert account is not None and account.name == "Student"
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_revalidation_respects_overnight_windows() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    account_id, task_id = uuid4(), uuid4()
    session_day = datetime(2026, 9, 11, tzinfo=UTC)
    valid_late_id, valid_early_id, invalid_id = uuid4(), uuid4(), uuid4()
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
                        email_verified_at=NOW,
                        timezone="UTC",
                    ),
                    AcademicTask(
                        id=task_id,
                        account_id=account_id,
                        title="Read",
                        category="reading",
                        deadline_at=NOW + timedelta(days=14),
                        original_estimate_minutes=180,
                        planned_duration_minutes=180,
                    ),
                    SessionRow(
                        id=valid_late_id,
                        account_id=account_id,
                        task_id=task_id,
                        starts_at=session_day + timedelta(hours=22),
                        ends_at=session_day + timedelta(hours=23),
                        planned_duration_minutes=60,
                    ),
                    SessionRow(
                        id=valid_early_id,
                        account_id=account_id,
                        task_id=task_id,
                        starts_at=session_day + timedelta(days=1, hours=1),
                        ends_at=session_day + timedelta(days=1, hours=2),
                        planned_duration_minutes=60,
                    ),
                    SessionRow(
                        id=invalid_id,
                        account_id=account_id,
                        task_id=task_id,
                        starts_at=session_day + timedelta(days=1, hours=2),
                        ends_at=session_day + timedelta(days=1, hours=3),
                        planned_duration_minutes=60,
                    ),
                ]
            )
            windows = [AvailabilityWindow(uuid4(), 4, time(22), time(2), True)]
            invalidator = SqlAlchemyFutureSessionInvalidator(clock=lambda: NOW)
            invalidated = await invalidator.remove_sessions_outside_availability(
                session, account_id, windows
            )

        assert invalidated == [invalid_id]
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_revalidation_respects_dst_adjusted_windows() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    now = datetime(2026, 3, 1, 10, tzinfo=UTC)
    account_id, task_id = uuid4(), uuid4()
    session_day = datetime(2026, 3, 8, tzinfo=UTC)
    valid_id, invalid_id = uuid4(), uuid4()
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
                        email_verified_at=now,
                        timezone="America/New_York",
                    ),
                    AcademicTask(
                        id=task_id,
                        account_id=account_id,
                        title="Read",
                        category="reading",
                        deadline_at=now + timedelta(days=14),
                        original_estimate_minutes=120,
                        planned_duration_minutes=120,
                    ),
                    SessionRow(
                        id=valid_id,
                        account_id=account_id,
                        task_id=task_id,
                        starts_at=session_day + timedelta(hours=6),
                        ends_at=session_day + timedelta(hours=7),
                        planned_duration_minutes=60,
                    ),
                    SessionRow(
                        id=invalid_id,
                        account_id=account_id,
                        task_id=task_id,
                        starts_at=session_day + timedelta(hours=7),
                        ends_at=session_day + timedelta(hours=8),
                        planned_duration_minutes=60,
                    ),
                ]
            )
            windows = [AvailabilityWindow(uuid4(), 6, time(1), time(3), False)]
            invalidator = SqlAlchemyFutureSessionInvalidator(clock=lambda: now)
            invalidated = await invalidator.remove_sessions_outside_availability(
                session, account_id, windows
            )

        assert invalidated == [invalid_id]
    finally:
        await database.stop()


def test_calendar_revalidation_sweep_does_not_skip_later_sessions() -> None:
    account_id, task_id = uuid4(), uuid4()
    epoch = datetime(1970, 1, 1, tzinfo=UTC)

    def at_minute(minute: int) -> datetime:
        return epoch + timedelta(minutes=minute)

    rows = [
        SessionRow(
            id=uuid4(),
            account_id=account_id,
            task_id=task_id,
            starts_at=at_minute(30),
            ends_at=at_minute(90),
            planned_duration_minutes=60,
        ),
        SessionRow(
            id=uuid4(),
            account_id=account_id,
            task_id=task_id,
            starts_at=at_minute(45),
            ends_at=at_minute(60),
            planned_duration_minutes=15,
        ),
        SessionRow(
            id=uuid4(),
            account_id=account_id,
            task_id=task_id,
            starts_at=at_minute(90),
            ends_at=at_minute(120),
            planned_duration_minutes=30,
        ),
        SessionRow(
            id=uuid4(),
            account_id=account_id,
            task_id=task_id,
            starts_at=at_minute(120),
            ends_at=at_minute(180),
            planned_duration_minutes=60,
        ),
    ]
    invalidated = SqlAlchemyFutureSessionInvalidator._sessions_outside_calendar(
        rows,
        (MinuteWindow(0, 60), MinuteWindow(120, 180)),
    )

    assert [row.id for row in invalidated] == [rows[0].id, rows[2].id]
