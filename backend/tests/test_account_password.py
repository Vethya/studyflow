from dataclasses import dataclass, field
from datetime import UTC, datetime
from uuid import UUID

import pytest

from studyflow.accounts.password import InvalidCurrentPasswordError, PasswordChangeService


@dataclass
class RepositoryStub:
    password_hash: str | None = "$argon2id$current"
    replaced: bool = True
    changes: list[tuple[UUID, str, str, datetime]] = field(default_factory=list)

    async def get_password_hash(self, account_id: UUID) -> str | None:
        return self.password_hash

    async def replace_password(
        self,
        account_id: UUID,
        expected_password_hash: str,
        new_password_hash: str,
        now: datetime,
    ) -> bool:
        self.changes.append((account_id, expected_password_hash, new_password_hash, now))
        return self.replaced


@dataclass
class PasswordsStub:
    valid: bool = True

    async def verify_password(self, password: str, password_hash: str) -> bool:
        return self.valid

    async def hash_password(self, password: str) -> str:
        return "$argon2id$new"


@pytest.mark.anyio
async def test_password_change_verifies_current_then_atomically_replaces() -> None:
    account_id = UUID("5b15bfef-8c44-45d5-a70e-574beb999fb3")
    now = datetime(2026, 7, 29, 12, tzinfo=UTC)
    repository = RepositoryStub()
    service = PasswordChangeService(repository, PasswordsStub(), clock=lambda: now)

    await service.change(account_id, "current-password", "new-secure-password")

    assert repository.changes == [(account_id, "$argon2id$current", "$argon2id$new", now)]


@pytest.mark.anyio
async def test_password_change_rejects_wrong_or_missing_current_password() -> None:
    account_id = UUID("5b15bfef-8c44-45d5-a70e-574beb999fb3")
    for repository, passwords, expected_change_attempts in (
        (RepositoryStub(password_hash=None), PasswordsStub(), 0),
        (RepositoryStub(), PasswordsStub(valid=False), 0),
        (RepositoryStub(replaced=False), PasswordsStub(), 1),
    ):
        with pytest.raises(InvalidCurrentPasswordError):
            await PasswordChangeService(repository, passwords).change(
                account_id, "wrong-password", "new-secure-password"
            )
        assert len(repository.changes) == expected_change_attempts
