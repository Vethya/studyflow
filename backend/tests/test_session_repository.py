from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import select

from studyflow.auth.repositories import (
    SqlAlchemySessionAuthenticationRepository,
    SqlAlchemySessionRepository,
)
from studyflow.auth.session_authentication import (
    SessionAuthenticationService,
    hash_browser_token,
)
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

        pending = PendingSession(
            account_id=account_id,
            token_hash="a" * 64,
            csrf_token_hash="b" * 64,
            idle_expires_at=now + timedelta(hours=24),
            absolute_expires_at=now + timedelta(days=7),
        )
        repository = SqlAlchemySessionRepository(database)
        assert not await repository.create(pending, "$argon2id$stale-hash", now=now)
        assert await repository.create(pending, "$argon2id$stored-hash", now=now)

        async with database.transaction() as session:
            stored = (await session.scalars(select(AuthenticationSession))).one()

        assert stored.account_id == account_id
        assert stored.token_hash == "a" * 64
        assert stored.csrf_token_hash == "b" * 64
        assert stored.revoked_at is None
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_session_creation_prunes_idle_and_absolute_expirations() -> None:
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
                    password_hash="$argon2id$hash",
                    email_verified_at=now,
                    timezone="UTC",
                )
            )
            session.add_all(
                [
                    AuthenticationSession(
                        account_id=account_id,
                        token_hash="i" * 64,
                        csrf_token_hash="1" * 64,
                        created_at=now - timedelta(days=2),
                        idle_expires_at=now - timedelta(seconds=1),
                        absolute_expires_at=now + timedelta(days=1),
                    ),
                    AuthenticationSession(
                        account_id=account_id,
                        token_hash="a" * 64,
                        csrf_token_hash="2" * 64,
                        created_at=now - timedelta(days=2),
                        idle_expires_at=now - timedelta(days=1),
                        absolute_expires_at=now - timedelta(seconds=1),
                    ),
                    AuthenticationSession(
                        account_id=account_id,
                        token_hash="v" * 64,
                        csrf_token_hash="3" * 64,
                        idle_expires_at=now + timedelta(hours=1),
                        absolute_expires_at=now + timedelta(days=1),
                    ),
                ]
            )

        await SqlAlchemySessionRepository(database).create(
            PendingSession(
                account_id=account_id,
                token_hash="n" * 64,
                csrf_token_hash="4" * 64,
                idle_expires_at=now + timedelta(hours=24),
                absolute_expires_at=now + timedelta(days=7),
            ),
            now=now,
        )

        async with database.transaction() as session:
            hashes = set(await session.scalars(select(AuthenticationSession.token_hash)))
        assert hashes == {"v" * 64, "n" * 64}
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_session_creation_checks_account_before_pruning_expired_sessions() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    existing_account_id = uuid4()
    now = datetime.now(UTC)
    try:
        async with database.transaction() as session:
            await session.run_sync(
                lambda sync_session: Base.metadata.create_all(sync_session.connection())
            )
            session.add(
                StudentAccount(
                    id=existing_account_id,
                    email="student@example.com",
                    name="Student",
                    password_hash="$argon2id$hash",
                    email_verified_at=now,
                    timezone="UTC",
                )
            )
            session.add(
                AuthenticationSession(
                    account_id=existing_account_id,
                    token_hash="e" * 64,
                    csrf_token_hash="1" * 64,
                    created_at=now - timedelta(days=1),
                    idle_expires_at=now - timedelta(seconds=1),
                    absolute_expires_at=now + timedelta(days=1),
                )
            )

        created = await SqlAlchemySessionRepository(database).create(
            PendingSession(
                account_id=uuid4(),
                token_hash="n" * 64,
                csrf_token_hash="2" * 64,
                idle_expires_at=now + timedelta(hours=24),
                absolute_expires_at=now + timedelta(days=7),
            ),
            now=now,
        )

        async with database.transaction() as session:
            hashes = set(await session.scalars(select(AuthenticationSession.token_hash)))
        assert created is False
        assert hashes == {"e" * 64}
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_session_authentication_refreshes_then_revokes_with_csrf() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    now = datetime.now(UTC)
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
                    email_verified_at=now,
                    timezone="UTC",
                )
            )
        await SqlAlchemySessionRepository(database).create(
            PendingSession(
                account_id=account_id,
                token_hash=hash_browser_token("opaque-session-token"),
                csrf_token_hash=hash_browser_token("csrf-request-token"),
                idle_expires_at=now + timedelta(hours=1),
                absolute_expires_at=now + timedelta(hours=2),
            ),
            now=now,
        )
        authentication = SessionAuthenticationService(
            SqlAlchemySessionAuthenticationRepository(database), clock=lambda: now
        )

        assert await authentication.authenticate("opaque-session-token", "wrong-csrf-token") is None
        assert (
            await authentication.authenticate("opaque-session-token", "csrf-request-token")
            is not None
        )
        async with database.transaction() as session:
            refreshed = (await session.scalars(select(AuthenticationSession))).one()
        assert refreshed.idle_expires_at.replace(tzinfo=UTC) == now + timedelta(hours=2)
        assert await authentication.revoke("opaque-session-token", "csrf-request-token") is True
        assert await authentication.authenticate("opaque-session-token") is None
    finally:
        await database.stop()
