from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import select

from studyflow.auth.registration import hash_verification_token
from studyflow.auth.repositories import SqlAlchemyPasswordRecoveryRepository
from studyflow.database import Base, Database
from studyflow.database.models import (
    AuthenticationEmailToken,
    AuthenticationSession,
    StudentAccount,
)


@pytest.mark.anyio
async def test_password_reset_is_single_use_and_revokes_all_sessions() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    now = datetime.now(UTC)
    account_id = uuid4()
    token = "single-use-password-reset-token"
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
                    password_hash="$argon2id$old-hash",
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
        repository = SqlAlchemyPasswordRecoveryRepository(database)
        assert await repository.create_reset_token(
            "student@example.com", hash_verification_token(token), now + timedelta(hours=1)
        )

        assert await repository.reset_password(
            hash_verification_token(token), "$argon2id$new-hash", now
        )
        assert not await repository.reset_password(
            hash_verification_token(token), "$argon2id$reused-hash", now
        )

        async with database.transaction() as session:
            account = (await session.scalars(select(StudentAccount))).one()
            reset_token = (await session.scalars(select(AuthenticationEmailToken))).one()
            authentication_session = (await session.scalars(select(AuthenticationSession))).one()
        assert account.password_hash == "$argon2id$new-hash"
        assert reset_token.consumed_at is not None
        assert authentication_session.revoked_at is not None
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_password_reset_request_ignores_ineligible_accounts() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    now = datetime.now(UTC)
    try:
        async with database.transaction() as session:
            await session.run_sync(
                lambda sync_session: Base.metadata.create_all(sync_session.connection())
            )
            session.add(
                StudentAccount(
                    email="student@example.com",
                    name="Student Name",
                    password_hash="$argon2id$hash",
                    email_verified_at=None,
                    timezone="UTC",
                )
            )
        repository = SqlAlchemyPasswordRecoveryRepository(database)

        assert not await repository.create_reset_token(
            "student@example.com", "a" * 64, now + timedelta(hours=1)
        )
        assert not await repository.create_reset_token(
            "missing@example.com", "b" * 64, now + timedelta(hours=1)
        )
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_password_reset_tokens_expire_and_replacement_invalidates_prior_token() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    now = datetime.now(UTC)
    first_token_hash = hash_verification_token("first-password-reset-token")
    replacement_token_hash = hash_verification_token("replacement-password-reset-token")
    try:
        async with database.transaction() as session:
            await session.run_sync(
                lambda sync_session: Base.metadata.create_all(sync_session.connection())
            )
            session.add(
                StudentAccount(
                    email="student@example.com",
                    name="Student Name",
                    password_hash="$argon2id$old-hash",
                    email_verified_at=now,
                    timezone="UTC",
                )
            )
        repository = SqlAlchemyPasswordRecoveryRepository(database)
        assert await repository.create_reset_token(
            "student@example.com", first_token_hash, now + timedelta(hours=1)
        )
        assert await repository.create_reset_token(
            "student@example.com", replacement_token_hash, now + timedelta(hours=1)
        )

        assert not await repository.reset_password(first_token_hash, "$argon2id$first-hash", now)
        assert not await repository.reset_password(
            replacement_token_hash, "$argon2id$expired-hash", now + timedelta(hours=1)
        )
    finally:
        await database.stop()
