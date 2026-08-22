from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

import pytest
from httpx import ASGITransport, AsyncClient

from studyflow.app import create_app
from studyflow.auth.oidc import LinkedIdentity, OIDCLoginResult
from studyflow.auth.session_authentication import SessionPrincipal

ACCOUNT_ID = UUID("5b15bfef-8c44-45d5-a70e-574beb999fb3")


@dataclass
class AuthenticationStub:
    async def authenticate(
        self, session_token: str, csrf_token: str | None = None
    ) -> SessionPrincipal | None:
        return SessionPrincipal(ACCOUNT_ID, "student@example.com", "Student")

    async def revoke(self, session_token: str, csrf_token: str) -> bool:
        return False


class LinkingStub:
    async def resolve_attempt_account_id(self, challenge: str) -> UUID | None:
        assert challenge == "challenge-token-value-123"
        return ACCOUNT_ID

    async def link(self, challenge: str, password: str) -> OIDCLoginResult:
        assert challenge == "challenge-token-value-123" and password == "correct password"
        return OIDCLoginResult(
            ACCOUNT_ID,
            "student@example.com",
            "Student",
            "session-token",
            "csrf-token",
        )

    async def list_identities(self, account_id: UUID) -> list[LinkedIdentity]:
        return [LinkedIdentity("google", "student@example.com", datetime.now(UTC))]


class RateLimitStub:
    async def check(self, client_ip: str, account_key: str) -> None:
        assert account_key == str(ACCOUNT_ID)


@pytest.mark.anyio
async def test_confirm_google_link_and_linked_identity_settings_contract() -> None:
    linking = LinkingStub()
    app = create_app(
        session_authentication=AuthenticationStub(),
        oidc_account_linking=linking,
        oidc_link_rate_limiter=RateLimitStub(),
    )
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="https://test",
        cookies={"studyflow_session": "session-token"},
    ) as client:
        linked = await client.post(
            "/api/v1/auth/google/link",
            json={"challenge": "challenge-token-value-123", "password": "correct password"},
        )
        identities = await client.get("/api/v1/account/identities")

    assert linked.status_code == 200
    assert linked.json()["csrf_token"] == "csrf-token"
    assert identities.status_code == 200
    assert identities.json()[0]["provider"] == "google"


@pytest.mark.anyio
async def test_confirm_google_link_accepts_and_clears_browser_link_cookie() -> None:
    app = create_app(
        oidc_account_linking=LinkingStub(),
        oidc_link_rate_limiter=RateLimitStub(),
    )
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="https://test",
    ) as client:
        client.cookies.set(
            "studyflow_oidc_link", "challenge-token-value-123", domain="test.local", path="/"
        )
        linked = await client.post(
            "/api/v1/auth/google/link/browser",
            json={"password": "correct password"},
        )

    assert linked.status_code == 200
    assert "studyflow_oidc_link=" in linked.headers["set-cookie"]
    assert client.cookies.get("studyflow_oidc_link") is None


@pytest.mark.anyio
async def test_json_google_link_still_requires_explicit_challenge() -> None:
    app = create_app(
        oidc_account_linking=LinkingStub(),
        oidc_link_rate_limiter=RateLimitStub(),
    )
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="https://test",
        cookies={"studyflow_oidc_link": "challenge-token-value-123"},
    ) as client:
        response = await client.post(
            "/api/v1/auth/google/link",
            json={"password": "correct password"},
        )

    assert response.status_code == 422
