from datetime import UTC, datetime
from uuid import uuid4

import pytest

from studyflow.auth.repositories import SqlAlchemyLoginRepository
from studyflow.database import Base, Database
from studyflow.database.models import StudentAccount


@pytest.mark.anyio
async def test_login_repository_returns_password_account_state_by_canonical_email() -> None:
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
                    name="Student Name",
                    password_hash="$argon2id$stored-hash",
                    email_verified_at=datetime.now(UTC),
                    timezone="UTC",
                )
            )

        account = await SqlAlchemyLoginRepository(database).find_by_email("student@example.com")

        assert account is not None
        assert account.id == account_id
        assert account.password_hash == "$argon2id$stored-hash"
        assert account.email_verified is True
    finally:
        await database.stop()
