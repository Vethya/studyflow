from datetime import UTC, datetime
from uuid import uuid4

import pytest

from studyflow.accounts.repositories import SqlAlchemyStudyPreferencesRepository
from studyflow.database import Base, Database
from studyflow.database.models import StudentAccount


@pytest.mark.anyio
async def test_timezone_change_requires_availability_confirmation_and_scopes_update() -> None:
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
                    ),
                    StudentAccount(
                        id=other_id,
                        email="other@example.com",
                        name="Other",
                        password_hash="$argon2id$hash",
                        email_verified_at=datetime.now(UTC),
                        timezone="Europe/Paris",
                    ),
                ]
            )
        repository = SqlAlchemyStudyPreferencesRepository(database)

        updated = await repository.update(account_id, "Asia/Phnom_Penh", 90, 15)

        assert updated is not None
        assert updated.availability_confirmation_required is True
        assert updated.preferred_session_length_minutes == 90
        assert updated.minimum_break_minutes == 15
        other = await repository.get(other_id)
        assert other is not None and other.timezone == "Europe/Paris"
        assert await repository.get(uuid4()) is None
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_preference_only_change_does_not_require_availability_confirmation() -> None:
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
                    email_verified_at=datetime.now(UTC),
                    timezone="UTC",
                )
            )
        repository = SqlAlchemyStudyPreferencesRepository(database)

        updated = await repository.update(account_id, "UTC", 120, 0)

        assert updated is not None
        assert updated.availability_confirmation_required is False
    finally:
        await database.stop()
