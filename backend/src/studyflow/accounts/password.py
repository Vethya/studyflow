"""Authenticated password-change boundary."""

from collections.abc import Callable
from datetime import UTC, datetime
from typing import Protocol
from uuid import UUID


class InvalidCurrentPasswordError(ValueError):
    """Raised when an account has no password or its current password is wrong."""


class PasswordChangeRepository(Protocol):
    async def get_password_hash(self, account_id: UUID) -> str | None: ...

    async def replace_password(
        self,
        account_id: UUID,
        expected_password_hash: str,
        new_password_hash: str,
        now: datetime,
    ) -> bool: ...


class PasswordOperations(Protocol):
    async def verify_password(self, password: str, password_hash: str) -> bool: ...

    async def hash_password(self, password: str) -> str: ...


class AccountPasswords(Protocol):
    async def change(self, account_id: UUID, current_password: str, new_password: str) -> None: ...


class PasswordChangeService:
    def __init__(
        self,
        repository: PasswordChangeRepository,
        passwords: PasswordOperations,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self._repository = repository
        self._passwords = passwords
        self._clock = clock

    async def change(self, account_id: UUID, current_password: str, new_password: str) -> None:
        current_hash = await self._repository.get_password_hash(account_id)
        if current_hash is None or not await self._passwords.verify_password(
            current_password, current_hash
        ):
            raise InvalidCurrentPasswordError
        new_hash = await self._passwords.hash_password(new_password)
        if not await self._repository.replace_password(
            account_id, current_hash, new_hash, self._clock()
        ):
            raise InvalidCurrentPasswordError
