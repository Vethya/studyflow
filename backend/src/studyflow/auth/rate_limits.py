"""Durable abuse control for authentication endpoints."""

import hashlib
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Protocol

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError

from studyflow.auth.email import canonicalize_email
from studyflow.auth.repositories import SessionTransactions
from studyflow.database.models import AuthenticationRateLimit


class RegistrationRateLimitExceeded(RuntimeError):
    """Raised when an IP address or email exceeds the registration window."""


class EmailVerificationRateLimitExceeded(RuntimeError):
    """Raised when an IP address or token exceeds the verification window."""


class LoginRateLimitExceeded(RuntimeError):
    """Raised when an IP address or email exceeds the login window."""


class VerificationResendRateLimitExceeded(RuntimeError):
    """Raised when verification resend exceeds its window."""


class PasswordResetRequestRateLimitExceeded(RuntimeError):
    """Raised when password-reset requests exceed their window."""


class PasswordResetAttemptRateLimitExceeded(RuntimeError):
    """Raised when password-reset attempts exceed their window."""


class AccountPasswordChangeRateLimitExceeded(RuntimeError):
    """Raised when current-password checks exceed their window."""


class OIDCStartRateLimitExceeded(RuntimeError):
    """Raised when an IP address creates too many OIDC states."""


class OIDCLinkRateLimitExceeded(RuntimeError):
    """Raised when Google account-link confirmation is attempted too often."""


class RegistrationRateLimit(Protocol):
    async def check(self, client_ip: str, email: str) -> None: ...


class EmailVerificationRateLimit(Protocol):
    async def check(self, client_ip: str, token: str) -> None: ...


class LoginRateLimit(Protocol):
    async def check(self, client_ip: str, email: str) -> None: ...

    async def record_failure(self, email: str) -> None: ...

    async def reset_failures(self, email: str) -> None: ...

    async def release(self, email: str) -> None: ...


class VerificationResendRateLimit(Protocol):
    async def check(self, client_ip: str, email: str) -> None: ...


class PasswordResetRequestRateLimit(Protocol):
    async def check(self, client_ip: str, email: str) -> None: ...


class PasswordResetAttemptRateLimit(Protocol):
    async def check(self, client_ip: str, token: str) -> None: ...


class AccountPasswordChangeRateLimit(Protocol):
    async def check(self, client_ip: str, account_id: str) -> None: ...


class OIDCStartRateLimit(Protocol):
    async def check(self, client_ip: str) -> None: ...


class OIDCLinkRateLimit(Protocol):
    async def check(self, client_ip: str, account_key: str) -> None: ...


class _DatabaseRateLimiter:
    def __init__(
        self,
        database: SessionTransactions,
        *,
        maximum_attempts: int = 5,
        window_seconds: int = 900,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self._database = database
        self._maximum_attempts = maximum_attempts
        self._window = timedelta(seconds=window_seconds)
        self._clock = clock

    async def _check(
        self,
        action: str,
        key_values: tuple[str, ...],
        exceeded: type[RuntimeError],
    ) -> None:
        now = self._clock()
        keys = tuple(self._hash_key(value) for value in key_values)
        for attempt in range(3):
            try:
                async with self._database.transaction() as session:
                    await session.execute(
                        delete(AuthenticationRateLimit).where(
                            AuthenticationRateLimit.window_started_at <= now - self._window
                        )
                    )
                    rows = {
                        row.key_hash: row
                        for row in await session.scalars(
                            select(AuthenticationRateLimit)
                            .where(
                                AuthenticationRateLimit.action == action,
                                AuthenticationRateLimit.key_hash.in_(keys),
                            )
                            .with_for_update()
                        )
                    }
                    for key in keys:
                        row = rows.get(key)
                        if row is None:
                            session.add(
                                AuthenticationRateLimit(
                                    action=action,
                                    key_hash=key,
                                    window_started_at=now,
                                    attempts=1,
                                )
                            )
                            continue
                        window_started_at = row.window_started_at
                        if window_started_at.tzinfo is None:
                            window_started_at = window_started_at.replace(tzinfo=UTC)
                        if now - window_started_at >= self._window:
                            row.window_started_at = now
                            row.attempts = 1
                        elif row.attempts >= self._maximum_attempts:
                            raise exceeded
                        else:
                            row.attempts += 1
                    await session.flush()
                return
            except IntegrityError:
                if attempt == 2:
                    raise

    @staticmethod
    def _hash_key(value: str) -> str:
        return hashlib.sha256(value.encode()).hexdigest()


class DatabaseRegistrationRateLimiter(_DatabaseRateLimiter):
    async def check(self, client_ip: str, email: str) -> None:
        await self._check(
            "registration",
            (f"ip:{client_ip}", f"email:{canonicalize_email(email)}"),
            RegistrationRateLimitExceeded,
        )


class DatabaseEmailVerificationRateLimiter(_DatabaseRateLimiter):
    async def check(self, client_ip: str, token: str) -> None:
        await self._check(
            "email_verification",
            (f"ip:{client_ip}", f"token:{token}"),
            EmailVerificationRateLimitExceeded,
        )


class DatabaseLoginRateLimiter(_DatabaseRateLimiter):
    def __init__(
        self,
        database: SessionTransactions,
        *,
        traffic_attempts: int = 30,
        failure_attempts: int = 5,
        window_seconds: int = 900,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        super().__init__(
            database,
            maximum_attempts=failure_attempts,
            window_seconds=window_seconds,
            clock=clock,
        )
        self._traffic = _DatabaseRateLimiter(
            database,
            maximum_attempts=traffic_attempts,
            window_seconds=window_seconds,
            clock=clock,
        )

    async def check(self, client_ip: str, email: str) -> None:
        await self._traffic._check(
            "login_traffic",
            (f"ip:{client_ip}",),
            LoginRateLimitExceeded,
        )
        await self._reserve_failure_slot(email)

    async def record_failure(self, email: str) -> None:
        await self._finish_failure_slot(email, failed=True, reset_failures=False)

    async def reset_failures(self, email: str) -> None:
        await self._finish_failure_slot(email, failed=False, reset_failures=True)

    async def release(self, email: str) -> None:
        await self._finish_failure_slot(email, failed=False, reset_failures=False)

    async def _reserve_failure_slot(self, email: str) -> None:
        now = self._clock()
        key_hash = self._hash_key(f"email:{canonicalize_email(email)}")
        actions = ("login_failure", "login_inflight")
        for attempt in range(3):
            try:
                async with self._database.transaction() as session:
                    rows = {
                        row.action: row
                        for row in await session.scalars(
                            select(AuthenticationRateLimit)
                            .where(
                                AuthenticationRateLimit.action.in_(actions),
                                AuthenticationRateLimit.key_hash == key_hash,
                            )
                            .with_for_update()
                        )
                    }
                    for action, row in tuple(rows.items()):
                        if self._is_expired(row, now):
                            await session.delete(row)
                            del rows[action]
                    failures = rows.get("login_failure")
                    inflight = rows.get("login_inflight")
                    if (failures.attempts if failures is not None else 0) + (
                        inflight.attempts if inflight is not None else 0
                    ) >= self._maximum_attempts:
                        raise LoginRateLimitExceeded
                    if inflight is None:
                        session.add(
                            AuthenticationRateLimit(
                                action="login_inflight",
                                key_hash=key_hash,
                                window_started_at=now,
                                attempts=1,
                            )
                        )
                    else:
                        inflight.attempts += 1
                    await session.flush()
                return
            except IntegrityError:
                if attempt == 2:
                    raise

    async def _finish_failure_slot(
        self,
        email: str,
        *,
        failed: bool,
        reset_failures: bool,
    ) -> None:
        now = self._clock()
        key_hash = self._hash_key(f"email:{canonicalize_email(email)}")
        async with self._database.transaction() as session:
            rows = {
                row.action: row
                for row in await session.scalars(
                    select(AuthenticationRateLimit)
                    .where(
                        AuthenticationRateLimit.action.in_(("login_failure", "login_inflight")),
                        AuthenticationRateLimit.key_hash == key_hash,
                    )
                    .with_for_update()
                )
            }
            inflight = rows.get("login_inflight")
            if inflight is not None:
                if inflight.attempts == 1:
                    await session.delete(inflight)
                else:
                    inflight.attempts -= 1
            failures = rows.get("login_failure")
            if reset_failures and failures is not None:
                await session.delete(failures)
            elif failed:
                if failures is None or self._is_expired(failures, now):
                    if failures is not None:
                        await session.delete(failures)
                        await session.flush()
                    session.add(
                        AuthenticationRateLimit(
                            action="login_failure",
                            key_hash=key_hash,
                            window_started_at=now,
                            attempts=1,
                        )
                    )
                else:
                    failures.attempts += 1

    def _is_expired(self, row: AuthenticationRateLimit, now: datetime) -> bool:
        window_started_at = row.window_started_at
        if window_started_at.tzinfo is None:
            window_started_at = window_started_at.replace(tzinfo=UTC)
        return now - window_started_at >= self._window


class DatabaseVerificationResendRateLimiter(_DatabaseRateLimiter):
    async def check(self, client_ip: str, email: str) -> None:
        await self._check(
            "verification_resend",
            (f"ip:{client_ip}", f"email:{canonicalize_email(email)}"),
            VerificationResendRateLimitExceeded,
        )


class DatabasePasswordResetRequestRateLimiter(_DatabaseRateLimiter):
    async def check(self, client_ip: str, email: str) -> None:
        await self._check(
            "password_reset_request",
            (f"ip:{client_ip}", f"email:{canonicalize_email(email)}"),
            PasswordResetRequestRateLimitExceeded,
        )


class DatabasePasswordResetAttemptRateLimiter(_DatabaseRateLimiter):
    async def check(self, client_ip: str, token: str) -> None:
        await self._check(
            "password_reset_attempt",
            (f"ip:{client_ip}", f"token:{token}"),
            PasswordResetAttemptRateLimitExceeded,
        )


class DatabaseAccountPasswordChangeRateLimiter(_DatabaseRateLimiter):
    async def check(self, client_ip: str, account_id: str) -> None:
        await self._check(
            "account_password_change",
            (f"ip:{client_ip}", f"account:{account_id}"),
            AccountPasswordChangeRateLimitExceeded,
        )


class DatabaseOIDCStartRateLimiter(_DatabaseRateLimiter):
    async def check(self, client_ip: str) -> None:
        await self._check(
            "oidc_start",
            (f"ip:{client_ip}",),
            OIDCStartRateLimitExceeded,
        )


class DatabaseOIDCLinkRateLimiter(_DatabaseRateLimiter):
    async def check(self, client_ip: str, account_key: str) -> None:
        await self._check(
            "oidc_link",
            (f"ip:{client_ip}", f"account:{account_key}"),
            OIDCLinkRateLimitExceeded,
        )
