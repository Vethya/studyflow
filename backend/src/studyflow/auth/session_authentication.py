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
    avatar_url: str | None = None


class SessionAuthentication(Protocol):
    async def authenticate(
        self, session_token: str, csrf_token: str | None = None
    ) -> SessionPrincipal | None: ...

    async def revoke(self, session_token: str, csrf_token: str) -> bool: ...


@dataclass(frozen=True, slots=True)
class PersistedSessionPrincipal:
    account_id: UUID
    email: str
    name: str
    avatar_url: str | None = None


class SessionAuthenticationRepository(Protocol):
    async def authenticate(
        self,
        token_hash: str,
        now: datetime,
        refreshed_idle_expiry: datetime,
        csrf_hash: str | None = None,
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

    async def authenticate(
        self, session_token: str, csrf_token: str | None = None
    ) -> SessionPrincipal | None:
        now = self._clock()
        persisted = await self._repository.authenticate(
            hash_browser_token(session_token),
            now,
            now + timedelta(hours=24),
            hash_browser_token(csrf_token) if csrf_token is not None else None,
        )
        if persisted is None:
            return None
        return SessionPrincipal(
            persisted.account_id, persisted.email, persisted.name, persisted.avatar_url
        )

    async def authenticate_read_only(self, session_token: str) -> SessionPrincipal | None:
        now = self._clock()
        authenticate_read_only = getattr(self._repository, "authenticate_read_only", None)
        if authenticate_read_only is None:
            return await self.authenticate(session_token)
        persisted = await authenticate_read_only(hash_browser_token(session_token), now)
        if persisted is None:
            return None
        return SessionPrincipal(
            persisted.account_id, persisted.email, persisted.name, persisted.avatar_url
        )

    async def revoke(self, session_token: str, csrf_token: str) -> bool:
        return await self._repository.revoke(
            hash_browser_token(session_token),
            hash_browser_token(csrf_token),
            self._clock(),
        )
