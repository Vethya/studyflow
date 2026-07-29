from dataclasses import dataclass
from uuid import UUID

import pytest
from httpx import ASGITransport, AsyncClient

from studyflow.app import create_app
from studyflow.auth.oidc import OIDCLoginResult, OIDCStart


@dataclass
class OIDCStub:
    async def start(self, timezone: str) -> OIDCStart:
        assert timezone == "Asia/Phnom_Penh"
        return OIDCStart(
            "https://accounts.google.com/o/oauth2/v2/auth?scope=openid",
            "state-state-state-state",
        )

    async def complete(self, code: str, state: str, state_cookie: str) -> OIDCLoginResult:
        assert (code, state, state_cookie) == (
            "code",
            "state-state-state-state",
            "state-state-state-state",
        )
        return OIDCLoginResult(
            UUID("5b15bfef-8c44-45d5-a70e-574beb999fb3"),
            "student@example.com",
            "Student",
            "session-token",
            "csrf-token",
        )


class RateLimitStub:
    async def check(self, client_ip: str) -> None:
        assert client_ip == "127.0.0.1"


@pytest.mark.anyio
async def test_google_oidc_start_and_callback_cookie_contract() -> None:
    app = create_app(oidc_login=OIDCStub(), oidc_start_rate_limiter=RateLimitStub())
    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://test") as client:
        started = await client.get("/api/v1/auth/google/start?timezone=Asia%2FPhnom_Penh")
        completed = await client.get(
            "/api/v1/auth/google/callback?code=code&state=state-state-state-state"
        )

    assert started.status_code == 200
    assert started.json()["authorization_url"].startswith("https://accounts.google.com/")
    assert "__Host-studyflow_oidc_state=state-state-state-state" in started.headers["set-cookie"]
    assert completed.status_code == 200
    cookies = completed.headers.get_list("set-cookie")
    assert any("__Host-studyflow_session=session-token" in cookie for cookie in cookies)
    assert any("__Host-studyflow_csrf=csrf-token" in cookie for cookie in cookies)


@pytest.mark.anyio
async def test_google_oidc_denial_is_generic_and_clears_state_cookie() -> None:
    app = create_app(oidc_login=OIDCStub(), oidc_start_rate_limiter=RateLimitStub())
    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://test") as client:
        await client.get("/api/v1/auth/google/start?timezone=Asia%2FPhnom_Penh")
        denied = await client.get(
            "/api/v1/auth/google/callback?error=access_denied&state=state-state-state-state"
        )

    assert denied.status_code == 400
    assert denied.json() == {"detail": "Google sign-in could not be completed"}
    assert "__Host-studyflow_oidc_state=" in denied.headers["set-cookie"]
