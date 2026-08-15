from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from studyflow.auth.registration import (
    PendingRegistration,
    RegistrationCompletion,
    hash_verification_token,
)
from studyflow.auth.repositories import (
    SqlAlchemyEmailVerificationRepository,
    SqlAlchemyRegistrationRepository,
)
from studyflow.auth.verification import EmailVerificationService
from studyflow.database import Base, Database
from studyflow.database.models import AuthenticationRegistration, StudentAccount


async def database() -> Database:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    async with database.transaction() as session:
        await session.run_sync(lambda sync: Base.metadata.create_all(sync.connection()))
    return database


@pytest.mark.anyio
async def test_registration_creates_no_account_until_verified_completion() -> None:
    db = await database()
    now = datetime.now(UTC)
    repository = SqlAlchemyRegistrationRepository(db)
    try:
        assert await repository.begin(
            PendingRegistration(
                email="student@example.com",
                verification_token_hash=hash_verification_token("email-token"),
                verification_expires_at=now + timedelta(hours=8),
            )
        )
        async with db.transaction() as session:
            assert list(await session.scalars(select(StudentAccount))) == []
            [pending] = list(await session.scalars(select(AuthenticationRegistration)))
        assert pending.email == "student@example.com"

        signup_token = "short-lived-signup-token"
        verification = EmailVerificationService(
            SqlAlchemyEmailVerificationRepository(db),
            token_factory=lambda: signup_token,
            clock=lambda: now,
        )
        assert await verification.verify("email-token") == signup_token
        assert await verification.verify("email-token") is None

        completion = RegistrationCompletion(
            signup_token_hash=hash_verification_token(signup_token),
            name="Student Name",
            password_hash="$argon2id$stored-hash",
            timezone="Asia/Phnom_Penh",
        )
        assert await repository.complete(completion, now)
        assert not await repository.complete(completion, now)

        async with db.transaction() as session:
            [account] = list(await session.scalars(select(StudentAccount)))
            assert list(await session.scalars(select(AuthenticationRegistration))) == []
        assert account.email == "student@example.com"
        assert account.name == "Student Name"
        assert account.password_hash == "$argon2id$stored-hash"
        assert account.email_verified_at is not None
    finally:
        await db.stop()


@pytest.mark.anyio
async def test_repeated_email_rotates_only_pending_challenge_not_credentials() -> None:
    db = await database()
    now = datetime.now(UTC)
    repository = SqlAlchemyRegistrationRepository(db)
    try:
        for token in ("first-token", "second-token"):
            assert await repository.begin(
                PendingRegistration(
                    email="student@example.com",
                    verification_token_hash=hash_verification_token(token),
                    verification_expires_at=now + timedelta(hours=8),
                )
            )
        async with db.transaction() as session:
            assert list(await session.scalars(select(StudentAccount))) == []
            [pending] = list(await session.scalars(select(AuthenticationRegistration)))
        assert pending.verification_token_hash == hash_verification_token("second-token")
    finally:
        await db.stop()


@pytest.mark.anyio
async def test_existing_account_is_not_replaced_or_given_a_challenge() -> None:
    db = await database()
    now = datetime.now(UTC)
    try:
        async with db.transaction() as session:
            session.add(
                StudentAccount(
                    email="student@example.com",
                    name="Existing",
                    password_hash="$argon2id$existing",
                    timezone="UTC",
                    email_verified_at=now,
                )
            )
        repository = SqlAlchemyRegistrationRepository(db)
        assert not await repository.begin(
            PendingRegistration(
                email="student@example.com",
                verification_token_hash="a" * 64,
                verification_expires_at=now + timedelta(hours=8),
            )
        )
        async with db.transaction() as session:
            [account] = list(await session.scalars(select(StudentAccount)))
            assert list(await session.scalars(select(AuthenticationRegistration))) == []
        assert account.password_hash == "$argon2id$existing"
    finally:
        await db.stop()


@pytest.mark.anyio
async def test_expired_signup_token_cannot_create_account() -> None:
    db = await database()
    now = datetime.now(UTC)
    repository = SqlAlchemyRegistrationRepository(db)
    try:
        await repository.begin(
            PendingRegistration(
                email="student@example.com",
                verification_token_hash=hash_verification_token("email-token"),
                verification_expires_at=now + timedelta(hours=8),
            )
        )
        verification = EmailVerificationService(
            SqlAlchemyEmailVerificationRepository(db),
            token_factory=lambda: "signup-token",
            clock=lambda: now,
        )
        await verification.verify("email-token")
        assert not await repository.complete(
            RegistrationCompletion(
                signup_token_hash=hash_verification_token("signup-token"),
                name="Student",
                password_hash="$argon2id$hash",
                timezone="UTC",
            ),
            now + timedelta(minutes=31),
        )
    finally:
        await db.stop()
