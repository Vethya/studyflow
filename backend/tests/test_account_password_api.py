from dataclasses import dataclass, field
from uuid import UUID

import httpx
import pytest
from httpx import ASGITransport, AsyncClient

from studyflow.accounts.password import InvalidCurrentPasswordError
from studyflow.app import create_app
from studyflow.auth.passwords import PasswordPolicyError
from studyflow.auth.rate_limits import AccountPasswordChangeRateLimitExceeded
from studyflow.auth.session_authentication import SessionPrincipal


@dataclass
class AuthenticationStub:
    principal: SessionPrincipal

    async def authenticate(
        self, session_token: str, csrf_token: str | None = None
    ) -> SessionPrincipal | None:
        return self.principal

    async def revoke(self, session_token: str, csrf_token: str) -> bool:
        return False


@dataclass
class PasswordChangeStub:
    failure: Exception | None = None
    calls: list[tuple[UUID, str, str]] = field(default_factory=list)

    async def change(self, account_id: UUID, current_password: str, new_password: str) -> None:
        self.calls.append((account_id, current_password, new_password))
        if self.failure is not None:
            raise self.failure


@dataclass
class RateLimitStub:
    exceeded: bool = False

    async def check(self, client_ip: str, account_id: str) -> None:
        if self.exceeded:
            raise AccountPasswordChangeRateLimitExceeded


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("failure", "expected"),
    (
        (None, 204),
        (InvalidCurrentPasswordError(), 400),
        (PasswordPolicyError(), 422),
        (httpx.ConnectError("unavailable"), 503),
    ),
)
async def test_password_change_contract_and_session_clearing(
    failure: Exception | None, expected: int
) -> None:
    account_id = UUID("5b15bfef-8c44-45d5-a70e-574beb999fb3")
    app = create_app(
        session_authentication=AuthenticationStub(
            SessionPrincipal(account_id, "student@example.com", "Student")
        ),
        account_passwords=PasswordChangeStub(failure),
        account_password_change_rate_limiter=RateLimitStub(),
    )
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="https://test",
        cookies={"__Host-studyflow_session": "session-token"},
    ) as client:
        response = await client.patch(
            "/api/v1/account/password",
            headers={"X-CSRF-Token": "csrf-token"},
            json={
                "current_password": "current-password",
                "new_password": "new-secure-password",
            },
        )

    assert response.status_code == expected
    if expected == 204:
        cookies = response.headers.get_list("set-cookie")
        assert any(
            "__Host-studyflow_session=" in value and "Max-Age=0" in value for value in cookies
        )
        assert any("__Host-studyflow_csrf=" in value and "Max-Age=0" in value for value in cookies)


@pytest.mark.anyio
async def test_password_change_rate_limit_returns_retry_after() -> None:
    account_id = UUID("5b15bfef-8c44-45d5-a70e-574beb999fb3")
    passwords = PasswordChangeStub()
    app = create_app(
        session_authentication=AuthenticationStub(
            SessionPrincipal(account_id, "student@example.com", "Student")
        ),
        account_passwords=passwords,
        account_password_change_rate_limiter=RateLimitStub(exceeded=True),
    )
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="https://test",
        cookies={"__Host-studyflow_session": "session-token"},
    ) as client:
        response = await client.patch(
            "/api/v1/account/password",
            headers={"X-CSRF-Token": "csrf-token"},
            json={
                "current_password": "current-password",
                "new_password": "new-secure-password",
            },
        )

    assert response.status_code == 429
    assert response.headers["retry-after"] == "900"
    assert passwords.calls == []
