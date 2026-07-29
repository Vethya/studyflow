from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from studyflow.auth.oidc import GoogleClaims, hash_oidc_secret
from studyflow.auth.repositories import SqlAlchemyOIDCRepository
from studyflow.auth.sessions import PendingSession
from studyflow.database import Base, Database
from studyflow.database.models import AuthenticationSession, StudentAccount


@pytest.mark.anyio
async def test_oidc_link_challenge_is_hashed_expiring_single_use_and_attaches_identity() -> None:
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
                    name="Student",
                    password_hash="$argon2id$hash",
                    email_verified_at=now,
                    timezone="UTC",
                )
            )
        repository = SqlAlchemyOIDCRepository(database)
        created = await repository.create_link_challenge(
            GoogleClaims("google-subject", "student@example.com", "Student"),
            "h" * 64,
            now + timedelta(minutes=10),
        )
        challenge = await repository.get_link_challenge("h" * 64, now)

        assert created and challenge is not None
        account = await repository.link_identity_and_create_session(
            challenge.id,
            "$argon2id$hash",
            PendingSession(
                challenge.account_id,
                hash_oidc_secret("session-token"),
                hash_oidc_secret("csrf-token"),
                now + timedelta(hours=24),
                now + timedelta(days=7),
            ),
            now,
        )
        assert account is not None
        assert await repository.get_link_challenge("h" * 64, now) is None
        identities = await repository.list_identities(account.id)
        assert identities[0].provider == "google"
        async with database.transaction() as session:
            persisted_session = await session.scalar(select(AuthenticationSession))
        assert persisted_session is not None and persisted_session.account_id == account.id
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_oidc_link_rolls_back_identity_and_challenge_when_session_insert_fails() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    now = datetime.now(UTC)
    try:
        async with database.transaction() as session:
            await session.run_sync(
                lambda sync_session: Base.metadata.create_all(sync_session.connection())
            )
            account = StudentAccount(
                email="student@example.com",
                name="Student",
                password_hash="$argon2id$hash",
                email_verified_at=now,
                timezone="UTC",
            )
            session.add(account)
            await session.flush()
            session.add(
                AuthenticationSession(
                    account_id=account.id,
                    token_hash=hash_oidc_secret("duplicate-token"),
                    csrf_token_hash=hash_oidc_secret("existing-csrf"),
                    idle_expires_at=now + timedelta(hours=24),
                    absolute_expires_at=now + timedelta(days=7),
                )
            )
        repository = SqlAlchemyOIDCRepository(database)
        await repository.create_link_challenge(
            GoogleClaims("google-subject", "student@example.com", "Student"),
            "h" * 64,
            now + timedelta(minutes=10),
        )
        challenge = await repository.get_link_challenge("h" * 64, now)
        assert challenge is not None

        result = await repository.link_identity_and_create_session(
            challenge.id,
            "$argon2id$hash",
            PendingSession(
                challenge.account_id,
                hash_oidc_secret("duplicate-token"),
                hash_oidc_secret("new-csrf"),
                now + timedelta(hours=24),
                now + timedelta(days=7),
            ),
            now,
        )

        assert result is None
        assert await repository.get_link_challenge("h" * 64, now) is not None
        assert await repository.list_identities(challenge.account_id) == []
    finally:
        await database.stop()
