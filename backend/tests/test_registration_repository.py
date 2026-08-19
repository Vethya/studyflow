import asyncio
from datetime import UTC, datetime, timedelta
from pathlib import Path

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
                requested_at=now,
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
                    requested_at=now,
                )
            )
        async with db.transaction() as session:
            assert list(await session.scalars(select(StudentAccount))) == []
            [pending] = list(await session.scalars(select(AuthenticationRegistration)))
        assert pending.verification_token_hash == hash_verification_token("second-token")
    finally:
        await db.stop()


@pytest.mark.anyio
async def test_repeated_email_cannot_invalidate_a_verified_signup_session() -> None:
    db = await database()
    now = datetime.now(UTC)
    repository = SqlAlchemyRegistrationRepository(db)
    try:
        await repository.begin(
            PendingRegistration(
                email="student@example.com",
                verification_token_hash=hash_verification_token("email-token"),
                verification_expires_at=now + timedelta(hours=8),
                requested_at=now,
            )
        )
        verification = EmailVerificationService(
            SqlAlchemyEmailVerificationRepository(db),
            token_factory=lambda: "signup-token",
            clock=lambda: now,
        )
        await verification.verify("email-token")

        assert not await repository.begin(
            PendingRegistration(
                email="student@example.com",
                verification_token_hash=hash_verification_token("attacker-token"),
                verification_expires_at=now + timedelta(hours=8, minutes=1),
                requested_at=now + timedelta(minutes=1),
            )
        )
        assert await repository.complete(
            RegistrationCompletion(
                signup_token_hash=hash_verification_token("signup-token"),
                name="Student",
                password_hash="$argon2id$hash",
                timezone="UTC",
            ),
            now + timedelta(minutes=1),
        )
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
                requested_at=now,
            )
        )
        async with db.transaction() as session:
            [account] = list(await session.scalars(select(StudentAccount)))
            assert list(await session.scalars(select(AuthenticationRegistration))) == []
        assert account.password_hash == "$argon2id$existing"
    finally:
        await db.stop()


@pytest.mark.anyio
async def test_migrated_pending_account_is_completed_in_place() -> None:
    db = await database()
    now = datetime.now(UTC)
    account_id = None
    repository = SqlAlchemyRegistrationRepository(db)
    try:
        async with db.transaction() as session:
            account = StudentAccount(
                email="student@example.com",
                name="Legacy",
                password_hash="$argon2id$legacy",
                timezone="UTC",
            )
            session.add(account)
            await session.flush()
            account_id = account.id
            session.add(
                AuthenticationRegistration(
                    email=account.email,
                    verification_token_hash=hash_verification_token("email-token"),
                    verification_expires_at=now + timedelta(hours=1),
                    verified_at=now,
                    signup_token_hash=hash_verification_token("signup-token"),
                    signup_expires_at=now + timedelta(minutes=30),
                )
            )
        assert await repository.complete(
            RegistrationCompletion(
                signup_token_hash=hash_verification_token("signup-token"),
                name="Updated Student",
                password_hash="$argon2id$new",
                timezone="Asia/Phnom_Penh",
            ),
            now,
        )
        async with db.transaction() as session:
            account = await session.get(StudentAccount, account_id)
            assert account is not None
            assert account.name == "Updated Student"
            assert account.password_hash == "$argon2id$new"
            assert account.timezone == "Asia/Phnom_Penh"
            assert account.email_verified_at is not None
            assert list(await session.scalars(select(AuthenticationRegistration))) == []
    finally:
        await db.stop()


@pytest.mark.anyio
async def test_concurrent_registration_for_same_email_does_not_fail(
    tmp_path: Path,
) -> None:
    db = Database(f"sqlite+aiosqlite:///{tmp_path / 'registration.db'}")
    await db.start()
    async with db.transaction() as session:
        await session.run_sync(lambda sync: Base.metadata.create_all(sync.connection()))
    now = datetime.now(UTC)
    repository = SqlAlchemyRegistrationRepository(db)
    try:
        results = await asyncio.gather(
            *(
                repository.begin(
                    PendingRegistration(
                        email="student@example.com",
                        verification_token_hash=hash_verification_token(f"token-{index}"),
                        verification_expires_at=now + timedelta(hours=8),
                        requested_at=now,
                    )
                )
                for index in range(2)
            )
        )
        assert results == [True, True]
        async with db.transaction() as session:
            assert len(list(await session.scalars(select(AuthenticationRegistration)))) == 1
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
                requested_at=now,
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
