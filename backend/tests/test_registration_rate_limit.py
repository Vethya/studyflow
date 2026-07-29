from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from studyflow.auth.rate_limits import (
    DatabaseEmailVerificationRateLimiter,
    DatabaseRegistrationRateLimiter,
    EmailVerificationRateLimitExceeded,
    RegistrationRateLimitExceeded,
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
