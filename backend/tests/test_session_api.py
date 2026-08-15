from dataclasses import dataclass, field
from uuid import UUID

import pytest
from httpx import ASGITransport, AsyncClient

from studyflow.app import create_app
from studyflow.auth.session_authentication import SessionPrincipal


@dataclass
class SessionAuthenticationStub:
    principal: SessionPrincipal | None
    revoked: bool = True
    revoke_error: Exception | None = None
    revoke_calls: list[tuple[str, str]] = field(default_factory=list)

    async def authenticate(
        self, session_token: str, csrf_token: str | None = None
    ) -> SessionPrincipal | None:
        return self.principal

    async def revoke(self, session_token: str, csrf_token: str) -> bool:
        self.revoke_calls.append((session_token, csrf_token))
        if self.revoke_error is not None:
            raise self.revoke_error
        return self.revoked


@pytest.mark.anyio
async def test_current_session_returns_the_authenticated_account() -> None:
    account_id = UUID("5b15bfef-8c44-45d5-a70e-574beb999fb3")
    authentication = SessionAuthenticationStub(
        SessionPrincipal(account_id, "student@example.com", "Student Name")
    )
    transport = ASGITransport(app=create_app(session_authentication=authentication))

    async with AsyncClient(
        transport=transport,
        base_url="https://test",
        cookies={
            "studyflow_session": "opaque-session-token",
            "studyflow_csrf": "csrf-request-token",
        },
    ) as client:
        response = await client.get("/api/v1/auth/session")

    assert response.status_code == 200
    assert response.json() == {
        "account": {
            "id": str(account_id),
            "email": "student@example.com",
            "name": "Student Name",
        }
    }


@pytest.mark.anyio
async def test_logout_requires_matching_csrf_and_clears_browser_cookies() -> None:
    authentication = SessionAuthenticationStub(None)
    transport = ASGITransport(app=create_app(session_authentication=authentication))

    async with AsyncClient(
        transport=transport,
        base_url="https://test",
        cookies={
            "studyflow_session": "opaque-session-token",
            "studyflow_csrf": "csrf-request-token",
        },
    ) as client:
        response = await client.post(
            "/api/v1/auth/logout",
            headers={"X-CSRF-Token": "csrf-request-token"},
        )

    assert response.status_code == 204
    assert authentication.revoke_calls == [("opaque-session-token", "csrf-request-token")]
    cookies = response.headers.get_list("set-cookie")
    assert any('studyflow_session=""' in value and "Max-Age=0" in value for value in cookies)
    assert any('studyflow_csrf=""' in value and "Max-Age=0" in value for value in cookies)


@pytest.mark.anyio
async def test_current_session_rejects_a_missing_or_invalid_cookie() -> None:
    transport = ASGITransport(
        app=create_app(session_authentication=SessionAuthenticationStub(None))
    )
    async with AsyncClient(transport=transport, base_url="https://test") as client:
        response = await client.get("/api/v1/auth/session")
    assert response.status_code == 401


@pytest.mark.anyio
async def test_logout_rejects_invalid_csrf_without_clearing_cookies() -> None:
    authentication = SessionAuthenticationStub(None, revoked=False)
    transport = ASGITransport(app=create_app(session_authentication=authentication))
    async with AsyncClient(
        transport=transport,
        base_url="https://test",
        cookies={
            "studyflow_session": "opaque-session-token",
            "studyflow_csrf": "csrf-request-token",
        },
    ) as client:
        response = await client.post("/api/v1/auth/logout", headers={"X-CSRF-Token": "wrong-token"})
    assert response.status_code == 403
    assert "set-cookie" not in response.headers
    assert authentication.revoke_calls == []


@pytest.mark.anyio
async def test_logout_clears_cookies_when_server_session_is_already_inactive() -> None:
    authentication = SessionAuthenticationStub(None, revoked=False)
    transport = ASGITransport(app=create_app(session_authentication=authentication))
    async with AsyncClient(
        transport=transport,
        base_url="http://test",
        cookies={
            "studyflow_session": "expired-session-token",
            "studyflow_csrf": "csrf-request-token",
        },
    ) as client:
        response = await client.post(
            "/api/v1/auth/logout", headers={"X-CSRF-Token": "csrf-request-token"}
        )
    assert response.status_code == 204
    assert authentication.revoke_calls == [("expired-session-token", "csrf-request-token")]
    assert len(response.headers.get_list("set-cookie")) == 2


@pytest.mark.anyio
async def test_repeated_logout_without_cookies_is_successful() -> None:
    authentication = SessionAuthenticationStub(None, revoked=False)
    transport = ASGITransport(app=create_app(session_authentication=authentication))
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post("/api/v1/auth/logout")
    assert response.status_code == 204
    assert authentication.revoke_calls == []
    assert len(response.headers.get_list("set-cookie")) == 2


@pytest.mark.anyio
async def test_logout_rejects_session_cookie_without_csrf_cookie() -> None:
    authentication = SessionAuthenticationStub(None, revoked=False)
    transport = ASGITransport(app=create_app(session_authentication=authentication))
    async with AsyncClient(
        transport=transport,
        base_url="http://test",
        cookies={"studyflow_session": "opaque-session-token"},
    ) as client:
        response = await client.post(
            "/api/v1/auth/logout", headers={"X-CSRF-Token": "csrf-request-token"}
        )
    assert response.status_code == 403
    assert authentication.revoke_calls == []


@pytest.mark.anyio
async def test_logout_clears_cookies_when_server_revocation_raises() -> None:
    authentication = SessionAuthenticationStub(
        None, revoke_error=RuntimeError("database unavailable")
    )
    transport = ASGITransport(app=create_app(session_authentication=authentication))
    async with AsyncClient(
        transport=transport,
        base_url="http://test",
        cookies={
            "studyflow_session": "opaque-session-token",
            "studyflow_csrf": "csrf-request-token",
        },
    ) as client:
        response = await client.post(
            "/api/v1/auth/logout", headers={"X-CSRF-Token": "csrf-request-token"}
        )
    assert response.status_code == 204
    assert len(response.headers.get_list("set-cookie")) == 2


@pytest.mark.anyio
async def test_logout_rejects_non_ascii_csrf_without_server_error() -> None:
    authentication = SessionAuthenticationStub(None)
    transport = ASGITransport(app=create_app(session_authentication=authentication))
    async with AsyncClient(
        transport=transport,
        base_url="http://test",
        cookies={
            "studyflow_session": "opaque-session-token",
            "studyflow_csrf": "csrf-request-token",
        },
    ) as client:
        response = await client.post("/api/v1/auth/logout", headers=[(b"X-CSRF-Token", b"\xff")])
    assert response.status_code == 403
    assert authentication.revoke_calls == []
