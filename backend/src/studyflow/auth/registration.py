"""Email registration application boundary."""

import hashlib
import secrets
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol

from studyflow.auth.email import canonicalize_email
from studyflow.auth.passwords import PasswordService


@dataclass(frozen=True, slots=True)
class RegistrationCommand:
    email: str


class Registration(Protocol):
    async def register(
        self,
        command: RegistrationCommand,
        deferred_tasks: "DeferredTasks",
    ) -> None: ...

    async def complete(
        self,
        signup_token: str,
        name: str,
        password: str,
        timezone: str,
    ) -> bool: ...


class DeferredTasks(Protocol):
    def add_task(self, function: Any, *arguments: object) -> None: ...


@dataclass(frozen=True, slots=True)
class PendingRegistration:
    email: str
    verification_token_hash: str
    verification_expires_at: datetime
    requested_at: datetime


@dataclass(frozen=True, slots=True)
class RegistrationCompletion:
    signup_token_hash: str
    name: str
    password_hash: str
    timezone: str


class RegistrationRepository(Protocol):
    async def begin(self, registration: PendingRegistration) -> bool: ...

    async def complete(self, completion: RegistrationCompletion, now: datetime) -> bool: ...


class AuthenticationEmailSender(Protocol):
    async def send_verification(self, email: str, token: str) -> None: ...


def generate_verification_token() -> str:
    return secrets.token_urlsafe(32)


def hash_verification_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class RegistrationService:
    def __init__(
        self,
        repository: RegistrationRepository,
        passwords: PasswordService,
        email_sender: AuthenticationEmailSender,
        token_factory: Callable[[], str] = generate_verification_token,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self._repository = repository
        self._passwords = passwords
        self._email_sender = email_sender
        self._token_factory = token_factory
        self._clock = clock

    async def register(
        self,
        command: RegistrationCommand,
        deferred_tasks: DeferredTasks,
    ) -> None:
        email = canonicalize_email(command.email)
        raw_token = self._token_factory()
        now = self._clock()
        pending_registration = PendingRegistration(
            email=email,
            verification_token_hash=hash_verification_token(raw_token),
            verification_expires_at=now + timedelta(hours=8),
            requested_at=now,
        )
        if await self._repository.begin(pending_registration):
            deferred_tasks.add_task(self._email_sender.send_verification, email, raw_token)

    async def complete(
        self,
        signup_token: str,
        name: str,
        password: str,
        timezone: str,
    ) -> bool:
        password_hash = await self._passwords.hash_password(password)
        return await self._repository.complete(
            RegistrationCompletion(
                signup_token_hash=hash_verification_token(signup_token),
                name=name.strip(),
                password_hash=password_hash,
                timezone=timezone,
            ),
            self._clock(),
        )
