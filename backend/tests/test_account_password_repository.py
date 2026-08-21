from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import select

from studyflow.accounts.repositories import SqlAlchemyPasswordChangeRepository
from studyflow.auth.repositories import SqlAlchemyPasswordRecoveryRepository
from studyflow.database import Base, Database
from studyflow.database.models import (
    AuthenticationEmailToken,
    AuthenticationSession,
    StudentAccount,
)


@pytest.mark.anyio
async def test_password_replacement_compares_current_hash_and_revokes_all_sessions() -> None:
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
                    name="Student",
                    password_hash="$argon2id$current",
                    email_verified_at=now,
                    timezone="UTC",
                )
            )
            session.add(
                AuthenticationSession(
                    account_id=account_id,
                    token_hash="a" * 64,
                    csrf_token_hash="b" * 64,
                    idle_expires_at=now + timedelta(hours=1),
                    absolute_expires_at=now + timedelta(days=1),
                )
            )
            session.add(
                AuthenticationEmailToken(
                    account_id=account_id,
                    purpose="password_reset",
                    token_hash="r" * 64,
                    expires_at=now + timedelta(hours=1),
                )
            )
        repository = SqlAlchemyPasswordChangeRepository(database)

        assert not await repository.replace_password(
            account_id, "$argon2id$stale", "$argon2id$new", now
        )
        async with database.transaction() as session:
            reset_token = (await session.scalars(select(AuthenticationEmailToken))).one()
        assert reset_token.consumed_at is None
        assert await repository.replace_password(
            account_id, "$argon2id$current", "$argon2id$new", now
        )

        async with database.transaction() as session:
            account = await session.get(StudentAccount, account_id)
            authentication_session = (await session.scalars(select(AuthenticationSession))).one()
            reset_token = (await session.scalars(select(AuthenticationEmailToken))).one()
        assert account is not None and account.password_hash == "$argon2id$new"
        assert authentication_session.revoked_at is not None
        assert reset_token.consumed_at is not None
        assert not await SqlAlchemyPasswordRecoveryRepository(database).reset_password(
            "r" * 64, "$argon2id$attacker", now
        )
    finally:
        await database.stop()
