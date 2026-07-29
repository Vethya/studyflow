"""Email-verification resend boundary."""

from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Protocol

from studyflow.auth.email import canonicalize_email
from studyflow.auth.registration import (
    AuthenticationEmailSender,
    DeferredTasks,
    generate_verification_token,
    hash_verification_token,
)


class VerificationResendRepository(Protocol):
    async def rotate(self, email: str, token_hash: str, expires_at: datetime) -> bool: ...


class VerificationResend(Protocol):
    async def resend(self, email: str, deferred_tasks: DeferredTasks) -> None: ...


class VerificationResendService:
    def __init__(
        self,
        repository: VerificationResendRepository,
        email_sender: AuthenticationEmailSender,
        token_factory: Callable[[], str] = generate_verification_token,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self._repository = repository
        self._email_sender = email_sender
        self._token_factory = token_factory
        self._clock = clock

    async def resend(self, email: str, deferred_tasks: DeferredTasks) -> None:
        canonical_email = canonicalize_email(email)
        token = self._token_factory()
        if await self._repository.rotate(
            canonical_email,
            hash_verification_token(token),
            self._clock() + timedelta(hours=8),
        ):
            deferred_tasks.add_task(self._email_sender.send_verification, canonical_email, token)
