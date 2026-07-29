from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

from studyflow.availability.repositories import SqlAlchemyUnavailablePeriodRepository
from studyflow.availability.unavailable import UnavailablePeriodDraft
from studyflow.database import Base, Database
from studyflow.database.models import StudentAccount


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
        repository = SqlAlchemyUnavailablePeriodRepository(database)
        starts_at = datetime(2026, 8, 1, 12, tzinfo=UTC)
        created = await repository.create(
            owner_id, UnavailablePeriodDraft(starts_at, starts_at + timedelta(hours=2), "Exam")
        )

        assert await repository.list_periods(other_id) == []
        assert (
            await repository.update(
                other_id,
                created.id,
                UnavailablePeriodDraft(starts_at, starts_at + timedelta(hours=3)),
            )
            is None
        )
        assert not await repository.delete(other_id, created.id)
        assert await repository.delete(owner_id, created.id)
    finally:
        await database.stop()
