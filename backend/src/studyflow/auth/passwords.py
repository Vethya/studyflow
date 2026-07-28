"""Password validation and Argon2id hashing."""

import anyio
from argon2 import PasswordHasher, Type
from argon2.exceptions import InvalidHashError, VerificationError

from studyflow.auth.breached_passwords import BreachedPasswordChecker

ARGON2_TIME_COST = 2
ARGON2_MEMORY_COST_KIB = 19_456
ARGON2_PARALLELISM = 1


class PasswordPolicyError(ValueError):
    """Raised when a proposed password violates the account policy."""


class BreachedPasswordError(PasswordPolicyError):
    """Raised when a proposed password appears in a known breach."""


class _PasswordHasher:
    """Internal password validation and Argon2id implementation."""

    def __init__(self) -> None:
        self._hasher = PasswordHasher(
            time_cost=ARGON2_TIME_COST,
            memory_cost=ARGON2_MEMORY_COST_KIB,
            parallelism=ARGON2_PARALLELISM,
            hash_len=32,
            salt_len=16,
            type=Type.ID,
        )

    def validate_password(self, password: str) -> None:
        if len(password) < 12:
            raise PasswordPolicyError("Password must be at least 12 characters")
        if len(password) > 128:
            raise PasswordPolicyError("Password must be at most 128 characters")

    def hash_password(self, password: str) -> str:
        self.validate_password(password)
        return self._hasher.hash(password)

    def verify_password(self, password: str, password_hash: str) -> bool:
        try:
            return self._hasher.verify(password_hash, password)
        except (InvalidHashError, VerificationError):
            return False


class PasswordService:
    """The sole public boundary for setting and verifying account passwords."""

    def __init__(self, breached_passwords: BreachedPasswordChecker) -> None:
        self._hasher = _PasswordHasher()
        self._breached_passwords = breached_passwords

    async def hash_password(self, password: str) -> str:
        self._hasher.validate_password(password)
        if await self._breached_passwords.is_breached(password):
            raise BreachedPasswordError("Password appears in a known breach")
        return await anyio.to_thread.run_sync(self._hasher.hash_password, password)

    async def verify_password(self, password: str, password_hash: str) -> bool:
        return await anyio.to_thread.run_sync(
            self._hasher.verify_password,
            password,
            password_hash,
        )
