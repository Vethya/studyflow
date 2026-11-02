from dataclasses import dataclass, field
from uuid import UUID

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr

from studyflow.app import create_app
from studyflow.auth.session_authentication import SessionPrincipal
from studyflow.reminders.preferences import (
    ReminderPreferences,
    ReminderPreferencesService,
    ReminderPreferencesState,
)
from studyflow.reminders.service import ReminderDispatchSummary
from studyflow.settings import Environment, Settings

ACCOUNT_ID = UUID("5b15bfef-8c44-45d5-a70e-574beb999fb3")
TOKEN = "t" * 40
STUDENT = SessionPrincipal(ACCOUNT_ID, "student@example.com", "Student")


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
class ReminderSettingsStub:
    state: ReminderPreferencesState | None = field(
        default_factory=lambda: ReminderPreferencesState(ReminderPreferences(), True)
    )
    updates: list[tuple[UUID, ReminderPreferences]] = field(default_factory=list)

    async def get(self, account_id: UUID) -> ReminderPreferencesState | None:
        return self.state

    async def update(
        self, account_id: UUID, preferences: ReminderPreferences
    ) -> ReminderPreferencesState | None:
        self.updates.append((account_id, preferences))
        if self.state is None:
            return None
        return ReminderPreferencesState(preferences, self.state.email_verified)


@dataclass
class DispatchStub:
    calls: int = 0

    async def dispatch(self) -> ReminderDispatchSummary:
        self.calls += 1
        return ReminderDispatchSummary(sent_before=2, sent_after=1, skipped=3, failed=0)


def settings(token: str | None = None) -> Settings:
    return Settings(
        environment=Environment.TEST,
        reminder_dispatch_token=SecretStr(token) if token is not None else None,
    )


def client(
    *,
    principal: SessionPrincipal | None = STUDENT,
    reminders: ReminderSettingsStub | None = None,
    dispatch: DispatchStub | None = None,
    token: str | None = None,
) -> AsyncClient:
    app = create_app(
        settings=settings(token),
        session_authentication=SessionAuthenticationStub(principal),
        reminder_settings=reminders or ReminderSettingsStub(),
        reminder_dispatch=dispatch or DispatchStub(),
    )
    return AsyncClient(
        transport=ASGITransport(app=app),
        base_url="https://test",
        cookies={"studyflow_session": "session-token"},
    )


VALID_UPDATE = {"email_enabled": True, "before_session_minutes": 45, "after_session": False}


@pytest.mark.anyio
async def test_reminder_preferences_read_and_update_contract() -> None:
    reminders = ReminderSettingsStub()
    async with client(reminders=reminders, token=TOKEN) as http:
        current = await http.get("/api/v1/reminders/preferences")
        updated = await http.put(
            "/api/v1/reminders/preferences",
            headers={"X-CSRF-Token": "csrf-token"},
            json=VALID_UPDATE,
        )

    assert current.status_code == 200
    assert current.json() == {
        "email_enabled": False,
        "before_session_minutes": 30,
        "after_session": True,
        "email_verified": True,
        "delivery_available": True,
    }
    assert updated.status_code == 200
    assert updated.json() == {**VALID_UPDATE, "email_verified": True, "delivery_available": True}
    assert reminders.updates == [(ACCOUNT_ID, ReminderPreferences(True, 45, False))]


@pytest.mark.anyio
async def test_reminder_preferences_report_unavailable_delivery_without_a_token() -> None:
    async with client() as http:
        response = await http.get("/api/v1/reminders/preferences")

    assert response.json()["delivery_available"] is False


@pytest.mark.anyio
@pytest.mark.parametrize("minutes", (0, 30, 120))
async def test_reminder_preferences_accept_off_and_supported_lead_times(minutes: int) -> None:
    async with client() as http:
        response = await http.put(
            "/api/v1/reminders/preferences",
            headers={"X-CSRF-Token": "csrf-token"},
            json={**VALID_UPDATE, "before_session_minutes": minutes},
        )

    assert response.status_code == 200
    assert response.json()["before_session_minutes"] == minutes


@pytest.mark.anyio
@pytest.mark.parametrize(
    "payload",
    (
        {**VALID_UPDATE, "before_session_minutes": 5},
        {**VALID_UPDATE, "before_session_minutes": 10},
        {**VALID_UPDATE, "before_session_minutes": 29},
        {**VALID_UPDATE, "before_session_minutes": 121},
        {**VALID_UPDATE, "before_session_minutes": -1},
        {**VALID_UPDATE, "before_session_minutes": "soon"},
        {"email_enabled": True, "after_session": True},
        {**VALID_UPDATE, "email_enabled": "maybe"},
    ),
)
async def test_reminder_preferences_reject_invalid_values(payload: dict[str, object]) -> None:
    reminders = ReminderSettingsStub()
    async with client(reminders=reminders) as http:
        response = await http.put(
            "/api/v1/reminders/preferences",
            headers={"X-CSRF-Token": "csrf-token"},
            json=payload,
        )

    assert response.status_code == 422
    assert reminders.updates == []


@pytest.mark.anyio
async def test_reminder_preferences_require_authentication_and_csrf() -> None:
    reminders = ReminderSettingsStub()
    async with client(principal=None, reminders=reminders) as http:
        unauthenticated = await http.get("/api/v1/reminders/preferences")
        missing_csrf = await http.put("/api/v1/reminders/preferences", json=VALID_UPDATE)
        invalid_csrf = await http.put(
            "/api/v1/reminders/preferences",
            headers={"X-CSRF-Token": "wrong"},
            json=VALID_UPDATE,
        )

    assert unauthenticated.status_code == 401
    assert missing_csrf.status_code == 403
    assert invalid_csrf.status_code == 403
    assert reminders.updates == []


@pytest.mark.anyio
async def test_reminder_preferences_return_401_for_a_deleted_account() -> None:
    async with client(reminders=ReminderSettingsStub(state=None)) as http:
        current = await http.get("/api/v1/reminders/preferences")
        updated = await http.put(
            "/api/v1/reminders/preferences",
            headers={"X-CSRF-Token": "csrf-token"},
            json=VALID_UPDATE,
        )

    assert current.status_code == 401
    assert updated.status_code == 401


@pytest.mark.anyio
async def test_reminder_preferences_service_validates_and_delegates() -> None:
    stub = ReminderSettingsStub()
    service = ReminderPreferencesService(stub)

    assert await service.get(ACCOUNT_ID) == stub.state
    with pytest.raises(ValueError, match="before_session_minutes"):
        await service.update(ACCOUNT_ID, ReminderPreferences(True, 29, True))
    assert await service.update(ACCOUNT_ID, ReminderPreferences(True, 0, True)) is not None
    assert stub.updates == [(ACCOUNT_ID, ReminderPreferences(True, 0, True))]


@pytest.mark.anyio
async def test_dispatch_is_hidden_when_no_token_is_configured() -> None:
    dispatch = DispatchStub()
    async with client(dispatch=dispatch) as http:
        response = await http.post(
            "/api/v1/internal/reminders/dispatch",
            headers={"Authorization": f"Bearer {TOKEN}"},
        )

    assert response.status_code == 404
    assert dispatch.calls == 0


@pytest.mark.anyio
@pytest.mark.parametrize(
    "headers",
    (
        {},
        {"Authorization": ""},
        {"Authorization": "Bearer"},
        {"Authorization": "Bearer wrong-token"},
        {"Authorization": f"Basic {TOKEN}"},
        {"Authorization": f"Bearer {TOKEN}x"},
        {"Authorization": f"Bearer {TOKEN} "},
    ),
)
async def test_dispatch_rejects_missing_or_invalid_tokens(headers: dict[str, str]) -> None:
    dispatch = DispatchStub()
    async with client(principal=None, dispatch=dispatch, token=TOKEN) as http:
        response = await http.post("/api/v1/internal/reminders/dispatch", headers=headers)

    assert response.status_code == 401
    assert response.headers["WWW-Authenticate"] == "Bearer"
    assert dispatch.calls == 0


@pytest.mark.anyio
async def test_dispatch_runs_with_the_bearer_token_and_no_session_cookie() -> None:
    dispatch = DispatchStub()
    app = create_app(settings=settings(TOKEN), reminder_dispatch=dispatch)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://test") as http:
        response = await http.post(
            "/api/v1/internal/reminders/dispatch",
            headers={"Authorization": f"bearer {TOKEN}"},
        )

    assert response.status_code == 200
    assert response.json() == {"sent_before": 2, "sent_after": 1, "skipped": 3, "failed": 0}
    assert dispatch.calls == 1


@pytest.mark.anyio
async def test_dispatch_matches_a_token_whose_configured_whitespace_was_stripped() -> None:
    dispatch = DispatchStub()
    app = create_app(
        settings=Settings(
            environment=Environment.TEST,
            reminder_dispatch_token=SecretStr(f"\n{TOKEN}\n"),
        ),
        reminder_dispatch=dispatch,
    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://test") as http:
        response = await http.post(
            "/api/v1/internal/reminders/dispatch",
            headers={"Authorization": f"Bearer {TOKEN}"},
        )

    assert response.status_code == 200
    assert dispatch.calls == 1
