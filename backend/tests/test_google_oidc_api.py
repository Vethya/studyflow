from dataclasses import dataclass
from uuid import UUID

import pytest
from httpx import ASGITransport, AsyncClient

from studyflow.app import create_app
from studyflow.auth.oidc import (
    AccountLinkRequiredError,
    InvalidOIDCResponseError,
    OIDCLoginResult,
    OIDCProviderUnavailableError,
    OIDCStart,
)


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


class LinkRequiredOIDCStub(OIDCStub):
    async def complete(self, code: str, state: str, state_cookie: str) -> OIDCLoginResult:
        raise AccountLinkRequiredError("server-link-challenge-value")


class RetryableUnavailableOIDCStub(OIDCStub):
    async def complete(self, code: str, state: str, state_cookie: str) -> OIDCLoginResult:
        raise OIDCProviderUnavailableError(retry_same_callback=True)


class RestartRequiredOIDCStub(OIDCStub):
    async def complete(self, code: str, state: str, state_cookie: str) -> OIDCLoginResult:
        raise OIDCProviderUnavailableError


class InvalidOIDCStub(OIDCStub):
    async def complete(self, code: str, state: str, state_cookie: str) -> OIDCLoginResult:
        raise InvalidOIDCResponseError


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
    assert "studyflow_oidc_state=state-state-state-state" in started.headers["set-cookie"]
    assert completed.status_code == 200
    cookies = completed.headers.get_list("set-cookie")
    assert any("studyflow_session=session-token" in cookie for cookie in cookies)
    assert any("studyflow_csrf=csrf-token" in cookie for cookie in cookies)


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
    assert "studyflow_oidc_state=" in denied.headers["set-cookie"]


@pytest.mark.anyio
async def test_google_oidc_returns_only_the_server_issued_link_challenge() -> None:
    app = create_app(oidc_login=LinkRequiredOIDCStub(), oidc_start_rate_limiter=RateLimitStub())
    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://test") as client:
        await client.get("/api/v1/auth/google/start?timezone=Asia%2FPhnom_Penh")
        response = await client.get(
            "/api/v1/auth/google/callback?code=code&state=state-state-state-state"
        )

    assert response.status_code == 409
    assert response.headers["cache-control"] == "no-store"
    assert response.json() == {
        "detail": "Password-confirmed account linking required",
        "link_challenge": "server-link-challenge-value",
    }


@pytest.mark.anyio
async def test_google_oidc_provider_outage_is_retryable_and_retains_state_cookie() -> None:
    app = create_app(
        oidc_login=RetryableUnavailableOIDCStub(), oidc_start_rate_limiter=RateLimitStub()
    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://test") as client:
        await client.get("/api/v1/auth/google/start?timezone=Asia%2FPhnom_Penh")
        response = await client.get(
            "/api/v1/auth/google/callback?code=code&state=state-state-state-state"
        )

        assert client.cookies.get("studyflow_oidc_state") == "state-state-state-state"

    assert response.status_code == 503
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["retry-after"] == "60"
    assert "set-cookie" not in response.headers
    assert response.json() == {"detail": "Google sign-in is temporarily unavailable"}


@pytest.mark.anyio
async def test_google_oidc_provider_outage_requires_restart_after_code_may_be_consumed() -> None:
    app = create_app(oidc_login=RestartRequiredOIDCStub(), oidc_start_rate_limiter=RateLimitStub())
    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://test") as client:
        await client.get("/api/v1/auth/google/start?timezone=Asia%2FPhnom_Penh")
        response = await client.get(
            "/api/v1/auth/google/callback?code=code&state=state-state-state-state"
        )

    assert response.status_code == 503
    assert response.headers["retry-after"] == "60"
    assert "studyflow_oidc_state=" in response.headers["set-cookie"]


@pytest.mark.anyio
async def test_google_oidc_browser_success_redirects_to_clean_app_url() -> None:
    app = create_app(oidc_login=OIDCStub(), oidc_start_rate_limiter=RateLimitStub())
    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://test") as client:
        await client.get("/api/v1/auth/google/start?timezone=Asia%2FPhnom_Penh")
        response = await client.get(
            "/api/v1/auth/google/callback?code=code&state=state-state-state-state",
            headers={"Accept": "text/html"},
        )

    assert response.status_code == 303
    assert response.headers["location"] == "http://localhost:5173/app"
    assert response.headers["referrer-policy"] == "no-referrer"
    assert response.headers["vary"] == "Accept"
    assert "code" not in response.headers["location"]
    cookies = response.headers.get_list("set-cookie")
    assert any("studyflow_session=session-token" in cookie for cookie in cookies)
    assert any("studyflow_csrf=csrf-token" in cookie for cookie in cookies)
    assert any("studyflow_oidc_state=" in cookie for cookie in cookies)


@pytest.mark.anyio
async def test_google_oidc_browser_linking_uses_http_only_server_state() -> None:
    app = create_app(oidc_login=LinkRequiredOIDCStub(), oidc_start_rate_limiter=RateLimitStub())
    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://test") as client:
        await client.get("/api/v1/auth/google/start?timezone=Asia%2FPhnom_Penh")
        response = await client.get(
            "/api/v1/auth/google/callback?code=code&state=state-state-state-state",
            headers={"Accept": "text/html"},
        )

    assert response.status_code == 303
    assert response.headers["location"] == "http://localhost:5173/login/google-link"
    assert "server-link-challenge-value" not in response.headers["location"]
    cookies = response.headers.get_list("set-cookie")
    link_cookie = next(cookie for cookie in cookies if "studyflow_oidc_link=" in cookie)
    assert "server-link-challenge-value" in link_cookie
    assert "HttpOnly" in link_cookie
    assert "Max-Age=600" in link_cookie


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("query", "outcome"),
    [
        ("error=access_denied", "denied"),
        ("code=code", "invalid"),
    ],
)
async def test_google_oidc_browser_errors_redirect_without_sensitive_parameters(
    query: str, outcome: str
) -> None:
    oidc = InvalidOIDCStub() if outcome == "invalid" else OIDCStub()
    app = create_app(oidc_login=oidc, oidc_start_rate_limiter=RateLimitStub())
    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://test") as client:
        await client.get("/api/v1/auth/google/start?timezone=Asia%2FPhnom_Penh")
        response = await client.get(
            f"/api/v1/auth/google/callback?{query}&state=state-state-state-state",
            headers={"Accept": "text/html"},
        )

    assert response.status_code == 303
    assert response.headers["location"] == f"http://localhost:5173/login/google-error/{outcome}"
    assert "?" not in response.headers["location"]
    assert "studyflow_oidc_state=" in response.headers["set-cookie"]


@pytest.mark.anyio
async def test_google_oidc_browser_provider_outage_redirects_and_clears_callback_state() -> None:
    app = create_app(
        oidc_login=RetryableUnavailableOIDCStub(), oidc_start_rate_limiter=RateLimitStub()
    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://test") as client:
        await client.get("/api/v1/auth/google/start?timezone=Asia%2FPhnom_Penh")
        response = await client.get(
            "/api/v1/auth/google/callback?code=code&state=state-state-state-state",
            headers={"Accept": "text/html"},
        )

    assert response.status_code == 303
    assert response.headers["location"] == (
        "http://localhost:5173/login/google-error/provider-unavailable"
    )
    assert response.headers["retry-after"] == "60"
    assert "studyflow_oidc_state=" in response.headers["set-cookie"]
