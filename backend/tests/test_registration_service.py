from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from studyflow.auth.passwords import PasswordService
from studyflow.auth.registration import (
    PendingRegistration,
    RegistrationCommand,
    RegistrationCompletion,
    RegistrationService,
)


class SafePasswordStub:
    checks: int = 0

    async def is_breached(self, password: str) -> bool:
        self.checks += 1
        return False


@dataclass
class RegistrationRepositoryStub:
    pending: list[PendingRegistration] = field(default_factory=list)
    completions: list[RegistrationCompletion] = field(default_factory=list)
    created: bool = True

    async def begin(self, registration: PendingRegistration) -> bool:
        self.pending.append(registration)
        return self.created

    async def signup_is_valid(self, signup_token_hash: str, now: datetime) -> bool:
        return self.created

    async def complete(self, completion: RegistrationCompletion, now: datetime) -> bool:
        self.completions.append(completion)
        return self.created


@dataclass
class AuthenticationEmailStub:
    deliveries: list[tuple[str, str]] = field(default_factory=list)

    async def send_verification(self, email: str, token: str) -> None:
        self.deliveries.append((email, token))


@dataclass
class DeferredTasksStub:
    tasks: list[tuple[Any, tuple[object, ...]]] = field(default_factory=list)

    def add_task(self, function: Any, *arguments: object) -> None:
        self.tasks.append((function, arguments))

    async def run(self) -> None:
        for function, arguments in self.tasks:
            await function(*arguments)


@pytest.mark.anyio
async def test_registration_stores_only_email_and_verification_challenge() -> None:
    now = datetime(2026, 7, 28, 12, tzinfo=UTC)
    repository = RegistrationRepositoryStub()
    email_sender = AuthenticationEmailStub()
    deferred_tasks = DeferredTasksStub()
    service = RegistrationService(
        repository=repository,
        passwords=PasswordService(SafePasswordStub()),
        email_sender=email_sender,
        token_factory=lambda: "verification-secret",
        clock=lambda: now,
    )

    await service.register(RegistrationCommand(email=" Student@Example.COM "), deferred_tasks)

    [pending] = repository.pending
    assert pending.email == "student@example.com"
    assert pending.verification_token_hash != "verification-secret"
    assert pending.verification_expires_at == now + timedelta(hours=8)
    assert not hasattr(pending, "password_hash")
    assert not hasattr(pending, "name")
    await deferred_tasks.run()
    assert email_sender.deliveries == [("student@example.com", "verification-secret")]


@pytest.mark.anyio
async def test_completion_hashes_password_and_uses_verified_signup_token() -> None:
    now = datetime(2026, 7, 28, 12, tzinfo=UTC)
    repository = RegistrationRepositoryStub()
    service = RegistrationService(
        repository=repository,
        passwords=PasswordService(SafePasswordStub()),
        email_sender=AuthenticationEmailStub(),
        clock=lambda: now,
    )

    assert await service.complete(
        signup_token="verified-signup-token",
        name="  Student Name  ",
        password="correct horse battery staple",
        timezone="Asia/Phnom_Penh",
    )

    [completion] = repository.completions
    assert completion.signup_token_hash != "verified-signup-token"
    assert completion.name == "Student Name"
    assert completion.password_hash.startswith("$argon2id$")
    assert completion.timezone == "Asia/Phnom_Penh"


@pytest.mark.anyio
async def test_existing_account_does_not_receive_a_verification_email() -> None:
    repository = RegistrationRepositoryStub(created=False)
    deferred_tasks = DeferredTasksStub()
    service = RegistrationService(
        repository=repository,
        passwords=PasswordService(SafePasswordStub()),
        email_sender=AuthenticationEmailStub(),
    )

    await service.register(RegistrationCommand(email="student@example.com"), deferred_tasks)

    assert deferred_tasks.tasks == []


@pytest.mark.anyio
async def test_invalid_signup_token_is_rejected_before_password_security_work() -> None:
    repository = RegistrationRepositoryStub(created=False)
    breach_check = SafePasswordStub()
    service = RegistrationService(
        repository=repository,
        passwords=PasswordService(breach_check),
        email_sender=AuthenticationEmailStub(),
    )

    assert not await service.complete(
        signup_token="invalid-signup-token",
        name="Student",
        password="correct horse battery staple",
        timezone="UTC",
    )
    assert breach_check.checks == 0
    assert repository.completions == []
