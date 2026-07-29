"""Opaque browser-session issuance."""

import hashlib
import secrets
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Protocol
from uuid import UUID


@dataclass(frozen=True, slots=True)
class PendingSession:
    account_id: UUID
    token_hash: str
    csrf_token_hash: str
    idle_expires_at: datetime
    absolute_expires_at: datetime


@dataclass(frozen=True, slots=True)
class SessionCredentials:
    session_token: str
    csrf_token: str


class SessionRepository(Protocol):
    async def create(
        self, session: PendingSession, expected_password_hash: str | None = None
    ) -> bool: ...


def generate_session_token() -> str:
    return secrets.token_urlsafe(32)


def hash_session_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class SessionService:
    def __init__(
        self,
        repository: SessionRepository,
        token_factory: Callable[[], str] = generate_session_token,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self._repository = repository
        self._token_factory = token_factory
        self._clock = clock

    async def create(
        self, account_id: UUID, expected_password_hash: str | None = None
    ) -> SessionCredentials | None:
        session_token = self._token_factory()
        csrf_token = self._token_factory()
        now = self._clock()
        created = await self._repository.create(
            PendingSession(
                account_id=account_id,
                token_hash=hash_session_token(session_token),
                csrf_token_hash=hash_session_token(csrf_token),
                idle_expires_at=now + timedelta(hours=24),
                absolute_expires_at=now + timedelta(days=7),
            ),
            expected_password_hash,
        )
        if not created:
            return None
        return SessionCredentials(session_token=session_token, csrf_token=csrf_token)
