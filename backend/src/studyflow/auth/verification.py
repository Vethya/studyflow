"""Email verification application boundary."""

from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Protocol

from studyflow.auth.registration import generate_verification_token, hash_verification_token


class EmailVerification(Protocol):
    async def verify(self, token: str) -> str | None: ...


class EmailVerificationRepository(Protocol):
    async def grant_signup(
        self,
        token_hash: str,
        signup_token_hash: str,
        now: datetime,
        signup_expires_at: datetime,
    ) -> bool: ...


class EmailVerificationService:
    def __init__(
        self,
        repository: EmailVerificationRepository,
        token_factory: Callable[[], str] = generate_verification_token,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self._repository = repository
        self._token_factory = token_factory
        self._clock = clock

    async def verify(self, token: str) -> str | None:
        now = self._clock()
        signup_token = self._token_factory()
        granted = await self._repository.grant_signup(
            hash_verification_token(token),
            hash_verification_token(signup_token),
            now,
            now + timedelta(minutes=30),
        )
        return signup_token if granted else None
