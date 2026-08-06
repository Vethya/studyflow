"""Server-managed session authentication boundary."""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Protocol
from uuid import UUID


@dataclass(frozen=True, slots=True)
class SessionPrincipal:
    account_id: UUID
    email: str
    name: str


class SessionAuthentication(Protocol):
    async def authenticate(self, session_token: str) -> SessionPrincipal | None: ...

    async def revoke(self, session_token: str, csrf_token: str) -> bool: ...


@dataclass(frozen=True, slots=True)
class PersistedSessionPrincipal:
    account_id: UUID
    email: str
    name: str


class SessionAuthenticationRepository(Protocol):
    async def authenticate(
        self,
        token_hash: str,
        now: datetime,
        refreshed_idle_expiry: datetime,
    ) -> PersistedSessionPrincipal | None: ...

    async def revoke(self, token_hash: str, csrf_hash: str, now: datetime) -> bool: ...


def hash_browser_token(token: str) -> str:
    import hashlib

    return hashlib.sha256(token.encode()).hexdigest()


class SessionAuthenticationService:
    def __init__(
        self,
        repository: SessionAuthenticationRepository,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self._repository = repository
        self._clock = clock

    async def authenticate(self, session_token: str) -> SessionPrincipal | None:
        now = self._clock()
        persisted = await self._repository.authenticate(
            hash_browser_token(session_token), now, now + timedelta(hours=24)
        )
        if persisted is None:
            return None
        return SessionPrincipal(persisted.account_id, persisted.email, persisted.name)

    async def revoke(self, session_token: str, csrf_token: str) -> bool:
        return await self._repository.revoke(
            hash_browser_token(session_token),
            hash_browser_token(csrf_token),
            self._clock(),
        )
