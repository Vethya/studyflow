from dataclasses import dataclass, field

import pytest
from httpx import ASGITransport, AsyncClient, ConnectError, Request

from studyflow.app import create_app
from studyflow.auth.passwords import BreachedPasswordError
from studyflow.auth.rate_limits import RegistrationRateLimitExceeded
from studyflow.auth.registration import DeferredTasks, RegistrationCommand


@dataclass
class RegistrationStub:
    commands: list[RegistrationCommand] = field(default_factory=list)
    error: Exception | None = None

    async def register(
        self,
        command: RegistrationCommand,
        deferred_tasks: DeferredTasks,
    ) -> None:
        self.commands.append(command)
        if self.error is not None:
            raise self.error


@dataclass
class RegistrationRateLimitStub:
    error: Exception | None = None

    async def check(self, client_ip: str, email: str) -> None:
        if self.error is not None:
            raise self.error


@pytest.mark.anyio
async def test_registration_accepts_a_valid_student_account() -> None:
    registration = RegistrationStub()
    application = create_app(
        registration=registration,
        registration_rate_limiter=RegistrationRateLimitStub(),
    )
    transport = ASGITransport(app=application)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/v1/auth/register",
            json={
                "email": " Student@Example.com ",
                "name": "Student Name",
                "password": "correct horse battery staple",
                "timezone": "Asia/Phnom_Penh",
            },
        )

    assert response.status_code == 202
    assert response.json() == {
        "message": "Check your email to continue registration if the address is eligible."
    }
    assert registration.commands == [
        RegistrationCommand(
            email="Student@example.com",
            name="Student Name",
            password="correct horse battery staple",
            timezone="Asia/Phnom_Penh",
        )
    ]


@pytest.mark.anyio
async def test_registration_rejects_an_unknown_iana_timezone() -> None:
    registration = RegistrationStub()
    transport = ASGITransport(
        app=create_app(
            registration=registration,
            registration_rate_limiter=RegistrationRateLimitStub(),
        )
    )

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/v1/auth/register",
            json={
                "email": "student@example.com",
                "name": "Student Name",
                "password": "correct horse battery staple",
                "timezone": "Mars/Olympus_Mons",
            },
        )

    assert response.status_code == 422
    assert registration.commands == []


@pytest.mark.anyio
async def test_registration_rejects_an_invalid_email_address() -> None:
    registration = RegistrationStub()
    transport = ASGITransport(
        app=create_app(
            registration=registration,
            registration_rate_limiter=RegistrationRateLimitStub(),
        )
    )

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/v1/auth/register",
            json={
                "email": "not-an-email",
                "name": "Student Name",
                "password": "correct horse battery staple",
                "timezone": "UTC",
            },
        )

    assert response.status_code == 422
    assert registration.commands == []


@pytest.mark.anyio
async def test_registration_rejects_a_breached_password_without_exposing_details() -> None:
    registration = RegistrationStub(error=BreachedPasswordError("internal detail"))
    transport = ASGITransport(
        app=create_app(
            registration=registration,
            registration_rate_limiter=RegistrationRateLimitStub(),
        )
    )

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/v1/auth/register",
            json={
                "email": "student@example.com",
                "name": "Student Name",
                "password": "correct horse battery staple",
                "timezone": "UTC",
            },
        )

    assert response.status_code == 422
    assert response.json() == {"detail": "Password is not allowed"}


@pytest.mark.anyio
async def test_registration_reports_password_safety_service_unavailability() -> None:
    error = ConnectError("unavailable", request=Request("GET", "https://example.test"))
    registration = RegistrationStub(error=error)
    transport = ASGITransport(
        app=create_app(
            registration=registration,
            registration_rate_limiter=RegistrationRateLimitStub(),
        )
    )

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/v1/auth/register",
            json={
                "email": "student@example.com",
                "name": "Student Name",
                "password": "correct horse battery staple",
                "timezone": "UTC",
            },
        )

    assert response.status_code == 503
    assert response.json() == {"detail": "Password safety service is unavailable"}


@pytest.mark.anyio
async def test_registration_rejects_a_whitespace_only_name() -> None:
    registration = RegistrationStub()
    transport = ASGITransport(
        app=create_app(
            registration=registration,
            registration_rate_limiter=RegistrationRateLimitStub(),
        )
    )

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/v1/auth/register",
            json={
                "email": "student@example.com",
                "name": "   ",
                "password": "correct horse battery staple",
                "timezone": "UTC",
            },
        )

    assert response.status_code == 422
    assert registration.commands == []


@pytest.mark.anyio
async def test_registration_rate_limit_runs_before_expensive_security_work() -> None:
    registration = RegistrationStub()
    rate_limit = RegistrationRateLimitStub(error=RegistrationRateLimitExceeded())
    application = create_app(
        registration=registration,
        registration_rate_limiter=rate_limit,
    )
    transport = ASGITransport(app=application)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/v1/auth/register",
            json={
                "email": "student@example.com",
                "name": "Student Name",
                "password": "correct horse battery staple",
                "timezone": "UTC",
            },
        )

    assert response.status_code == 429
    assert response.headers["Retry-After"] == "900"
    assert registration.commands == []
