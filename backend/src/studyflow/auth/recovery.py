"""Password recovery application boundary."""

from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Protocol

from studyflow.auth.email import canonicalize_email
from studyflow.auth.registration import (
    DeferredTasks,
    generate_verification_token,
    hash_verification_token,
)


class InvalidPasswordResetTokenError(ValueError):
    """Raised when a reset token is invalid, expired, or consumed."""


class PasswordRecoveryRepository(Protocol):
    async def create_reset_token(
        self, email: str, token_hash: str, expires_at: datetime
    ) -> bool: ...

    async def reset_password(self, token_hash: str, password_hash: str, now: datetime) -> bool: ...


class PasswordRecoveryEmailSender(Protocol):
    async def send_password_reset(self, email: str, token: str) -> None: ...


class PasswordHashing(Protocol):
    async def hash_password(self, password: str) -> str: ...


class PasswordRecovery(Protocol):
    async def request_reset(self, email: str, deferred_tasks: DeferredTasks) -> None: ...

    async def reset_password(self, token: str, password: str) -> None: ...


class PasswordRecoveryService:
    def __init__(
        self,
        repository: PasswordRecoveryRepository,
        email_sender: PasswordRecoveryEmailSender,
        passwords: PasswordHashing,
        token_factory: Callable[[], str] = generate_verification_token,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self._repository = repository
        self._email_sender = email_sender
        self._token_factory = token_factory
        self._clock = clock
        self._passwords = passwords

    async def request_reset(self, email: str, deferred_tasks: DeferredTasks) -> None:
        canonical_email = canonicalize_email(email)
        token = self._token_factory()
        if await self._repository.create_reset_token(
            canonical_email,
            hash_verification_token(token),
            self._clock() + timedelta(hours=1),
        ):
            deferred_tasks.add_task(self._email_sender.send_password_reset, canonical_email, token)

    async def reset_password(self, token: str, password: str) -> None:
        password_hash = await self._passwords.hash_password(password)
        if not await self._repository.reset_password(
            hash_verification_token(token), password_hash, self._clock()
        ):
            raise InvalidPasswordResetTokenError
