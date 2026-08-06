from dataclasses import dataclass, field
from uuid import UUID

import pytest
from httpx import ASGITransport, AsyncClient

from studyflow.app import create_app
from studyflow.auth.login import InvalidCredentialsError, LoginCommand, LoginResult
from studyflow.auth.rate_limits import LoginRateLimitExceeded


@dataclass
class LoginStub:
    result: LoginResult
    commands: list[LoginCommand] = field(default_factory=list)

    async def login(self, command: LoginCommand) -> LoginResult:
        self.commands.append(command)
        return self.result


@dataclass
class FailingLoginStub:
    error: Exception

    async def login(self, command: LoginCommand) -> LoginResult:
        raise self.error


@dataclass
class LoginRateLimitStub:
    error: Exception | None = None

    async def check(self, client_ip: str, email: str) -> None:
        if self.error is not None:
            raise self.error


@pytest.mark.anyio
async def test_email_login_sets_the_host_session_cookie_and_returns_csrf_token() -> None:
    account_id = UUID("5b15bfef-8c44-45d5-a70e-574beb999fb3")
    login = LoginStub(
        LoginResult(
            account_id=account_id,
            email="student@example.com",
            name="Student Name",
            session_token="opaque-session-token",
            csrf_token="csrf-request-token",
        )
    )
    transport = ASGITransport(app=create_app(login=login, login_rate_limiter=LoginRateLimitStub()))

    async with AsyncClient(transport=transport, base_url="https://test") as client:
        response = await client.post(
            "/api/v1/auth/login",
            json={"email": " Student@Example.com ", "password": "correct password"},
        )

    assert response.status_code == 200
    assert response.json() == {
        "account": {
            "id": str(account_id),
            "email": "student@example.com",
            "name": "Student Name",
        },
        "csrf_token": "csrf-request-token",
    }
    cookies = response.headers.get_list("set-cookie")
    session_cookie = next(value for value in cookies if "studyflow_session" in value)
    csrf_cookie = next(value for value in cookies if "studyflow_csrf" in value)
    assert "__Host-studyflow_session=opaque-session-token" in session_cookie
    assert "HttpOnly" in session_cookie
    assert "Secure" in session_cookie
    assert "SameSite=strict" in session_cookie
    assert "Path=/" in session_cookie
    assert "__Host-studyflow_csrf=csrf-request-token" in csrf_cookie
    assert "HttpOnly" not in csrf_cookie
    assert "Secure" in csrf_cookie
    assert "SameSite=strict" in csrf_cookie
    assert login.commands == [
        LoginCommand(email="Student@example.com", password="correct password")
    ]


@pytest.mark.anyio
async def test_email_login_returns_a_non_enumerating_invalid_credentials_error() -> None:
    transport = ASGITransport(
        app=create_app(
            login=FailingLoginStub(InvalidCredentialsError()),
            login_rate_limiter=LoginRateLimitStub(),
        )
    )

    async with AsyncClient(transport=transport, base_url="https://test") as client:
        response = await client.post(
            "/api/v1/auth/login",
            json={"email": "unknown@example.com", "password": "wrong password"},
        )

    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid email or password"}
    assert "set-cookie" not in response.headers


@pytest.mark.anyio
async def test_email_login_rate_limit_runs_before_password_verification() -> None:
    account_id = UUID("5b15bfef-8c44-45d5-a70e-574beb999fb3")
    login = LoginStub(LoginResult(account_id, "student@example.com", "Student", "session", "csrf"))
    transport = ASGITransport(
        app=create_app(
            login=login,
            login_rate_limiter=LoginRateLimitStub(LoginRateLimitExceeded()),
        )
    )

    async with AsyncClient(transport=transport, base_url="https://test") as client:
        response = await client.post(
            "/api/v1/auth/login",
            json={"email": "student@example.com", "password": "guess"},
        )

    assert response.status_code == 429
    assert response.headers["Retry-After"] == "900"
    assert login.commands == []
