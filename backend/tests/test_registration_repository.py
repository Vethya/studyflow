import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

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
            stored_account = await session.get(StudentAccount, account_id)
            assert stored_account is not None
            assert stored_account.name == "Updated Student"
            assert stored_account.password_hash == "$argon2id$new"
            assert stored_account.timezone == "Asia/Phnom_Penh"
            assert stored_account.email_verified_at is not None
            assert list(await session.scalars(select(AuthenticationRegistration))) == []
    finally:
        await db.stop()


@pytest.mark.anyio
async def test_completion_rejects_an_account_that_claimed_the_registration_email() -> None:
    db = await database()
    now = datetime.now(UTC)
    repository = SqlAlchemyRegistrationRepository(db)
    try:
        async with db.transaction() as session:
            session.add(
                AuthenticationRegistration(
                    email="student@example.com",
                    verification_token_hash=hash_verification_token("email-token"),
                    verification_expires_at=now + timedelta(hours=1),
                    verified_at=now,
                    signup_token_hash=hash_verification_token("signup-token"),
                    signup_expires_at=now + timedelta(minutes=30),
                )
            )
            session.add(
                StudentAccount(
                    email="student@example.com",
                    name="Google Student",
                    password_hash=None,
                    timezone="UTC",
                    email_verified_at=now,
                )
            )
        assert not await repository.complete(
            RegistrationCompletion(
                signup_token_hash=hash_verification_token("signup-token"),
                name="Password Student",
                password_hash="$argon2id$new",
                timezone="UTC",
            ),
            now,
        )
        async with db.transaction() as session:
            account = (await session.scalars(select(StudentAccount))).one()
            assert account.name == "Google Student"
            assert account.password_hash is None
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


@pytest.mark.anyio
async def test_signup_is_valid_validates_token_and_expiry() -> None:
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

        valid_hash = hash_verification_token("signup-token")
        assert await repository.signup_is_valid(valid_hash, now)
        assert not await repository.signup_is_valid(valid_hash, now + timedelta(minutes=31))
        assert not await repository.signup_is_valid(hash_verification_token("unknown"), now)
    finally:
        await db.stop()


@pytest.mark.anyio
async def test_complete_handles_integrity_error_race_condition(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from uuid import uuid4

    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import AsyncSession

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

        original_begin_nested = AsyncSession.begin_nested

        @asynccontextmanager
        async def mock_begin_nested(
            session: AsyncSession, *args: object, **kwargs: object
        ) -> AsyncIterator[object]:
            conn = await session.connection()
            await conn.execute(
                text(
                    "INSERT INTO student_accounts "
                    "(id, email, name, password_hash, email_verified_at, timezone) "
                    "VALUES (:id, :email, :name, :password_hash, :verified_at, :tz)"
                ),
                {
                    "id": str(uuid4()),
                    "email": "student@example.com",
                    "name": "Concurrent User",
                    "password_hash": "$argon2id$hash",
                    "verified_at": now.isoformat(),
                    "tz": "UTC",
                },
            )
            async with original_begin_nested(session, *args, **kwargs) as tx:
                yield tx

        monkeypatch.setattr(AsyncSession, "begin_nested", mock_begin_nested)

        completion = RegistrationCompletion(
            signup_token_hash=hash_verification_token("signup-token"),
            name="Student",
            password_hash="$argon2id$hash",
            timezone="UTC",
        )
        result = await repository.complete(completion, now)
        assert result is False

        # Registration should be pruned
        async with db.transaction() as session:
            assert list(await session.scalars(select(AuthenticationRegistration))) == []
    finally:
        await db.stop()


@pytest.mark.anyio
async def test_complete_re_raises_integrity_error_when_account_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from sqlalchemy.exc import IntegrityError
    from sqlalchemy.ext.asyncio import AsyncSession

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

        async def mock_flush_error(session: AsyncSession, *args: object, **kwargs: object) -> None:
            raise IntegrityError("stmt", {}, Exception("constraint failed"))

        monkeypatch.setattr(AsyncSession, "flush", mock_flush_error)

        completion = RegistrationCompletion(
            signup_token_hash=hash_verification_token("signup-token"),
            name="Student",
            password_hash="$argon2id$hash",
            timezone="UTC",
        )
        with pytest.raises(IntegrityError):
            await repository.complete(completion, now)
    finally:
        await db.stop()


@pytest.mark.anyio
async def test_registration_begin_rechecks_verified_accounts_after_races() -> None:
    now = datetime(2026, 7, 28, 12, tzinfo=UTC)
    pending = PendingRegistration(
        email="student@example.com",
        verification_token_hash="a" * 64,
        verification_expires_at=now + timedelta(hours=1),
        requested_at=now,
    )
    verified_account = SimpleNamespace(email_verified_at=now)
    session = MagicMock()
    session.scalar = AsyncMock(side_effect=[None, None, verified_account])
    transaction = MagicMock()
    transaction.__aenter__ = AsyncMock(return_value=session)
    transaction.__aexit__ = AsyncMock(return_value=False)
    database = MagicMock()
    database.transaction.return_value = transaction

    repository = SqlAlchemyRegistrationRepository(cast(Any, database))

    assert await repository.begin(pending) is False


@pytest.mark.anyio
async def test_registration_begin_handles_race_recheck_and_verified_pending_challenge() -> None:
    now = datetime(2026, 7, 28, 12, tzinfo=UTC)
    pending = PendingRegistration(
        email="student@example.com",
        verification_token_hash="a" * 64,
        verification_expires_at=now + timedelta(hours=1),
        requested_at=now,
    )

    class FailingTransaction:
        async def __aenter__(self) -> Any:
            raise IntegrityError("statement", {}, Exception("conflict"))

        async def __aexit__(self, *args: object) -> bool:
            return False

    verified_account = SimpleNamespace(email_verified_at=now)
    registration = SimpleNamespace(
        verified_at=now,
        signup_expires_at=now + timedelta(hours=1),
        verification_token_hash="b" * 64,
        verification_expires_at=now + timedelta(hours=1),
        signup_token_hash="c" * 64,
    )
    session = MagicMock()
    session.scalar = AsyncMock(side_effect=[None, registration, verified_account])
    transaction = MagicMock()
    transaction.__aenter__ = AsyncMock(return_value=session)
    transaction.__aexit__ = AsyncMock(return_value=False)
    database = MagicMock()
    transaction_calls = 0

    def transaction_factory() -> Any:
        nonlocal transaction_calls
        transaction_calls += 1
        return FailingTransaction() if transaction_calls in {1, 3} else transaction

    database.transaction.side_effect = transaction_factory
    repository = SqlAlchemyRegistrationRepository(cast(Any, database))

    assert await repository.begin(pending) is False

    session.scalar = AsyncMock(
        side_effect=[None, registration, verified_account, None, registration, None]
    )
    registration.signup_expires_at = now + timedelta(hours=1)
    registration.verified_at = now
    assert await repository.begin(pending) is False


@pytest.mark.anyio
async def test_registration_begin_returns_false_for_verified_pending_after_integrity_error() -> (
    None
):
    now = datetime(2026, 7, 28, 12, tzinfo=UTC)
    pending = PendingRegistration(
        email="student@example.com",
        verification_token_hash="a" * 64,
        verification_expires_at=now + timedelta(hours=1),
        requested_at=now,
    )

    class FailingTransaction:
        async def __aenter__(self) -> Any:
            raise IntegrityError("statement", {}, Exception("conflict"))

        async def __aexit__(self, *args: object) -> bool:
            return False

    registration = SimpleNamespace(
        verified_at=now,
        signup_expires_at=now + timedelta(hours=1),
        verification_token_hash="b" * 64,
        verification_expires_at=now + timedelta(hours=1),
        signup_token_hash="c" * 64,
    )
    session = MagicMock()
    session.scalar = AsyncMock(side_effect=[None, registration, None])
    transaction = MagicMock()
    transaction.__aenter__ = AsyncMock(return_value=session)
    transaction.__aexit__ = AsyncMock(return_value=False)
    database = MagicMock()
    database.transaction.side_effect = [FailingTransaction(), transaction]

    repository = SqlAlchemyRegistrationRepository(cast(Any, database))

    assert await repository.begin(pending) is False


@pytest.mark.anyio
async def test_registration_completion_returns_false_when_challenge_disappears() -> None:
    now = datetime(2026, 7, 28, 12, tzinfo=UTC)
    result = MagicMock()
    result.one_or_none.return_value = (uuid4(), "student@example.com")
    session = MagicMock()
    session.execute = AsyncMock(return_value=result)
    session.scalar = AsyncMock(side_effect=[None, None])
    transaction = MagicMock()
    transaction.__aenter__ = AsyncMock(return_value=session)
    transaction.__aexit__ = AsyncMock(return_value=False)
    database = MagicMock()
    database.transaction.return_value = transaction

    repository = SqlAlchemyRegistrationRepository(cast(Any, database))
    completion = RegistrationCompletion(
        signup_token_hash="a" * 64,
        name="Student",
        password_hash="$argon2id$hash",
        timezone="UTC",
    )

    assert await repository.complete(completion, now) is False


@pytest.mark.anyio
async def test_registration_completion_updates_unverified_race_account() -> None:
    now = datetime(2026, 7, 28, 12, tzinfo=UTC)
    registration = SimpleNamespace(email="student@example.com")
    raced_account = SimpleNamespace(
        email_verified_at=None,
        name="Concurrent",
        password_hash="$argon2id$old",
        timezone="UTC",
    )
    result = MagicMock()
    result.one_or_none.return_value = (uuid4(), registration.email)
    session = MagicMock()
    session.execute = AsyncMock(return_value=result)
    session.scalar = AsyncMock(side_effect=[None, registration, None, raced_account])
    session.add = MagicMock()
    session.flush = AsyncMock(side_effect=IntegrityError("statement", {}, Exception("conflict")))
    session.delete = AsyncMock()
    nested = MagicMock()
    nested.__aenter__ = AsyncMock(return_value=object())
    nested.__aexit__ = AsyncMock(return_value=False)
    session.begin_nested.return_value = nested
    transaction = MagicMock()
    transaction.__aenter__ = AsyncMock(return_value=session)
    transaction.__aexit__ = AsyncMock(return_value=False)
    database = MagicMock()
    database.transaction.return_value = transaction

    repository = SqlAlchemyRegistrationRepository(cast(Any, database))
    completion = RegistrationCompletion(
        signup_token_hash="a" * 64,
        name="Student",
        password_hash="$argon2id$new",
        timezone="Asia/Phnom_Penh",
    )

    assert await repository.complete(completion, now) is True
    assert raced_account.name == "Student"
    assert raced_account.password_hash == "$argon2id$new"
    assert raced_account.timezone == "Asia/Phnom_Penh"


@pytest.mark.anyio
async def test_registration_create_and_complete_edge_cases(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from sqlalchemy.exc import IntegrityError

    db = await database()
    now = datetime.now(UTC)
    repository = SqlAlchemyRegistrationRepository(db)
    try:
        # 1. create returns False if verified account already exists (line 64)
        async with db.transaction() as session:
            session.add(
                StudentAccount(
                    email="verified@example.com",
                    name="Verified Student",
                    password_hash="$argon2id$hash",
                    timezone="UTC",
                    email_verified_at=now,
                )
            )
        assert (
            await repository.begin(
                PendingRegistration(
                    email="verified@example.com",
                    verification_token_hash=hash_verification_token("tok1"),
                    verification_expires_at=now + timedelta(hours=8),
                    requested_at=now,
                )
            )
            is False
        )

        # 2. complete returns False if registration is None (line 163)
        completion = RegistrationCompletion(
            signup_token_hash=hash_verification_token("nonexistent-token"),
            name="Student",
            password_hash="$argon2id$hash",
            timezone="UTC",
        )
        assert await repository.complete(completion, now) is False

        # 3. complete with existing unverified account updates it (lines 193->196)
        async with db.transaction() as session:
            session.add(
                StudentAccount(
                    email="unverified@example.com",
                    name="Old Name",
                    password_hash="$argon2id$old",
                    timezone="UTC",
                    email_verified_at=None,
                )
            )
        await repository.begin(
            PendingRegistration(
                email="unverified@example.com",
                verification_token_hash=hash_verification_token("unverified-email-tok"),
                verification_expires_at=now + timedelta(hours=8),
                requested_at=now,
            )
        )
        verification = EmailVerificationService(
            SqlAlchemyEmailVerificationRepository(db),
            token_factory=lambda: "unverified-signup-tok",
            clock=lambda: now,
        )
        await verification.verify("unverified-email-tok")
        unverified_completion = RegistrationCompletion(
            signup_token_hash=hash_verification_token("unverified-signup-tok"),
            name="New Name",
            password_hash="$argon2id$new",
            timezone="America/New_York",
        )
        assert await repository.complete(unverified_completion, now) is True

        # 4. Fallback transaction branches on IntegrityError (lines 75-100)
        # Test line 97: IntegrityError re-raised when registration is None in fallback
        orig_tx = db.transaction
        call_count = 0

        @asynccontextmanager
        async def failing_first_tx() -> AsyncIterator[AsyncSession]:
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise IntegrityError("first_tx", {}, Exception("constraint"))
            async with orig_tx() as session:
                yield session

        monkeypatch.setattr(db, "transaction", failing_first_tx)
        with pytest.raises(IntegrityError):
            await repository.begin(
                PendingRegistration(
                    email="missing-reg@example.com",
                    verification_token_hash=hash_verification_token("tok-missing"),
                    verification_expires_at=now + timedelta(hours=8),
                    requested_at=now,
                )
            )

        # Test line 83/95: returns False when verified account exists in fallback
        call_count = 0
        assert (
            await repository.begin(
                PendingRegistration(
                    email="verified@example.com",
                    verification_token_hash=hash_verification_token("tok-ver"),
                    verification_expires_at=now + timedelta(hours=8),
                    requested_at=now,
                )
            )
            is False
        )
    finally:
        await db.stop()


def test_rotate_pending_handles_naive_signup_expires_at() -> None:
    now = datetime.now(UTC)
    reg = AuthenticationRegistration(
        email="test@example.com",
        verification_token_hash="hash",
        verification_expires_at=now,
        verified_at=now - timedelta(minutes=5),
        signup_token_hash="signup-hash",
        signup_expires_at=datetime(2026, 7, 28, 12, 0, 0),  # naive
    )
    pending = PendingRegistration(
        email="test@example.com",
        verification_token_hash="new-hash",
        verification_expires_at=now + timedelta(hours=8),
        requested_at=datetime(2026, 7, 28, 11, 0, 0, tzinfo=UTC),
    )
    assert SqlAlchemyRegistrationRepository._rotate_pending(reg, pending) is False
