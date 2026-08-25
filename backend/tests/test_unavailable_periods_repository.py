from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from studyflow.availability.repositories import (
    NoFutureSessions,
    SqlAlchemyFutureSessionInvalidator,
    SqlAlchemyUnavailablePeriodRepository,
)
from studyflow.availability.unavailable import UnavailablePeriodDraft
from studyflow.database import Base, Database
from studyflow.database.models import AcademicTask, StudentAccount
from studyflow.database.models import StudySession as SessionRow
from studyflow.database.models import UnavailablePeriod as UnavailablePeriodRow


class FailingInvalidator:
    async def remove_conflicting_future_sessions(
        self,
        session: AsyncSession,
        account_id: UUID,
        starts_at: datetime,
        ends_at: datetime,
    ) -> list[UUID]:
        account = await session.get(StudentAccount, account_id)
        assert account is not None
        account.name = "Invalidation side effect"
        await session.flush()
        raise RuntimeError("future-session invalidation failed")


@pytest.mark.anyio
async def test_unavailable_period_invalidates_only_overlapping_accepted_future_sessions() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    account_id, task_id = uuid4(), uuid4()
    now = datetime(2026, 8, 24, 10, tzinfo=UTC)
    try:
        async with database.transaction() as session:
            await session.run_sync(
                lambda sync_session: Base.metadata.create_all(sync_session.connection())
            )
            session.add(
                StudentAccount(
                    id=account_id,
                    email="owner@example.com",
                    name="Owner",
                    password_hash="$argon2id$hash",
                    email_verified_at=now,
                    timezone="UTC",
                )
            )
            session.add(
                AcademicTask(
                    id=task_id,
                    account_id=account_id,
                    title="Exam preparation",
                    category="exam_preparation",
                    deadline_at=now + timedelta(days=2),
                    original_estimate_minutes=120,
                    planned_duration_minutes=120,
                )
            )
            overlapping_id, later_id, in_progress_id = uuid4(), uuid4(), uuid4()
            session.add_all(
                [
                    SessionRow(
                        id=overlapping_id,
                        account_id=account_id,
                        task_id=task_id,
                        proposal_id=None,
                        starts_at=now + timedelta(hours=2),
                        ends_at=now + timedelta(hours=3),
                        planned_duration_minutes=60,
                    ),
                    SessionRow(
                        id=later_id,
                        account_id=account_id,
                        task_id=task_id,
                        proposal_id=None,
                        starts_at=now + timedelta(hours=4),
                        ends_at=now + timedelta(hours=5),
                        planned_duration_minutes=60,
                    ),
                    SessionRow(
                        id=in_progress_id,
                        account_id=account_id,
                        task_id=task_id,
                        proposal_id=None,
                        starts_at=now - timedelta(minutes=30),
                        ends_at=now + timedelta(minutes=30),
                        planned_duration_minutes=60,
                    ),
                ]
            )

        repository = SqlAlchemyUnavailablePeriodRepository(
            database,
            SqlAlchemyFutureSessionInvalidator(clock=lambda: now),
        )
        change = await repository.create(
            account_id,
            UnavailablePeriodDraft(
                now + timedelta(hours=2, minutes=30),
                now + timedelta(hours=3, minutes=30),
            ),
        )

        assert change.invalidated_future_session_ids == [overlapping_id]
        async with database.transaction() as session:
            remaining_ids = set(await session.scalars(select(SessionRow.id)))
        assert remaining_ids == {later_id, in_progress_id}
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_unavailable_period_repository_enforces_ownership() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    owner_id, other_id = uuid4(), uuid4()
    try:
        async with database.transaction() as session:
            await session.run_sync(
                lambda sync_session: Base.metadata.create_all(sync_session.connection())
            )
            session.add_all(
                [
                    StudentAccount(
                        id=owner_id,
                        email="owner@example.com",
                        name="Owner",
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
        repository = SqlAlchemyUnavailablePeriodRepository(database, NoFutureSessions())
        starts_at = datetime(2026, 8, 1, 12, tzinfo=UTC)
        created = await repository.create(
            owner_id, UnavailablePeriodDraft(starts_at, starts_at + timedelta(hours=2), "Exam")
        )

        assert await repository.list_periods(other_id) == []
        assert (
            await repository.update(
                other_id,
                created.period.id,
                UnavailablePeriodDraft(starts_at, starts_at + timedelta(hours=3)),
            )
            is None
        )
        assert not await repository.delete(other_id, created.period.id)
        assert await repository.delete(owner_id, created.period.id)
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_create_rolls_back_period_and_invalidation_on_failure() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    account_id = uuid4()
    starts_at = datetime(2026, 8, 1, 12, tzinfo=UTC)
    draft = UnavailablePeriodDraft(starts_at, starts_at + timedelta(hours=2), "Exam")
    try:
        async with database.transaction() as session:
            await session.run_sync(
                lambda sync_session: Base.metadata.create_all(sync_session.connection())
            )
            session.add(
                StudentAccount(
                    id=account_id,
                    email="owner@example.com",
                    name="Owner",
                    password_hash="$argon2id$hash",
                    email_verified_at=starts_at,
                    timezone="UTC",
                )
            )

        failing = SqlAlchemyUnavailablePeriodRepository(database, FailingInvalidator())
        with pytest.raises(RuntimeError, match="invalidation failed"):
            await failing.create(account_id, draft)

        async with database.transaction() as session:
            account = await session.get(StudentAccount, account_id)
            periods = list(await session.scalars(select(UnavailablePeriodRow)))
        assert account is not None and account.name == "Owner"
        assert periods == []

        retry = SqlAlchemyUnavailablePeriodRepository(database, NoFutureSessions())
        await retry.create(account_id, draft)
        assert len(await retry.list_periods(account_id)) == 1
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_update_rolls_back_period_and_invalidation_on_failure() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    account_id = uuid4()
    starts_at = datetime(2026, 8, 1, 12, tzinfo=UTC)
    original = UnavailablePeriodDraft(starts_at, starts_at + timedelta(hours=2), "Exam")
    replacement = UnavailablePeriodDraft(
        starts_at + timedelta(days=1),
        starts_at + timedelta(days=1, hours=3),
        "Extended exam",
    )
    try:
        async with database.transaction() as session:
            await session.run_sync(
                lambda sync_session: Base.metadata.create_all(sync_session.connection())
            )
            session.add(
                StudentAccount(
                    id=account_id,
                    email="owner@example.com",
                    name="Owner",
                    password_hash="$argon2id$hash",
                    email_verified_at=starts_at,
                    timezone="UTC",
                )
            )

        repository = SqlAlchemyUnavailablePeriodRepository(database, NoFutureSessions())
        created = await repository.create(account_id, original)
        failing = SqlAlchemyUnavailablePeriodRepository(database, FailingInvalidator())
        with pytest.raises(RuntimeError, match="invalidation failed"):
            await failing.update(account_id, created.period.id, replacement)

        persisted = (await repository.list_periods(account_id))[0]
        async with database.transaction() as session:
            account = await session.get(StudentAccount, account_id)
        assert persisted.starts_at == original.starts_at
        assert persisted.ends_at == original.ends_at
        assert persisted.reason == original.reason
        assert account is not None and account.name == "Owner"
    finally:
        await database.stop()
