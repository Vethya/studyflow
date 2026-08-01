from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from studyflow.auth.registration import PendingAccount, hash_verification_token
from studyflow.auth.repositories import (
    SqlAlchemyEmailVerificationRepository,
    SqlAlchemyRegistrationRepository,
)
from studyflow.auth.verification import EmailVerificationService
from studyflow.database import Base, Database
from studyflow.database.models import AuthenticationEmailToken, StudentAccount


@pytest.mark.anyio
async def test_verification_is_atomic_expiring_and_single_use() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    now = datetime.now(UTC)
    raw_token = "single-use-verification-token"

    try:
        async with database.transaction() as session:
            await session.run_sync(
                lambda sync_session: Base.metadata.create_all(sync_session.connection())
            )
        await SqlAlchemyRegistrationRepository(database).create_unverified(
            PendingAccount(
                email="student@example.com",
                name="Student Name",
                password_hash="$argon2id$stored-hash",
                timezone="UTC",
                verification_token_hash=hash_verification_token(raw_token),
                verification_expires_at=now + timedelta(hours=8),
            )
        )
        verification = EmailVerificationService(
            repository=SqlAlchemyEmailVerificationRepository(database),
            clock=lambda: now,
        )

        assert await verification.verify(raw_token) is True
        assert await verification.verify(raw_token) is False

        async with database.transaction() as session:
            account = (await session.scalars(select(StudentAccount))).one()
            token = (await session.scalars(select(AuthenticationEmailToken))).one()

        assert account.email_verified_at is not None
        assert token.consumed_at is not None
        assert account.email_verified_at.replace(tzinfo=UTC) == now
        assert token.consumed_at.replace(tzinfo=UTC) == now
    finally:
        await database.stop()
