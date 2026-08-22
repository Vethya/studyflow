from dataclasses import dataclass, field
from uuid import UUID

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr

from studyflow.app import create_app
from studyflow.auth.login import (
    EmailVerificationRequiredError,
    InvalidCredentialsError,
    LoginCommand,
    LoginResult,
)
from studyflow.auth.rate_limits import LoginRateLimitExceeded
from studyflow.auth.session_authentication import SessionPrincipal
from studyflow.settings import Environment, Settings


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
    checks: list[tuple[str, str]] = field(default_factory=list)
    failures: list[str] = field(default_factory=list)
    resets: list[str] = field(default_factory=list)
    releases: list[str] = field(default_factory=list)

    async def check(self, client_ip: str, email: str) -> str:
        self.checks.append((client_ip, email))
        if self.error is not None:
            raise self.error
        return "login_inflight:test"

    async def record_failure(self, email: str, reservation_id: str) -> None:
        self.failures.append(email)

    async def reset_failures(self, email: str, reservation_id: str) -> None:
        self.resets.append(email)

    async def release(self, email: str, reservation_id: str) -> None:
        self.releases.append(email)


@dataclass
class SessionAuthenticationStub:
    principal: SessionPrincipal

    async def authenticate(
        self, session_token: str, csrf_token: str | None = None
    ) -> SessionPrincipal | None:
        return self.principal if session_token == "opaque-session-token" else None

    async def revoke(self, session_token: str, csrf_token: str) -> bool:
        return False


@pytest.mark.anyio
async def test_email_login_sets_local_http_cookies_and_returns_csrf_token() -> None:
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
    rate_limit = LoginRateLimitStub()
    transport = ASGITransport(
        app=create_app(
            login=login,
            login_rate_limiter=rate_limit,
            session_authentication=SessionAuthenticationStub(
                SessionPrincipal(account_id, "student@example.com", "Student Name")
            ),
        )
    )
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/v1/auth/login",
            json={"email": " Student@Example.com ", "password": "correct password"},
        )
        current_session = await client.get("/api/v1/auth/session")

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
    assert "studyflow_session=opaque-session-token" in session_cookie
    assert "HttpOnly" in session_cookie
    assert "Secure" not in session_cookie
    assert "SameSite=strict" in session_cookie
    assert "Path=/" in session_cookie
    assert "studyflow_csrf=csrf-request-token" in csrf_cookie
    assert "HttpOnly" not in csrf_cookie
    assert "Secure" not in csrf_cookie
    assert "SameSite=strict" in csrf_cookie
    assert login.commands == [
        LoginCommand(email="Student@example.com", password="correct password")
    ]
    assert rate_limit.failures == []
    assert rate_limit.resets == ["Student@example.com"]
    assert current_session.status_code == 200


@pytest.mark.anyio
async def test_production_login_uses_secure_host_prefixed_cookies() -> None:
    account_id = UUID("5b15bfef-8c44-45d5-a70e-574beb999fb3")
    settings = Settings(
        environment=Environment.PRODUCTION,
        database_url=SecretStr(
            "postgresql+psycopg://studyflow:secret@database/studyflow?sslmode=require"
        ),
        public_app_url="https://studyflow.example.com",
        smtp_start_tls=True,
    )
    application = create_app(
        settings=settings,
        login=LoginStub(
            LoginResult(
                account_id,
                "student@example.com",
                "Student",
                "opaque-session-token",
                "csrf-request-token",
            )
        ),
        login_rate_limiter=LoginRateLimitStub(),
    )

    async with AsyncClient(
        transport=ASGITransport(app=application), base_url="https://studyflow.example.com"
    ) as client:
        response = await client.post(
            "/api/v1/auth/login",
            json={"email": "student@example.com", "password": "correct password"},
        )

    cookies = response.headers.get_list("set-cookie")
    assert any("__Host-studyflow_session=opaque-session-token" in value for value in cookies)
    assert any("__Host-studyflow_csrf=csrf-request-token" in value for value in cookies)
    assert all("Secure" in value for value in cookies)


@pytest.mark.anyio
async def test_email_login_returns_a_non_enumerating_invalid_credentials_error() -> None:
    rate_limit = LoginRateLimitStub()
    transport = ASGITransport(
        app=create_app(
            login=FailingLoginStub(InvalidCredentialsError()),
            login_rate_limiter=rate_limit,
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
    assert rate_limit.failures == ["unknown@example.com"]
    assert rate_limit.resets == []


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


@pytest.mark.anyio
async def test_valid_unverified_credentials_reset_failures() -> None:
    rate_limit = LoginRateLimitStub()
    transport = ASGITransport(
        app=create_app(
            login=FailingLoginStub(EmailVerificationRequiredError()),
            login_rate_limiter=rate_limit,
        )
    )
    async with AsyncClient(transport=transport, base_url="https://test") as client:
        response = await client.post(
            "/api/v1/auth/login",
            json={"email": "student@example.com", "password": "correct password"},
        )
    assert response.status_code == 403
    assert rate_limit.resets == ["student@example.com"]


@pytest.mark.anyio
async def test_unexpected_login_error_releases_inflight_reservation() -> None:
    rate_limit = LoginRateLimitStub()
    transport = ASGITransport(
        app=create_app(
            login=FailingLoginStub(RuntimeError("unexpected")),
            login_rate_limiter=rate_limit,
        )
    )
    with pytest.raises(RuntimeError, match="unexpected"):
        async with AsyncClient(transport=transport, base_url="https://test") as client:
            await client.post(
                "/api/v1/auth/login",
                json={"email": "student@example.com", "password": "password"},
            )
    assert rate_limit.releases == ["student@example.com"]


@pytest.mark.anyio
async def test_limiter_error_before_reservation_does_not_release_another_slot() -> None:
    rate_limit = LoginRateLimitStub(error=RuntimeError("limiter unavailable"))
    transport = ASGITransport(
        app=create_app(
            login=FailingLoginStub(AssertionError("login must not run")),
            login_rate_limiter=rate_limit,
        )
    )
    with pytest.raises(RuntimeError, match="limiter unavailable"):
        async with AsyncClient(transport=transport, base_url="https://test") as client:
            await client.post(
                "/api/v1/auth/login",
                json={"email": "student@example.com", "password": "password"},
            )
    assert rate_limit.releases == []
