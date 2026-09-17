from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from studyflow.auth.oidc import GoogleClaims
from studyflow.auth.repositories import SqlAlchemyOIDCRepository
from studyflow.database import Base, Database
from studyflow.database.models import AuthenticationOIDCState, StudentAccount


@pytest.mark.anyio
async def test_oidc_repository_consumes_and_safely_restores_state() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    now = datetime.now(UTC)
    try:
        async with database.transaction() as session:
            await session.run_sync(
                lambda sync_session: Base.metadata.create_all(sync_session.connection())
            )
            session.add(
                AuthenticationOIDCState(
                    state_hash="e" * 64,
                    nonce_hash="x" * 64,
                    timezone="UTC",
                    created_at=now - timedelta(minutes=20),
                    expires_at=now - timedelta(minutes=10),
                )
            )
        repository = SqlAlchemyOIDCRepository(database)
        await repository.store_state(
            "s" * 64, "n" * 64, "Asia/Phnom_Penh", now + timedelta(minutes=10)
        )
        async with database.transaction() as session:
            hashes = list(await session.scalars(select(AuthenticationOIDCState.state_hash)))
        assert hashes == ["s" * 64]

        consumed = await repository.consume_state("s" * 64, now)
        assert consumed is not None and consumed.nonce_hash == "n" * 64
        assert consumed.timezone == "Asia/Phnom_Penh"
        assert await repository.consume_state("s" * 64, now) is None
        assert not await repository.restore_state(
            "s" * 64, now + timedelta(seconds=1), now + timedelta(seconds=1)
        )
        assert await repository.restore_state("s" * 64, now, now + timedelta(seconds=1))
        assert await repository.consume_state("s" * 64, now + timedelta(seconds=2)) is not None
        claims = GoogleClaims("subject", "student@example.com", "Student")
        created = await repository.resolve_identity(claims, "Asia/Phnom_Penh")
        existing = await repository.resolve_identity(claims, "UTC")

        assert created is not None
        assert existing == created
        async with database.transaction() as session:
            account = await session.get(StudentAccount, created.id)
        assert account is not None and account.timezone == "Asia/Phnom_Penh"
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_oidc_repository_does_not_auto_link_matching_password_account() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
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
                    email_verified_at=datetime.now(UTC),
                    timezone="UTC",
                )
            )
        repository = SqlAlchemyOIDCRepository(database)

        assert (
            await repository.resolve_identity(
                GoogleClaims("subject", "student@example.com", "Student"), "UTC"
            )
            is None
        )
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_oidc_repository_create_account_and_identity_integrity_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from contextlib import asynccontextmanager

    from sqlalchemy.exc import IntegrityError

    from studyflow.database.models import AuthenticationIdentity

    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    try:
        async with database.transaction() as session:
            await session.run_sync(
                lambda sync_session: Base.metadata.create_all(sync_session.connection())
            )

        repository = SqlAlchemyOIDCRepository(database)
        claims = GoogleClaims("google-sub", "newuser@example.com", "New User")

        orig_tx = database.transaction
        call_count = 0

        @asynccontextmanager
        async def failing_first_tx() -> AsyncIterator[AsyncSession]:
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise IntegrityError("first_tx", {}, Exception("constraint"))
            async with orig_tx() as session:
                yield session

        monkeypatch.setattr(database, "transaction", failing_first_tx)

        # Fallback when identity is missing returns None (lines 547-548)
        assert await repository.resolve_identity(claims, "UTC") is None

        # Seed account and identity directly, then test fallback when identity exists
        # (lines 549-550)
        async with orig_tx() as session:
            account = StudentAccount(
                email="newuser@example.com",
                name="New User",
                timezone="UTC",
            )
            session.add(account)
            await session.flush()
            session.add(
                AuthenticationIdentity(
                    account_id=account.id,
                    provider="google",
                    subject="google-sub",
                    email="newuser@example.com",
                )
            )

        call_count = 0
        resolved = await repository.resolve_identity(claims, "UTC")
        assert resolved is not None and resolved.email == "newuser@example.com"
    finally:
        await database.stop()
