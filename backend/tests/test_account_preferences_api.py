from dataclasses import dataclass, field
from uuid import UUID

import pytest
from httpx import ASGITransport, AsyncClient

from studyflow.accounts.preferences import StudyPreferences
from studyflow.app import create_app
from studyflow.auth.session_authentication import SessionPrincipal


@dataclass
class SessionAuthenticationStub:
    principal: SessionPrincipal | None

    async def authenticate(
        self, session_token: str, csrf_token: str | None = None
    ) -> SessionPrincipal | None:
        return self.principal

    async def revoke(self, session_token: str, csrf_token: str) -> bool:
        return False


@dataclass
class PreferencesStub:
    preferences: StudyPreferences
    updates: list[tuple[UUID, str, int, int]] = field(default_factory=list)

    async def get(self, account_id: UUID) -> StudyPreferences | None:
        return self.preferences

    async def update(
        self,
        account_id: UUID,
        timezone: str,
        preferred_session_length_minutes: int,
        minimum_break_minutes: int,
    ) -> StudyPreferences | None:
        self.updates.append(
            (account_id, timezone, preferred_session_length_minutes, minimum_break_minutes)
        )
        return StudyPreferences(
            timezone,
            preferred_session_length_minutes,
            minimum_break_minutes,
            availability_confirmation_required=timezone != self.preferences.timezone,
        )


@pytest.mark.anyio
async def test_study_preferences_read_and_timezone_update_contract() -> None:
    account_id = UUID("5b15bfef-8c44-45d5-a70e-574beb999fb3")
    preferences = PreferencesStub(StudyPreferences("UTC", 60, 10, False))
    app = create_app(
        session_authentication=SessionAuthenticationStub(
            SessionPrincipal(account_id, "student@example.com", "Student")
        ),
        account_preferences=preferences,
    )
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="https://test",
        cookies={"studyflow_session": "session-token"},
    ) as client:
        current = await client.get("/api/v1/account/preferences")
        updated = await client.patch(
            "/api/v1/account/preferences",
            headers={"X-CSRF-Token": "csrf-token"},
            json={
                "timezone": "Asia/Phnom_Penh",
                "preferred_session_length_minutes": 90,
                "minimum_break_minutes": 15,
            },
        )

    assert current.status_code == 200
    assert current.json() == {
        "timezone": "UTC",
        "preferred_session_length_minutes": 60,
        "minimum_break_minutes": 10,
        "availability_confirmation_required": False,
    }
    assert updated.status_code == 200
    assert updated.json()["availability_confirmation_required"] is True
    assert preferences.updates == [(account_id, "Asia/Phnom_Penh", 90, 15)]


@pytest.mark.anyio
@pytest.mark.parametrize(
    "payload",
    (
        {
            "timezone": "not/a-timezone",
            "preferred_session_length_minutes": 60,
            "minimum_break_minutes": 10,
        },
        {
            "timezone": "posixrules",
            "preferred_session_length_minutes": 60,
            "minimum_break_minutes": 10,
        },
        {
            "timezone": "UTC",
            "preferred_session_length_minutes": 9,
            "minimum_break_minutes": 10,
        },
        {
            "timezone": "UTC",
            "preferred_session_length_minutes": 60,
            "minimum_break_minutes": 121,
        },
    ),
)
async def test_study_preferences_reject_invalid_time_rules(payload: dict[str, object]) -> None:
    account_id = UUID("5b15bfef-8c44-45d5-a70e-574beb999fb3")
    preferences = PreferencesStub(StudyPreferences("UTC", 60, 10, False))
    app = create_app(
        session_authentication=SessionAuthenticationStub(
            SessionPrincipal(account_id, "student@example.com", "Student")
        ),
        account_preferences=preferences,
    )
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="https://test",
        cookies={"studyflow_session": "session-token"},
    ) as client:
        response = await client.patch(
            "/api/v1/account/preferences",
            headers={"X-CSRF-Token": "csrf-token"},
            json=payload,
        )

    assert response.status_code == 422
    assert preferences.updates == []


@pytest.mark.anyio
async def test_study_preferences_require_authentication_and_csrf() -> None:
    preferences = PreferencesStub(StudyPreferences("UTC", 60, 10, False))
    app = create_app(
        session_authentication=SessionAuthenticationStub(None),
        account_preferences=preferences,
    )
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="https://test",
        cookies={"studyflow_session": "session-token"},
    ) as client:
        unauthenticated = await client.get("/api/v1/account/preferences")
        missing_csrf = await client.patch(
            "/api/v1/account/preferences",
            json={
                "timezone": "UTC",
                "preferred_session_length_minutes": 60,
                "minimum_break_minutes": 10,
            },
        )

    assert unauthenticated.status_code == 401
    assert missing_csrf.status_code == 403
    assert preferences.updates == []
