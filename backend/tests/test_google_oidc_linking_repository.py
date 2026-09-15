from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import select

from studyflow.auth.oidc import GoogleClaims, hash_oidc_secret
from studyflow.auth.repositories import SqlAlchemyOIDCRepository
from studyflow.auth.sessions import PendingSession
from studyflow.database import Base, Database
from studyflow.database.models import (
    AuthenticationIdentity,
    AuthenticationSession,
    StudentAccount,
)


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
            student = StudentAccount(
                email="student@example.com",
                name="Student",
                password_hash="$argon2id$hash",
                email_verified_at=now,
                timezone="UTC",
            )
            session.add(student)
            await session.flush()
            session.add(
                AuthenticationSession(
                    account_id=student.id,
                    token_hash="e" * 64,
                    csrf_token_hash="x" * 64,
                    created_at=now - timedelta(days=2),
                    idle_expires_at=now - timedelta(days=1),
                    absolute_expires_at=now - timedelta(seconds=1),
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
        assert persisted_session.token_hash == hash_oidc_secret("session-token")
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


@pytest.mark.anyio
async def test_oidc_linking_repository_edge_cases() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    now = datetime.now(UTC)
    account_id = uuid4()
    try:
        async with database.transaction() as session:
            await session.run_sync(
                lambda sync_session: Base.metadata.create_all(sync_session.connection())
            )
            # Account with no password (password_hash=None)
            no_password_account = StudentAccount(
                id=account_id,
                email="nopass@example.com",
                name="No Pass",
                password_hash=None,
                email_verified_at=now,
                timezone="UTC",
            )
            session.add(no_password_account)

        repository = SqlAlchemyOIDCRepository(database)

        # 1. create_link_challenge returns False when account missing
        # or password_hash is None (line 560)
        assert (
            await repository.create_link_challenge(
                GoogleClaims("sub", "missing@example.com", "Missing"),
                "tok" * 20 + "1234",
                now + timedelta(minutes=10),
            )
            is False
        )
        assert (
            await repository.create_link_challenge(
                GoogleClaims("sub", "nopass@example.com", "No Pass"),
                "tok" * 20 + "1234",
                now + timedelta(minutes=10),
            )
            is False
        )

        # 2. get_link_challenge returns None when token not found
        # or account has no password (line 591)
        assert await repository.get_link_challenge("missing-token-hash", now) is None

        # 3. link_identity_and_create_session with missing challenge row returns None (line 619)
        fake_challenge_id = uuid4()
        pending = PendingSession(
            account_id,
            "session" * 8,
            "csrf" * 16,
            now + timedelta(hours=24),
            now + timedelta(days=7),
        )
        assert (
            await repository.link_identity_and_create_session(
                fake_challenge_id,
                "$argon2id$hash",
                pending,
                now,
            )
            is None
        )

        # 4. create a valid challenge for an account with password
        pwd_account_id = uuid4()
        async with database.transaction() as session:
            session.add(
                StudentAccount(
                    id=pwd_account_id,
                    email="haspwd@example.com",
                    name="Has Pwd",
                    password_hash="$argon2id$hash",
                    email_verified_at=now,
                    timezone="UTC",
                )
            )
        assert await repository.create_link_challenge(
            GoogleClaims("sub-haspwd", "haspwd@example.com", "Has Pwd"),
            "chal" * 16,
            now + timedelta(minutes=10),
        )
        challenge = await repository.get_link_challenge("chal" * 16, now)
        assert challenge is not None

        # 5. link_identity_and_create_session with wrong password hash returns None (line 626)
        wrong_pwd_pending = PendingSession(
            pwd_account_id,
            "s" * 64,
            "c" * 64,
            now + timedelta(hours=24),
            now + timedelta(days=7),
        )
        assert (
            await repository.link_identity_and_create_session(
                challenge.id,
                "$argon2id$wrong",
                wrong_pwd_pending,
                now,
            )
            is None
        )

        # 6. link_identity_and_create_session when identity already linked returns None (line 637)
        async with database.transaction() as session:
            session.add(
                AuthenticationIdentity(
                    account_id=pwd_account_id,
                    provider="google",
                    subject="sub-haspwd",
                    email="haspwd@example.com",
                )
            )
        assert (
            await repository.link_identity_and_create_session(
                challenge.id,
                "$argon2id$hash",
                wrong_pwd_pending,
                now,
            )
            is None
        )
    finally:
        await database.stop()
