from datetime import UTC, datetime, time
from uuid import uuid4

import pytest

from studyflow.availability.repositories import SqlAlchemyAvailabilityWindowRepository
from studyflow.availability.windows import AvailabilityWindowDraft
from studyflow.database import Base, Database
from studyflow.database.models import StudentAccount


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
