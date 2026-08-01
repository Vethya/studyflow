from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from studyflow.auth.passwords import PasswordService
from studyflow.auth.registration import (
    PendingAccount,
    RegistrationCommand,
    RegistrationService,
)


class SafePasswordStub:
    async def is_breached(self, password: str) -> bool:
        return False


@dataclass
class RegistrationRepositoryStub:
    pending_accounts: list[PendingAccount] = field(default_factory=list)
    created: bool = True

    async def create_unverified(self, account: PendingAccount) -> bool:
        self.pending_accounts.append(account)
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
async def test_registration_creates_an_unverified_account_and_eight_hour_token() -> None:
    now = datetime(2026, 7, 28, 12, tzinfo=UTC)
    raw_token = "verification-secret"
    repository = RegistrationRepositoryStub()
    email_sender = AuthenticationEmailStub()
    deferred_tasks = DeferredTasksStub()
    service = RegistrationService(
        repository=repository,
        passwords=PasswordService(SafePasswordStub()),
        email_sender=email_sender,
        token_factory=lambda: raw_token,
        clock=lambda: now,
    )

    await service.register(
        RegistrationCommand(
            email=" Student@Example.COM ",
            name="Student Name",
            password="correct horse battery staple",
            timezone="Asia/Phnom_Penh",
        ),
        deferred_tasks,
    )

    [pending_account] = repository.pending_accounts
    assert pending_account.email == "student@example.com"
    assert pending_account.name == "Student Name"
    assert pending_account.password_hash.startswith("$argon2id$")
    assert pending_account.timezone == "Asia/Phnom_Penh"
    assert pending_account.verification_token_hash != raw_token
    assert pending_account.verification_expires_at == now + timedelta(hours=8)
    assert email_sender.deliveries == []
    await deferred_tasks.run()
    assert email_sender.deliveries == [("student@example.com", raw_token)]


@pytest.mark.anyio
async def test_existing_email_does_not_send_or_disclose_a_verification() -> None:
    repository = RegistrationRepositoryStub(created=False)
    email_sender = AuthenticationEmailStub()
    deferred_tasks = DeferredTasksStub()
    service = RegistrationService(
        repository=repository,
        passwords=PasswordService(SafePasswordStub()),
        email_sender=email_sender,
        token_factory=lambda: "unused-token",
    )

    await service.register(
        RegistrationCommand(
            email="student@example.com",
            name="Student Name",
            password="correct horse battery staple",
            timezone="UTC",
        ),
        deferred_tasks,
    )

    assert email_sender.deliveries == []
    assert deferred_tasks.tasks == []
