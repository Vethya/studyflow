from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

import pytest

from studyflow.auth.recovery import InvalidPasswordResetTokenError, PasswordRecoveryService
from studyflow.auth.registration import DeferredTasks


@dataclass
class RecoveryRepositoryStub:
    eligible: bool = True
    requests: list[tuple[str, str, datetime]] = field(default_factory=list)

    async def create_reset_token(self, email: str, token_hash: str, expires_at: datetime) -> bool:
        self.requests.append((email, token_hash, expires_at))
        return self.eligible

    async def reset_password(self, token_hash: str, password_hash: str, now: datetime) -> bool:
        return False


@dataclass
class PasswordHasherStub:
    hashes: list[str] = field(default_factory=list)

    async def hash_password(self, password: str) -> str:
        self.hashes.append(password)
        return "$argon2id$new-hash"


@dataclass
class RecoveryEmailSenderStub:
    async def send_password_reset(self, email: str, token: str) -> None:
        return None


@dataclass
class DeferredTasksStub(DeferredTasks):
    calls: list[tuple[object, tuple[object, ...]]] = field(default_factory=list)

    def add_task(self, function: object, *arguments: object) -> None:
        self.calls.append((function, arguments))


@pytest.mark.anyio
async def test_password_recovery_request_creates_one_hour_token_and_defers_email() -> None:
    now = datetime(2026, 7, 29, 12, tzinfo=UTC)
    repository = RecoveryRepositoryStub()
    sender = RecoveryEmailSenderStub()
    deferred = DeferredTasksStub()
    service = PasswordRecoveryService(
        repository,
        sender,
        passwords=PasswordHasherStub(),
        token_factory=lambda: "single-use-reset-token",
        clock=lambda: now,
    )

    await service.request_reset(" STUDENT@example.com ", deferred)

    assert repository.requests[0][0] == "student@example.com"
    assert len(repository.requests[0][1]) == 64
    assert repository.requests[0][2] == now + timedelta(hours=1)
    assert deferred.calls == [
        (sender.send_password_reset, ("student@example.com", "single-use-reset-token"))
    ]

    repository.eligible = False
    await service.request_reset("missing@example.com", deferred)
    assert len(deferred.calls) == 1


@pytest.mark.anyio
async def test_password_reset_hashes_password_and_rejects_invalid_token() -> None:
    now = datetime(2026, 7, 29, 12, tzinfo=UTC)
    repository = RecoveryRepositoryStub()
    passwords = PasswordHasherStub()
    service = PasswordRecoveryService(
        repository, RecoveryEmailSenderStub(), passwords=passwords, clock=lambda: now
    )

    with pytest.raises(InvalidPasswordResetTokenError):
        await service.reset_password("invalid-reset-token", "a-new-secure-password")

    assert passwords.hashes == ["a-new-secure-password"]
