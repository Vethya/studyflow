from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from studyflow.auth.rate_limits import (
    AccountPasswordChangeRateLimitExceeded,
    DatabaseAccountPasswordChangeRateLimiter,
    DatabaseEmailVerificationRateLimiter,
    DatabaseLoginRateLimiter,
    DatabaseOIDCLinkRateLimiter,
    DatabaseOIDCStartRateLimiter,
    DatabasePasswordResetAttemptRateLimiter,
    DatabasePasswordResetRequestRateLimiter,
    DatabaseRegistrationCompletionRateLimiter,
    DatabaseRegistrationRateLimiter,
    DatabaseVerificationResendRateLimiter,
    EmailVerificationRateLimitExceeded,
    LoginRateLimitExceeded,
    OIDCLinkRateLimitExceeded,
    OIDCStartRateLimitExceeded,
    PasswordResetAttemptRateLimitExceeded,
    PasswordResetRequestRateLimitExceeded,
    RegistrationCompletionRateLimitExceeded,
    RegistrationRateLimitExceeded,
    VerificationResendRateLimitExceeded,
)
from studyflow.database import Base, Database
from studyflow.database.models import AuthenticationRateLimit


@pytest.mark.anyio
async def test_registration_rate_limit_bounds_ip_and_email_attempts_per_window() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    current_time = datetime(2026, 7, 28, 12, tzinfo=UTC)
    try:
        async with database.transaction() as session:
            await session.run_sync(
                lambda sync_session: Base.metadata.create_all(sync_session.connection())
            )
        first_worker = DatabaseRegistrationRateLimiter(database, clock=lambda: current_time)
        second_worker = DatabaseRegistrationRateLimiter(database, clock=lambda: current_time)

        for _ in range(5):
            await first_worker.check("203.0.113.10", "student@example.com")

        with pytest.raises(RegistrationRateLimitExceeded):
            await second_worker.check("203.0.113.10", "student@example.com")

        current_time += timedelta(seconds=900)
        await second_worker.check("203.0.113.10", "student@example.com")
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_registration_completion_rate_limit_bounds_ip_and_signup_token_across_workers() -> (
    None
):
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    try:
        async with database.transaction() as session:
            await session.run_sync(
                lambda sync_session: Base.metadata.create_all(sync_session.connection())
            )
        first_worker = DatabaseRegistrationCompletionRateLimiter(database)
        second_worker = DatabaseRegistrationCompletionRateLimiter(database)

        for attempt in range(5):
            await first_worker.check("203.0.113.10", f"signup-token-{attempt}")
        with pytest.raises(RegistrationCompletionRateLimitExceeded):
            await second_worker.check("203.0.113.10", "signup-token-5")

        for attempt in range(5):
            await first_worker.check(f"198.51.100.{attempt}", "shared-signup-token")
        with pytest.raises(RegistrationCompletionRateLimitExceeded):
            await second_worker.check("198.51.100.99", "shared-signup-token")
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_rate_limit_prunes_expired_attacker_controlled_keys() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    current_time = datetime(2026, 7, 28, 12, tzinfo=UTC)
    try:
        async with database.transaction() as session:
            await session.run_sync(
                lambda sync_session: Base.metadata.create_all(sync_session.connection())
            )
        limiter = DatabaseRegistrationRateLimiter(database, clock=lambda: current_time)
        await limiter.check("203.0.113.10", "attacker-controlled@example.com")

        current_time += timedelta(seconds=900)
        await limiter.check("203.0.113.11", "current@example.com")

        async with database.transaction() as session:
            rows = list(await session.scalars(select(AuthenticationRateLimit)))
        assert len(rows) == 2
        assert all(row.window_started_at.replace(tzinfo=UTC) == current_time for row in rows)
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_email_verification_rate_limit_is_shared_between_workers() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    current_time = datetime(2026, 7, 28, 12, tzinfo=UTC)
    try:
        async with database.transaction() as session:
            await session.run_sync(
                lambda sync_session: Base.metadata.create_all(sync_session.connection())
            )
        first_worker = DatabaseEmailVerificationRateLimiter(
            database, maximum_attempts=5, clock=lambda: current_time
        )
        second_worker = DatabaseEmailVerificationRateLimiter(
            database, maximum_attempts=5, clock=lambda: current_time
        )

        for _ in range(5):
            await first_worker.check("203.0.113.10", "verification-token")

        with pytest.raises(EmailVerificationRateLimitExceeded):
            await second_worker.check("203.0.113.10", "verification-token")
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_oidc_start_rate_limit_bounds_unauthenticated_state_creation() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    try:
        async with database.transaction() as session:
            await session.run_sync(
                lambda sync_session: Base.metadata.create_all(sync_session.connection())
            )
        limiter = DatabaseOIDCStartRateLimiter(database)
        for _ in range(5):
            await limiter.check("203.0.113.10")
        with pytest.raises(OIDCStartRateLimitExceeded):
            await limiter.check("203.0.113.10")
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_oidc_link_rate_limit_bounds_rotating_ips_by_stable_account() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    try:
        async with database.transaction() as session:
            await session.run_sync(
                lambda sync_session: Base.metadata.create_all(sync_session.connection())
            )
        limiter = DatabaseOIDCLinkRateLimiter(database)
        for attempt in range(5):
            await limiter.check(f"203.0.113.{attempt}", "account-id")
        with pytest.raises(OIDCLinkRateLimitExceeded):
            await limiter.check("203.0.113.99", "account-id")
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_successful_logins_do_not_consume_failure_budget() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    try:
        async with database.transaction() as session:
            await session.run_sync(
                lambda sync_session: Base.metadata.create_all(sync_session.connection())
            )
        limiter = DatabaseLoginRateLimiter(database)
        for attempt in range(4):
            reservation_id = await limiter.check(f"198.51.100.{attempt}", "student@example.com")
            await limiter.record_failure("student@example.com", reservation_id)
        reservation_id = await limiter.check("198.51.100.99", "student@example.com")
        await limiter.reset_failures("student@example.com", reservation_id)
        for attempt in range(10):
            email = "student@example.com"
            reservation_id = await limiter.check(f"203.0.113.{attempt}", email)
            await limiter.reset_failures(email, reservation_id)
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_login_failure_budget_follows_email_across_ips() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    try:
        async with database.transaction() as session:
            await session.run_sync(
                lambda sync_session: Base.metadata.create_all(sync_session.connection())
            )
        limiter = DatabaseLoginRateLimiter(database)
        for attempt in range(5):
            email = "Student@Example.com"
            reservation_id = await limiter.check(f"203.0.113.{attempt}", email)
            await limiter.record_failure(email, reservation_id)
        with pytest.raises(LoginRateLimitExceeded):
            await limiter.check("203.0.113.99", "student@example.com")
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_login_traffic_has_a_separate_higher_per_ip_limit() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    try:
        async with database.transaction() as session:
            await session.run_sync(
                lambda sync_session: Base.metadata.create_all(sync_session.connection())
            )
        limiter = DatabaseLoginRateLimiter(database)
        for attempt in range(30):
            await limiter.check("203.0.113.10", f"student-{attempt}@example.com")
        with pytest.raises(LoginRateLimitExceeded):
            await limiter.check("203.0.113.10", "last@example.com")
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_parallel_login_attempts_reserve_the_failure_budget() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    try:
        async with database.transaction() as session:
            await session.run_sync(
                lambda sync_session: Base.metadata.create_all(sync_session.connection())
            )
        limiter = DatabaseLoginRateLimiter(database)
        for attempt in range(5):
            await limiter.check(f"203.0.113.{attempt}", "student@example.com")
        with pytest.raises(LoginRateLimitExceeded):
            await limiter.check("203.0.113.99", "student@example.com")
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_newer_login_reservations_keep_their_own_expiry() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    current_time = [datetime(2026, 8, 15, 12, tzinfo=UTC)]
    try:
        async with database.transaction() as session:
            await session.run_sync(
                lambda sync_session: Base.metadata.create_all(sync_session.connection())
            )
        limiter = DatabaseLoginRateLimiter(database, clock=lambda: current_time[0])
        await limiter.check("203.0.113.1", "student@example.com")
        current_time[0] += timedelta(minutes=14)
        await limiter.check("203.0.113.2", "student@example.com")
        current_time[0] += timedelta(minutes=2)
        for attempt in range(4):
            await limiter.check(f"203.0.113.{attempt + 3}", "student@example.com")
        with pytest.raises(LoginRateLimitExceeded):
            await limiter.check("203.0.113.99", "student@example.com")
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_verification_resend_rate_limit_bounds_ip_and_email() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    try:
        async with database.transaction() as session:
            await session.run_sync(
                lambda sync_session: Base.metadata.create_all(sync_session.connection())
            )
        limiter = DatabaseVerificationResendRateLimiter(database)
        for _ in range(5):
            await limiter.check("203.0.113.10", "student@example.com")
        with pytest.raises(VerificationResendRateLimitExceeded):
            await limiter.check("203.0.113.10", "student@example.com")
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_password_reset_request_rate_limit_bounds_ip_and_email() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    try:
        async with database.transaction() as session:
            await session.run_sync(
                lambda sync_session: Base.metadata.create_all(sync_session.connection())
            )
        limiter = DatabasePasswordResetRequestRateLimiter(database)
        for _ in range(5):
            await limiter.check("203.0.113.10", "student@example.com")
        with pytest.raises(PasswordResetRequestRateLimitExceeded):
            await limiter.check("203.0.113.10", "student@example.com")
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_password_reset_attempt_rate_limit_bounds_ip_and_token() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    try:
        async with database.transaction() as session:
            await session.run_sync(
                lambda sync_session: Base.metadata.create_all(sync_session.connection())
            )
        limiter = DatabasePasswordResetAttemptRateLimiter(database)
        for _ in range(5):
            await limiter.check("203.0.113.10", "reset-token")
        with pytest.raises(PasswordResetAttemptRateLimitExceeded):
            await limiter.check("203.0.113.10", "reset-token")
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_account_password_change_rate_limit_bounds_ip_and_account() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    try:
        async with database.transaction() as session:
            await session.run_sync(
                lambda sync_session: Base.metadata.create_all(sync_session.connection())
            )
        limiter = DatabaseAccountPasswordChangeRateLimiter(database)
        for _ in range(5):
            await limiter.check("203.0.113.10", "account-123")
        with pytest.raises(AccountPasswordChangeRateLimitExceeded):
            await limiter.check("203.0.113.10", "account-123")
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_registration_rate_limiter_integrity_error_and_window_reset(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from contextlib import asynccontextmanager

    from sqlalchemy.exc import IntegrityError

    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    current_time = datetime(2026, 7, 28, 12, tzinfo=UTC)
    try:
        async with database.transaction() as session:
            await session.run_sync(
                lambda sync_session: Base.metadata.create_all(sync_session.connection())
            )
        limiter = DatabaseRegistrationRateLimiter(database, clock=lambda: current_time)
        await limiter.check("203.0.113.10", "student@example.com")

        # Window expiration reset
        current_time += timedelta(seconds=1000)
        await limiter.check("203.0.113.10", "student@example.com")

        # IntegrityError retry exhaustion
        orig_tx = database.transaction

        def raise_integrity(*args: object, **kwargs: object) -> None:
            raise IntegrityError("statement", {}, Exception("orig"))

        @asynccontextmanager
        async def failing_transaction() -> AsyncIterator[AsyncSession]:
            async with orig_tx() as session:
                monkeypatch.setattr(session, "flush", raise_integrity)
                yield session

        monkeypatch.setattr(database, "transaction", failing_transaction)
        with pytest.raises(IntegrityError):
            await limiter.check("203.0.113.10", "student@example.com")
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_login_rate_limiter_edge_cases(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from contextlib import asynccontextmanager

    from sqlalchemy import delete
    from sqlalchemy.exc import IntegrityError

    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    current_time = datetime(2026, 7, 28, 12, tzinfo=UTC)
    try:
        async with database.transaction() as session:
            await session.run_sync(
                lambda sync_session: Base.metadata.create_all(sync_session.connection())
            )
        limiter = DatabaseLoginRateLimiter(database, clock=lambda: current_time)

        # 1. Release
        reservation = await limiter.check("203.0.113.10", "student@example.com")
        await limiter.release("student@example.com", reservation)

        # 2. Record failure and reset failures
        res2 = await limiter.check("203.0.113.10", "student@example.com")
        await limiter.record_failure("student@example.com", res2)
        current_time += timedelta(seconds=1000)
        res3 = await limiter.check("203.0.113.10", "student@example.com")
        await limiter.record_failure("student@example.com", res3)
        await limiter.reset_failures("student@example.com", res3)

        # 3. Expired failures during reservation and finish failure slot
        key_hash = limiter._hash_key("email:student@example.com")
        async with database.transaction() as session:
            session.add(
                AuthenticationRateLimit(
                    action="login_failure",
                    key_hash=key_hash,
                    window_started_at=current_time - timedelta(seconds=1000),
                    attempts=1,
                )
            )
        # Hits lines 285-286 (delete expired failures in _reserve_failure_slot)
        res_expired = await limiter._reserve_failure_slot("student@example.com")
        await limiter.release("student@example.com", res_expired)

        # Re-add expired failure and hit lines 367-368
        # (delete and flush expired failure in _finish_failure_slot)
        async with database.transaction() as session:
            session.add(
                AuthenticationRateLimit(
                    action="login_failure",
                    key_hash=key_hash,
                    window_started_at=current_time - timedelta(seconds=1000),
                    attempts=1,
                )
            )
        await limiter._finish_failure_slot(
            "student@example.com", "fake_res", failed=True, reset_failures=False
        )

        # 4. Finish failure slot when guard is missing
        async with database.transaction() as session:
            await session.execute(
                delete(AuthenticationRateLimit).where(
                    AuthenticationRateLimit.action == "login_guard"
                )
            )
        await limiter._finish_failure_slot(
            "student@example.com", "fake_res", failed=False, reset_failures=False
        )

        # 5. Reserve failure slot IntegrityError exhaustion (lines 311-312)
        orig_tx = database.transaction

        def raise_integrity(*args: object, **kwargs: object) -> None:
            raise IntegrityError("statement", {}, Exception("orig"))

        @asynccontextmanager
        async def failing_tx() -> AsyncIterator[AsyncSession]:
            async with orig_tx() as session:
                monkeypatch.setattr(session, "flush", raise_integrity)
                yield session

        monkeypatch.setattr(database, "transaction", failing_tx)
        with pytest.raises(IntegrityError):
            await limiter._reserve_failure_slot("student@example.com")

        # 6. Finish failure slot IntegrityError exhaustion
        @asynccontextmanager
        async def failing_tx_exec() -> AsyncIterator[AsyncSession]:
            async with orig_tx() as session:
                monkeypatch.setattr(session, "execute", raise_integrity)
                yield session

        monkeypatch.setattr(database, "transaction", failing_tx_exec)
        with pytest.raises(IntegrityError):
            await limiter._finish_failure_slot(
                "student@example.com", "fake_res", failed=True, reset_failures=False
            )

        monkeypatch.undo()
    finally:
        await database.stop()


def test_rate_limiter_is_expired_tzinfo_handling() -> None:
    limiter = DatabaseLoginRateLimiter(None)  # type: ignore[arg-type]
    now = datetime(2026, 7, 28, 12, tzinfo=UTC)
    aware_row = AuthenticationRateLimit(
        action="login_failure",
        key_hash="key",
        window_started_at=now - timedelta(seconds=1000),
        attempts=1,
    )
    assert limiter._is_expired(aware_row, now) is True

    naive_row = AuthenticationRateLimit(
        action="login_failure",
        key_hash="key",
        window_started_at=datetime(2026, 7, 28, 11, 0, 0),
        attempts=1,
    )
    assert limiter._is_expired(naive_row, now) is True
