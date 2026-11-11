from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from unittest.mock import Mock

import pytest

from studyflow.auth.recovery import InvalidPasswordResetTokenError, PasswordRecoveryService
from studyflow.auth.registration import DeferredTasks


@dataclass
class RecoveryRepositoryStub:
    timezone: str | None = "Asia/Phnom_Penh"
    requests: list[tuple[str, str, datetime]] = field(default_factory=list)

    async def create_reset_token(
        self, email: str, token_hash: str, expires_at: datetime
    ) -> str | None:
        self.requests.append((email, token_hash, expires_at))
        return self.timezone

    async def reset_password(
        self, token_hash: str, password_hash: str, now: datetime
    ) -> str | None:
        return None


@dataclass
class PasswordHasherStub:
    hashes: list[str] = field(default_factory=list)

    async def hash_password(self, password: str) -> str:
        self.hashes.append(password)
        return "$argon2id$new-hash"


@dataclass
class RecoveryEmailSenderStub:
    async def send_password_reset(
        self, email: str, token: str, requested_at: datetime, timezone: str
    ) -> None:
        return None


@dataclass
class DeferredTasksStub(DeferredTasks):
    calls: list[tuple[object, tuple[object, ...]]] = field(default_factory=list)

    def add_task(self, function: object, *arguments: object) -> None:
        self.calls.append((function, arguments))


@pytest.mark.anyio
async def test_password_recovery_request_creates_one_hour_token_and_defers_email() -> None:
    now = datetime(2026, 7, 29, 12, tzinfo=UTC)
    clock = Mock(return_value=now)
    repository = RecoveryRepositoryStub()
    sender = RecoveryEmailSenderStub()
    deferred = DeferredTasksStub()
    service = PasswordRecoveryService(
        repository,
        sender,
        passwords=PasswordHasherStub(),
        token_factory=lambda: "single-use-reset-token",
        clock=clock,
    )

    await service.request_reset(" STUDENT@example.com ", deferred)

    assert repository.requests[0][0] == "student@example.com"
    assert len(repository.requests[0][1]) == 64
    assert repository.requests[0][2] == now + timedelta(hours=1)
    clock.assert_called_once_with()
    assert deferred.calls == [
        (
            sender.send_password_reset,
            ("student@example.com", "single-use-reset-token", now, "Asia/Phnom_Penh"),
        )
    ]

    repository.timezone = None
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


@pytest.mark.anyio
async def test_password_reset_succeeds_when_token_is_valid() -> None:
    now = datetime(2026, 7, 29, 12, tzinfo=UTC)

    class ValidRecoveryRepositoryStub(RecoveryRepositoryStub):
        async def reset_password(
            self, token_hash: str, password_hash: str, now: datetime
        ) -> str | None:
            return "student@example.com"

    repository = ValidRecoveryRepositoryStub()
    passwords = PasswordHasherStub()
    service = PasswordRecoveryService(
        repository, RecoveryEmailSenderStub(), passwords=passwords, clock=lambda: now
    )

    assert (
        await service.reset_password("valid-reset-token", "a-new-secure-password")
        == "student@example.com"
    )
    assert passwords.hashes == ["a-new-secure-password"]
