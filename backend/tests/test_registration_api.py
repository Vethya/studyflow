from dataclasses import dataclass, field
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient, ConnectError, Request

from studyflow.app import create_app
from studyflow.auth.passwords import BreachedPasswordError
from studyflow.auth.rate_limits import RegistrationRateLimitExceeded
from studyflow.auth.registration import DeferredTasks, RegistrationCommand


@dataclass
class RegistrationStub:
    commands: list[RegistrationCommand] = field(default_factory=list)
    completion: bool = True
    error: Exception | None = None

    async def register(self, command: RegistrationCommand, deferred_tasks: DeferredTasks) -> None:
        self.commands.append(command)

    async def complete(self, signup_token: str, name: str, password: str, timezone: str) -> bool:
        if self.error is not None:
            raise self.error
        return self.completion


@dataclass
class RegistrationRateLimitStub:
    error: Exception | None = None

    async def check(self, client_ip: str, email: str) -> None:
        if self.error is not None:
            raise self.error


def app(registration: RegistrationStub, rate_limit: RegistrationRateLimitStub | None = None) -> Any:
    return create_app(
        registration=registration,
        registration_rate_limiter=rate_limit or RegistrationRateLimitStub(),
    )


@pytest.mark.anyio
async def test_registration_accepts_only_an_email() -> None:
    registration = RegistrationStub()
    async with AsyncClient(
        transport=ASGITransport(app=app(registration)), base_url="http://test"
    ) as client:
        response = await client.post(
            "/api/v1/auth/register", json={"email": " Student@Example.com "}
        )
    assert response.status_code == 202
    assert registration.commands == [RegistrationCommand(email="Student@example.com")]


@pytest.mark.anyio
async def test_registration_rejects_profile_and_password_fields_before_verification() -> None:
    registration = RegistrationStub()
    async with AsyncClient(
        transport=ASGITransport(app=app(registration)), base_url="http://test"
    ) as client:
        response = await client.post(
            "/api/v1/auth/register",
            json={
                "email": "student@example.com",
                "name": "Student",
                "password": "correct horse battery staple",
                "timezone": "UTC",
            },
        )
    assert response.status_code == 422
    assert registration.commands == []


@pytest.mark.anyio
async def test_registration_rate_limit_runs_before_service() -> None:
    registration = RegistrationStub()
    rate_limit = RegistrationRateLimitStub(error=RegistrationRateLimitExceeded())
    async with AsyncClient(
        transport=ASGITransport(app=app(registration, rate_limit)), base_url="http://test"
    ) as client:
        response = await client.post("/api/v1/auth/register", json={"email": "student@example.com"})
    assert response.status_code == 429
    assert registration.commands == []


@pytest.mark.anyio
async def test_completion_accepts_profile_only_with_signup_token() -> None:
    registration = RegistrationStub()
    async with AsyncClient(
        transport=ASGITransport(app=app(registration)), base_url="http://test"
    ) as client:
        response = await client.post(
            "/api/v1/auth/complete-registration",
            json={
                "signup_token": "short-lived-verified-signup-token",
                "name": "Student",
                "password": "correct horse battery staple",
                "timezone": "Asia/Phnom_Penh",
            },
        )
    assert response.status_code == 201


@pytest.mark.anyio
async def test_completion_rejects_invalid_signup_token() -> None:
    registration = RegistrationStub(completion=False)
    async with AsyncClient(
        transport=ASGITransport(app=app(registration)), base_url="http://test"
    ) as client:
        response = await client.post(
            "/api/v1/auth/complete-registration",
            json={
                "signup_token": "expired-verified-signup-token",
                "name": "Student",
                "password": "correct horse battery staple",
                "timezone": "UTC",
            },
        )
    assert response.status_code == 400


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("error", "status_code"),
    [
        (BreachedPasswordError("internal"), 422),
        (ConnectError("down", request=Request("GET", "https://example.test")), 503),
    ],
)
async def test_completion_handles_password_safety_failures(
    error: Exception, status_code: int
) -> None:
    registration = RegistrationStub(error=error)
    async with AsyncClient(
        transport=ASGITransport(app=app(registration)), base_url="http://test"
    ) as client:
        response = await client.post(
            "/api/v1/auth/complete-registration",
            json={
                "signup_token": "short-lived-verified-signup-token",
                "name": "Student",
                "password": "correct horse battery staple",
                "timezone": "UTC",
            },
        )
    assert response.status_code == status_code
