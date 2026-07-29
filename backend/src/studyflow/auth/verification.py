"""Email verification application boundary."""

from collections.abc import Callable
from datetime import UTC, datetime
from typing import Protocol

from studyflow.auth.registration import hash_verification_token


class EmailVerification(Protocol):
    async def verify(self, token: str) -> bool: ...


class EmailVerificationRepository(Protocol):
    async def consume(self, token_hash: str, now: datetime) -> bool: ...


class EmailVerificationService:
    def __init__(
        self,
        repository: EmailVerificationRepository,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self._repository = repository
        self._clock = clock

    async def verify(self, token: str) -> bool:
        return await self._repository.consume(hash_verification_token(token), self._clock())
