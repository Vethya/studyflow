from dataclasses import dataclass, field
from uuid import UUID

import pytest
from httpx import ASGITransport, AsyncClient

from studyflow.accounts.profile import AccountProfile
from studyflow.app import create_app
from studyflow.auth.session_authentication import SessionPrincipal


@dataclass
class SessionAuthenticationStub:
    principal: SessionPrincipal | None
    calls: list[tuple[str, str | None]] = field(default_factory=list)

    async def authenticate(
        self, session_token: str, csrf_token: str | None = None
    ) -> SessionPrincipal | None:
        self.calls.append((session_token, csrf_token))
        return self.principal

    async def revoke(self, session_token: str, csrf_token: str) -> bool:
        return False


@dataclass
class AccountProfileStub:
    profile: AccountProfile
    updates: list[tuple[UUID, str]] = field(default_factory=list)

    async def get(self, account_id: UUID) -> AccountProfile | None:
        return self.profile

    async def update_name(self, account_id: UUID, name: str) -> AccountProfile | None:
        self.updates.append((account_id, name))
        return AccountProfile(account_id, self.profile.email, name)


@pytest.mark.anyio
async def test_account_profile_read_and_csrf_protected_update() -> None:
    account_id = UUID("5b15bfef-8c44-45d5-a70e-574beb999fb3")
    authentication = SessionAuthenticationStub(
        SessionPrincipal(account_id, "student@example.com", "Student Name")
    )
    profiles = AccountProfileStub(AccountProfile(account_id, "student@example.com", "Student Name"))
    app = create_app(session_authentication=authentication, account_profiles=profiles)
    cookies = {"studyflow_session": "opaque-session-token"}
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="https://test", cookies=cookies
    ) as client:
        current = await client.get("/api/v1/account/profile")
        updated = await client.patch(
            "/api/v1/account/profile",
            json={"name": "Updated Student"},
            headers={"X-CSRF-Token": "csrf-request-token"},
        )

    assert current.status_code == 200
    assert current.json() == {
        "id": str(account_id),
        "email": "student@example.com",
        "name": "Student Name",
    }
    assert updated.status_code == 200
    assert updated.json()["name"] == "Updated Student"
    assert profiles.updates == [(account_id, "Updated Student")]
    assert authentication.calls == [
        ("opaque-session-token", None),
        ("opaque-session-token", "csrf-request-token"),
    ]


@pytest.mark.anyio
async def test_account_profile_update_requires_session_and_csrf() -> None:
    account_id = UUID("5b15bfef-8c44-45d5-a70e-574beb999fb3")
    profiles = AccountProfileStub(AccountProfile(account_id, "student@example.com", "Student Name"))
    app = create_app(
        session_authentication=SessionAuthenticationStub(None), account_profiles=profiles
    )
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="https://test",
        cookies={"studyflow_session": "opaque-session-token"},
    ) as client:
        unauthenticated = await client.get("/api/v1/account/profile")
        missing_csrf = await client.patch(
            "/api/v1/account/profile",
            json={"name": "Updated Student"},
        )

    assert unauthenticated.status_code == 401
    assert missing_csrf.status_code == 403
    assert profiles.updates == []
