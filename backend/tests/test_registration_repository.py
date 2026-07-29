from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from studyflow.auth.registration import PendingAccount
from studyflow.auth.repositories import SqlAlchemyRegistrationRepository
from studyflow.database import Base, Database
from studyflow.database.models import AuthenticationEmailToken, StudentAccount


@pytest.mark.anyio
async def test_repository_atomically_creates_unverified_account_and_token() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    now = datetime.now(UTC)

    try:
        async with database.transaction() as session:
            await session.run_sync(
                lambda sync_session: Base.metadata.create_all(sync_session.connection())
            )

        repository = SqlAlchemyRegistrationRepository(database)
        created = await repository.create_unverified(
            PendingAccount(
                email="student@example.com",
                name="Student Name",
                password_hash="$argon2id$stored-hash",
                timezone="Asia/Phnom_Penh",
                verification_token_hash="a" * 64,
                verification_expires_at=now + timedelta(hours=8),
            )
        )
        duplicate_created = await repository.create_unverified(
            PendingAccount(
                email="student@example.com",
                name="Different Name",
                password_hash="$argon2id$different-hash",
                timezone="UTC",
                verification_token_hash="b" * 64,
                verification_expires_at=now + timedelta(hours=8),
            )
        )

        async with database.transaction() as session:
            account = (await session.scalars(select(StudentAccount))).one()
            token = (await session.scalars(select(AuthenticationEmailToken))).one()

        assert created is True
        assert duplicate_created is True
        assert account.email == "student@example.com"
        assert account.name == "Student Name"
        assert account.email_verified_at is None
        assert token.account_id == account.id
        assert token.purpose == "email_verification"
        assert token.token_hash == "b" * 64

        async with database.transaction() as session:
            stored_account = (await session.scalars(select(StudentAccount))).one()
            stored_account.email_verified_at = now

        verified_retry = await repository.create_unverified(
            PendingAccount(
                email="student@example.com",
                name="Different Name",
                password_hash="$argon2id$different-hash",
                timezone="UTC",
                verification_token_hash="c" * 64,
                verification_expires_at=now + timedelta(hours=8),
            )
        )
        async with database.transaction() as session:
            verified_token = (await session.scalars(select(AuthenticationEmailToken))).one()

        assert verified_retry is False
        assert verified_token.token_hash == "b" * 64
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_repository_does_not_misreport_a_token_collision_as_an_existing_email() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    now = datetime.now(UTC)

    try:
        async with database.transaction() as session:
            await session.run_sync(
                lambda sync_session: Base.metadata.create_all(sync_session.connection())
            )

        repository = SqlAlchemyRegistrationRepository(database)
        first_account = PendingAccount(
            email="first@example.com",
            name="First Student",
            password_hash="$argon2id$first-hash",
            timezone="UTC",
            verification_token_hash="a" * 64,
            verification_expires_at=now + timedelta(hours=8),
        )
        second_account = PendingAccount(
            email="second@example.com",
            name="Second Student",
            password_hash="$argon2id$second-hash",
            timezone="UTC",
            verification_token_hash="a" * 64,
            verification_expires_at=now + timedelta(hours=8),
        )
        assert await repository.create_unverified(first_account) is True

        with pytest.raises(IntegrityError):
            await repository.create_unverified(second_account)
    finally:
        await database.stop()
