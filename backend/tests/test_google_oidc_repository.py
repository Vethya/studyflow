from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from studyflow.auth.oidc import GoogleClaims
from studyflow.auth.repositories import SqlAlchemyOIDCRepository
from studyflow.database import Base, Database
from studyflow.database.models import AuthenticationOIDCState, StudentAccount


@pytest.mark.anyio
async def test_oidc_repository_consumes_state_once_and_resolves_identity() -> None:
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
