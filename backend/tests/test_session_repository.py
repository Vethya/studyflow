from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import select

from studyflow.auth.repositories import SqlAlchemySessionRepository
from studyflow.auth.sessions import PendingSession
from studyflow.database import Base, Database
from studyflow.database.models import AuthenticationSession, StudentAccount


@pytest.mark.anyio
async def test_session_repository_persists_an_owned_revocable_session() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    account_id = uuid4()
    now = datetime.now(UTC)
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
                    email_verified_at=datetime(2026, 7, 29, 11, tzinfo=UTC),
                    timezone="UTC",
                )
            )

        await SqlAlchemySessionRepository(database).create(
            PendingSession(
                account_id=account_id,
                token_hash="a" * 64,
                csrf_token_hash="b" * 64,
                idle_expires_at=now + timedelta(hours=24),
                absolute_expires_at=now + timedelta(days=7),
            )
        )

        async with database.transaction() as session:
            stored = (await session.scalars(select(AuthenticationSession))).one()

        assert stored.account_id == account_id
        assert stored.token_hash == "a" * 64
        assert stored.csrf_token_hash == "b" * 64
        assert stored.revoked_at is None
    finally:
        await database.stop()
