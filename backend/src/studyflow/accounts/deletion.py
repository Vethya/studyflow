"""Authenticated account deletion."""

import secrets
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Protocol
from uuid import UUID

from studyflow.accounts.password import InvalidCurrentPasswordError


class AccountDeletionRepository(Protocol):
    async def create_challenge(
        self, account_id: UUID, token_hash: str, expires_at: datetime
    ) -> bool: ...

    async def delete_account(
        self, account_id: UUID, token_hash: str, now: datetime
    ) -> bool: ...


class AccountPasswordVerifier(Protocol):
    async def verify_current(self, account_id: UUID, current_password: str) -> bool: ...


class AccountDeletion(Protocol):
    async def prepare_with_password(self, account_id: UUID, password: str) -> str: ...

    async def confirm(self, account_id: UUID, challenge: str) -> bool: ...


class AccountDeletionService:
    def __init__(
        self,
        repository: AccountDeletionRepository,
        passwords: AccountPasswordVerifier,
        token_factory: Callable[[], str] = lambda: secrets.token_urlsafe(32),
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self._repository = repository
        self._passwords = passwords
        self._token_factory = token_factory
        self._clock = clock

    async def prepare_with_password(self, account_id: UUID, password: str) -> str:
        if not await self._passwords.verify_current(account_id, password):
            raise InvalidCurrentPasswordError
        return await self._create_challenge(account_id)

    async def confirm(self, account_id: UUID, challenge: str) -> bool:
        return await self._repository.delete_account(
            account_id,
            _hash_challenge(challenge),
            self._clock(),
        )

    async def _create_challenge(self, account_id: UUID) -> str:
        challenge = self._token_factory()
        created = await self._repository.create_challenge(
            account_id,
            _hash_challenge(challenge),
            self._clock() + timedelta(minutes=10),
        )
        if not created:
            raise InvalidCurrentPasswordError
        return challenge


def _hash_challenge(challenge: str) -> str:
    import hashlib

    return hashlib.sha256(challenge.encode()).hexdigest()
