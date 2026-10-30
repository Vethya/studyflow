from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Any, cast
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
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

CLIENT_IP = "203.0.113.10"


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
        email = "student@example.com"
        for _ in range(4):
            reservation_id = await limiter.check(CLIENT_IP, email)
            await limiter.record_failure(CLIENT_IP, email, reservation_id)
        reservation_id = await limiter.check(CLIENT_IP, email)
        await limiter.reset_failures(CLIENT_IP, email, reservation_id)
        for _ in range(10):
            reservation_id = await limiter.check(CLIENT_IP, email)
            await limiter.reset_failures(CLIENT_IP, email, reservation_id)
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_login_failures_lock_out_only_the_failing_address() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    try:
        async with database.transaction() as session:
            await session.run_sync(
                lambda sync_session: Base.metadata.create_all(sync_session.connection())
            )
        limiter = DatabaseLoginRateLimiter(database)
        attacker_ip = "203.0.113.66"
        for _ in range(5):
            reservation_id = await limiter.check(attacker_ip, "Student@Example.com")
            await limiter.record_failure(attacker_ip, "Student@Example.com", reservation_id)

        with pytest.raises(LoginRateLimitExceeded):
            await limiter.check(attacker_ip, "student@example.com")

        student_ip = "198.51.100.7"
        reservation_id = await limiter.check(student_ip, "student@example.com")
        await limiter.reset_failures(student_ip, "student@example.com", reservation_id)
        failures = [
            row for row in await _rate_limit_rows(database) if row.action == "login_failure"
        ]
        assert len(failures) == 1
        assert failures[0].attempts == 5
        assert failures[0].key_hash == limiter._hash_key(
            f"email_ip:student@example.com|{attacker_ip}"
        )
        with pytest.raises(LoginRateLimitExceeded):
            await limiter.check(attacker_ip, "student@example.com")
        reservation_id = await limiter.check(attacker_ip, "other@example.com")
        await limiter.release(attacker_ip, "other@example.com", reservation_id)
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_login_failure_backstop_follows_email_across_addresses() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    try:
        async with database.transaction() as session:
            await session.run_sync(
                lambda sync_session: Base.metadata.create_all(sync_session.connection())
            )
        limiter = DatabaseLoginRateLimiter(database, email_failure_attempts=10)
        for attempt in range(10):
            client_ip = f"203.0.113.{attempt // 2}"
            reservation_id = await limiter.check(client_ip, "Student@Example.com")
            await limiter.record_failure(client_ip, "Student@Example.com", reservation_id)

        with pytest.raises(LoginRateLimitExceeded):
            await limiter.check("198.51.100.99", "student@example.com")
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_login_backstop_defaults_well_above_the_per_address_budget() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    try:
        async with database.transaction() as session:
            await session.run_sync(
                lambda sync_session: Base.metadata.create_all(sync_session.connection())
            )
        limiter = DatabaseLoginRateLimiter(database)
        for attempt in range(49):
            client_ip = f"203.0.113.{attempt // 5}"
            reservation_id = await limiter.check(client_ip, "student@example.com")
            await limiter.record_failure(client_ip, "student@example.com", reservation_id)
        reservation_id = await limiter.check("198.51.100.1", "student@example.com")
        await limiter.record_failure("198.51.100.1", "student@example.com", reservation_id)

        with pytest.raises(LoginRateLimitExceeded):
            await limiter.check("198.51.100.2", "student@example.com")
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
        for _ in range(5):
            await limiter.check(CLIENT_IP, "student@example.com")
        with pytest.raises(LoginRateLimitExceeded):
            await limiter.check(CLIENT_IP, "student@example.com")
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
        await limiter.check(CLIENT_IP, "student@example.com")
        current_time[0] += timedelta(minutes=14)
        await limiter.check(CLIENT_IP, "student@example.com")
        current_time[0] += timedelta(minutes=2)
        for _ in range(4):
            await limiter.check(CLIENT_IP, "student@example.com")
        with pytest.raises(LoginRateLimitExceeded):
            await limiter.check(CLIENT_IP, "student@example.com")
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
        await limiter.release("203.0.113.10", "student@example.com", reservation)

        # 2. Record failure and reset failures
        res2 = await limiter.check("203.0.113.10", "student@example.com")
        await limiter.record_failure("203.0.113.10", "student@example.com", res2)
        current_time += timedelta(seconds=1000)
        res3 = await limiter.check("203.0.113.10", "student@example.com")
        await limiter.record_failure("203.0.113.10", "student@example.com", res3)
        await limiter.reset_failures("203.0.113.10", "student@example.com", res3)

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
        res_expired = await limiter._reserve_failure_slot("203.0.113.10", "student@example.com")
        await limiter.release("203.0.113.10", "student@example.com", res_expired)

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
            "203.0.113.10", "student@example.com", "fake_res", failed=True, reset_failures=False
        )

        # 4. Finish failure slot when guard is missing
        async with database.transaction() as session:
            await session.execute(
                delete(AuthenticationRateLimit).where(
                    AuthenticationRateLimit.action == "login_guard"
                )
            )
        await limiter._finish_failure_slot(
            "203.0.113.10", "student@example.com", "fake_res", failed=False, reset_failures=False
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
            await limiter._reserve_failure_slot("203.0.113.10", "student@example.com")

        # 6. Finish failure slot IntegrityError exhaustion
        @asynccontextmanager
        async def failing_tx_exec() -> AsyncIterator[AsyncSession]:
            async with orig_tx() as session:
                monkeypatch.setattr(session, "execute", raise_integrity)
                yield session

        monkeypatch.setattr(database, "transaction", failing_tx_exec)
        with pytest.raises(IntegrityError):
            await limiter._finish_failure_slot(
                "203.0.113.10", "student@example.com", "fake_res", failed=True, reset_failures=False
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


@pytest.mark.anyio
async def test_rate_limiter_handles_aware_expiry_and_exhausted_retry_loops(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import studyflow.auth.rate_limits as rate_limits_module

    now = datetime(2026, 7, 28, 12, tzinfo=UTC)
    limiter_key = DatabaseRegistrationRateLimiter
    row = AuthenticationRateLimit(
        action="registration",
        key_hash=limiter_key._hash_key("ip:203.0.113.10"),
        window_started_at=now - timedelta(seconds=1000),
        attempts=5,
    )
    session = MagicMock()
    session.execute = AsyncMock()
    session.scalars = AsyncMock(return_value=[row])
    session.flush = AsyncMock()
    transaction = MagicMock()
    transaction.__aenter__ = AsyncMock(return_value=session)
    transaction.__aexit__ = AsyncMock(return_value=False)
    database = MagicMock()
    database.transaction.return_value = transaction

    await limiter_key(cast(Any, database), clock=lambda: now).check(
        "203.0.113.10", "student@example.com"
    )

    assert row.window_started_at == now
    assert row.attempts == 1

    class FailingTransaction:
        async def __aenter__(self) -> Any:
            raise IntegrityError("statement", {}, Exception("conflict"))

        async def __aexit__(self, *args: object) -> bool:
            return False

    failing_database = MagicMock()
    failing_database.transaction.return_value = FailingTransaction()
    monkeypatch.setattr(rate_limits_module, "range", lambda _length: (0, 1), raising=False)
    login_limiter = DatabaseLoginRateLimiter(cast(Any, failing_database))

    await DatabaseRegistrationRateLimiter(cast(Any, failing_database)).check(
        "203.0.113.10", "student@example.com"
    )
    with pytest.raises(RuntimeError, match="retry exhausted"):
        await login_limiter._reserve_failure_slot("203.0.113.10", "student@example.com")
    await login_limiter._finish_failure_slot(
        "203.0.113.10", "student@example.com", "reservation", failed=True, reset_failures=False
    )


async def _create_rate_limit_schema(database: Database) -> None:
    async with database.transaction() as session:
        await session.run_sync(
            lambda sync_session: Base.metadata.create_all(sync_session.connection())
        )


async def _rate_limit_rows(database: Database) -> list[AuthenticationRateLimit]:
    async with database.transaction() as session:
        return list(await session.scalars(select(AuthenticationRateLimit)))


@pytest.mark.anyio
async def test_expired_rows_are_pruned_in_bounded_throttled_batches() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    current_time = datetime(2026, 7, 28, 12, tzinfo=UTC)
    try:
        await _create_rate_limit_schema(database)
        async with database.transaction() as session:
            for index in range(7):
                session.add(
                    AuthenticationRateLimit(
                        action="registration",
                        key_hash=f"{index:064x}",
                        window_started_at=current_time - timedelta(hours=1, minutes=index),
                        attempts=1,
                    )
                )
        limiter = DatabaseRegistrationRateLimiter(
            database, clock=lambda: current_time, cleanup_batch_size=3
        )

        await limiter.check("203.0.113.10", "first@example.com")
        assert len(await _rate_limit_rows(database)) == 4 + 2

        current_time += timedelta(seconds=30)
        await limiter.check("203.0.113.11", "second@example.com")
        assert len(await _rate_limit_rows(database)) == 4 + 4

        current_time += timedelta(seconds=30)
        await limiter.check("203.0.113.12", "third@example.com")
        rows = await _rate_limit_rows(database)
        assert len(rows) == 1 + 6
        remaining_expired = [
            row
            for row in rows
            if row.window_started_at.replace(tzinfo=UTC) <= current_time - timedelta(hours=1)
        ]
        assert len(remaining_expired) == 1
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_cleanup_failure_does_not_block_the_rate_limit_check(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from contextlib import asynccontextmanager

    from sqlalchemy.exc import OperationalError

    import studyflow.auth.rate_limits as rate_limits_module

    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    try:
        await _create_rate_limit_schema(database)
        original_transaction = database.transaction
        calls = 0

        @asynccontextmanager
        async def first_transaction_fails() -> AsyncIterator[AsyncSession]:
            nonlocal calls
            calls += 1
            if calls == 1:
                raise OperationalError("DELETE", {}, Exception("lock timeout"))
            async with original_transaction() as session:
                yield session

        database.transaction = first_transaction_fails  # type: ignore[method-assign]
        limiter = DatabaseRegistrationRateLimiter(database)

        logger = MagicMock()
        monkeypatch.setattr(rate_limits_module, "logger", logger)

        await limiter.check("203.0.113.10", "student@example.com")

        logger.warning.assert_called_once()
        assert "Rate-limit cleanup failed" in logger.warning.call_args.args[0]
        database.transaction = original_transaction  # type: ignore[method-assign]
        assert len(await _rate_limit_rows(database)) == 2
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_postgresql_cleanup_skips_locked_rows_and_is_bounded() -> None:
    from contextlib import asynccontextmanager

    from sqlalchemy.dialects.postgresql.base import PGDialect

    session = MagicMock()
    session.execute = AsyncMock()

    @asynccontextmanager
    async def transaction() -> AsyncIterator[Any]:
        yield session

    database = MagicMock()
    database.transaction = transaction
    limiter = DatabaseRegistrationRateLimiter(database, cleanup_batch_size=7)

    await limiter._prune_expired(datetime(2026, 7, 28, tzinfo=UTC))

    session.execute.assert_awaited_once()
    compiled = session.execute.call_args.args[0].compile(dialect=cast(Any, PGDialect)())
    statement = str(compiled)
    assert statement.startswith("DELETE FROM authentication_rate_limits")
    assert "LIMIT" in statement
    assert "FOR UPDATE SKIP LOCKED" in statement
    assert 7 in compiled.params.values()


@pytest.mark.parametrize(
    ("failure_attempts", "email_failure_attempts"),
    ((5, -1), (5, 0), (5, 4), (0, 0), (7, 5)),
)
def test_login_limiter_rejects_invalid_email_failure_budget(
    failure_attempts: int, email_failure_attempts: int
) -> None:
    with pytest.raises(ValueError, match="email_failure_attempts"):
        DatabaseLoginRateLimiter(
            Database("sqlite+aiosqlite:///:memory:"),
            failure_attempts=failure_attempts,
            email_failure_attempts=email_failure_attempts,
        )


@pytest.mark.anyio
async def test_password_reset_clears_only_completing_clients_failure_budgets() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    try:
        await _create_rate_limit_schema(database)
        limiter = DatabaseLoginRateLimiter(database, email_failure_attempts=10)
        email = "student@example.com"
        other_ip = "198.51.100.7"
        for client_ip in (CLIENT_IP, other_ip):
            for _ in range(5):
                reservation_id = await limiter.check(client_ip, email)
                await limiter.record_failure(client_ip, email, reservation_id)
        with pytest.raises(LoginRateLimitExceeded):
            await limiter.check("198.51.100.8", email)
        traffic_before = {
            row.key_hash: row.attempts
            for row in await _rate_limit_rows(database)
            if row.action == "login_traffic"
        }

        await limiter.clear_failures(CLIENT_IP, "Student@Example.com")

        rows = await _rate_limit_rows(database)
        failures = [row for row in rows if row.action == "login_failure"]
        assert len(failures) == 1
        assert failures[0].key_hash == limiter._hash_key(f"email_ip:{email}|{other_ip}")
        assert failures[0].attempts == 5
        assert {
            row.key_hash: row.attempts for row in rows if row.action == "login_traffic"
        } == traffic_before
        reservation_id = await limiter.check(CLIENT_IP, email)
        await limiter.release(CLIENT_IP, email, reservation_id)
        with pytest.raises(LoginRateLimitExceeded):
            await limiter.check(other_ip, email)
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_ipv6_rotation_within_a_subnet_shares_the_login_failure_budget() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    try:
        await _create_rate_limit_schema(database)
        limiter = DatabaseLoginRateLimiter(database)
        email = "student@example.com"
        for suffix in range(1, 6):
            client_ip = f"2001:db8:abcd:1234::{suffix}"
            reservation_id = await limiter.check(client_ip, email)
            await limiter.record_failure(client_ip, email, reservation_id)
        with pytest.raises(LoginRateLimitExceeded):
            await limiter.check("2001:0db8:abcd:1234:ffff:ffff:ffff:ffff", email)
        reservation_id = await limiter.check("2001:db8:abcd:1235::1", email)
        await limiter.release("2001:db8:abcd:1235::1", email, reservation_id)
        await limiter.clear_failures("2001:db8:abcd:1234::99", email)
        reservation_id = await limiter.check("2001:db8:abcd:1234::100", email)
        await limiter.release("2001:db8:abcd:1234::100", email, reservation_id)
    finally:
        await database.stop()


@pytest.mark.parametrize("client_ip", (CLIENT_IP, "::ffff:203.0.113.10", "testclient"))
def test_login_budget_preserves_ipv4_mapped_and_non_ip_keys(client_ip: str) -> None:
    limiter = DatabaseLoginRateLimiter(Database("sqlite+aiosqlite:///:memory:"))
    assert (
        limiter._hash_key(f"email_ip:student@example.com|{client_ip}"),
        5,
    ) in limiter._failure_budgets(client_ip, "Student@Example.com")


@pytest.mark.anyio
async def test_ipv6_login_traffic_caps_keep_the_full_client_address() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    try:
        await _create_rate_limit_schema(database)
        limiter = DatabaseLoginRateLimiter(database, traffic_attempts=1)
        email = "student@example.com"
        for client_ip in ("2001:db8::1", "2001:db8::2"):
            reservation_id = await limiter.check(client_ip, email)
            await limiter.release(client_ip, email, reservation_id)
        await limiter.clear_failures("2001:db8::1", email)
        with pytest.raises(LoginRateLimitExceeded):
            await limiter.check("2001:db8::1", email)
    finally:
        await database.stop()
