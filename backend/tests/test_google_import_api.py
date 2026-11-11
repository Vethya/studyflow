from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest
from httpx import ASGITransport, AsyncClient

from studyflow.app import create_app
from studyflow.auth.rate_limits import GoogleImportStartRateLimitExceeded
from studyflow.auth.session_authentication import SessionPrincipal
from studyflow.integrations.google_import import (
    CalendarImportItem,
    CalendarImportPreview,
    CalendarImportResult,
    CalendarPreviewItem,
    ClassroomImportFailure,
    ClassroomImportItem,
    ClassroomImportPreview,
    ClassroomImportResult,
    ClassroomPreviewItem,
    ClassroomSelection,
    GoogleImportNotConfiguredError,
    GoogleImportNotFoundError,
    GoogleImportPermissionError,
    GoogleImportProviderUnavailableError,
    GoogleImportSource,
    GoogleImportStart,
    GoogleImportStatus,
    InvalidGoogleImportCallbackError,
    UnconfiguredGoogleImports,
    UnknownGoogleImportItemError,
)
from studyflow.settings import Environment, Settings
from studyflow.tasks.service import TaskCategory, TaskPriority

ACCOUNT_ID = UUID("5b15bfef-8c44-45d5-a70e-574beb999fb3")
CALENDAR_IMPORT = UUID("11111111-1111-4111-8111-111111111111")
CLASSROOM_IMPORT = UUID("33333333-3333-4333-8333-333333333333")
ITEM_ID = "a" * 64
STATE = "state-state-state-state-state"
NOW = datetime(2026, 9, 18, 8, tzinfo=UTC)
BASE = "/api/v1/integrations/google"


class AuthenticationStub:
    async def authenticate(
        self, session_token: str, csrf_token: str | None = None
    ) -> SessionPrincipal | None:
        if csrf_token is not None and csrf_token != "csrf-token":
            return None
        return SessionPrincipal(ACCOUNT_ID, "student@example.com", "Student")

    async def revoke(self, session_token: str, csrf_token: str) -> bool:
        return False


@dataclass
class RateLimitStub:
    exceeded: bool = False
    calls: list[tuple[str, str]] = field(default_factory=list)

    async def check(self, client_ip: str, account_id: str) -> None:
        self.calls.append((client_ip, account_id))
        if self.exceeded:
            raise GoogleImportStartRateLimitExceeded


@dataclass
class ImportsStub:
    complete_error: Exception | None = None
    starts: list[tuple[GoogleImportSource, int]] = field(default_factory=list)
    classroom_selections: list[ClassroomSelection] = field(default_factory=list)

    @property
    def configured(self) -> bool:
        return True

    async def status(self, account_id: UUID) -> GoogleImportStatus:
        return GoogleImportStatus(True, {GoogleImportSource.CLASSROOM: NOW})

    async def start(
        self, account_id: UUID, source: GoogleImportSource, horizon_days: int
    ) -> GoogleImportStart:
        assert account_id == ACCOUNT_ID
        self.starts.append((source, horizon_days))
        return GoogleImportStart("https://accounts.google.com/o/oauth2/v2/auth?state=x", STATE)

    async def complete(self, code: str, state: str, state_cookie: str) -> UUID:
        assert (code, state, state_cookie) == ("code", STATE, STATE)
        if self.complete_error is not None:
            raise self.complete_error
        return CALENDAR_IMPORT

    async def preview(
        self, account_id: UUID, snapshot_id: UUID
    ) -> CalendarImportPreview | ClassroomImportPreview:
        if snapshot_id == CALENDAR_IMPORT:
            return CalendarImportPreview(
                CALENDAR_IMPORT,
                NOW + timedelta(minutes=30),
                [
                    CalendarPreviewItem(
                        CalendarImportItem(ITEM_ID, "Shift", NOW, NOW + timedelta(hours=2), False),
                        "changed",
                    )
                ],
            )
        if snapshot_id == CLASSROOM_IMPORT:
            return ClassroomImportPreview(
                CLASSROOM_IMPORT,
                NOW + timedelta(minutes=30),
                [
                    ClassroomPreviewItem(
                        ClassroomImportItem(
                            ITEM_ID,
                            "Lab report",
                            "Physics",
                            NOW + timedelta(days=2),
                            None,
                            TaskCategory.ASSIGNMENT,
                        ),
                        "new",
                    )
                ],
            )
        raise GoogleImportNotFoundError

    async def import_calendar(
        self, account_id: UUID, snapshot_id: UUID, item_ids: Sequence[str]
    ) -> CalendarImportResult:
        if snapshot_id != CALENDAR_IMPORT:
            raise GoogleImportNotFoundError
        if item_ids[0] != ITEM_ID:
            raise UnknownGoogleImportItemError("A selected item is not part of this import")
        return CalendarImportResult(1, 0, 0, 0, [UUID("22222222-2222-4222-8222-222222222222")])

    async def import_classroom(
        self, account_id: UUID, snapshot_id: UUID, selections: Sequence[ClassroomSelection]
    ) -> ClassroomImportResult:
        if snapshot_id != CLASSROOM_IMPORT:
            raise GoogleImportNotFoundError
        self.classroom_selections.extend(selections)
        return ClassroomImportResult(
            [UUID("44444444-4444-4444-8444-444444444444")],
            [],
            [ClassroomImportFailure("b" * 64, "deadline_passed")],
        )

    async def discard(self, account_id: UUID, snapshot_id: UUID) -> bool:
        return snapshot_id == CALENDAR_IMPORT


def client(
    imports: object | None = None,
    rate_limit: RateLimitStub | None = None,
    environment: Environment = Environment.TEST,
) -> AsyncClient:
    app = create_app(
        settings=Settings(environment=environment)
        if environment is not Environment.PRODUCTION
        else None,
        session_authentication=AuthenticationStub(),
        google_imports=imports or ImportsStub(),  # type: ignore[arg-type]
        google_import_start_rate_limiter=rate_limit or RateLimitStub(),
    )
    return AsyncClient(
        transport=ASGITransport(app=app),
        base_url="https://test",
        cookies={"studyflow_session": "session-token"},
        headers={"X-CSRF-Token": "csrf-token"},
    )


@pytest.mark.anyio
async def test_status_reports_configuration_and_requires_a_session() -> None:
    async with client() as http:
        configured = await http.get(f"{BASE}/status")
    async with client(UnconfiguredGoogleImports()) as http:
        unconfigured = await http.get(f"{BASE}/status")
    app = create_app(settings=Settings(environment=Environment.TEST))
    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://test") as http:
        anonymous = await http.get(f"{BASE}/status")

    assert configured.json() == {
        "configured": True,
        "calendar_checked_at": None,
        "classroom_checked_at": "2026-09-18T08:00:00Z",
    }
    assert unconfigured.json() == {
        "configured": False,
        "calendar_checked_at": None,
        "classroom_checked_at": None,
    }
    assert anonymous.status_code == 401


@pytest.mark.anyio
async def test_start_sets_an_http_only_state_cookie_and_is_rate_limited() -> None:
    imports = ImportsStub()
    rate_limit = RateLimitStub()
    async with client(imports, rate_limit) as http:
        calendar = await http.post(f"{BASE}/calendar/start", json={"horizon_days": 14})
        classroom = await http.post(f"{BASE}/classroom/start", json={})
        await http.post(f"{BASE}/calendar/start", json={})
        too_far = await http.post(f"{BASE}/calendar/start", json={"horizon_days": 91})
        unexpected = await http.post(f"{BASE}/classroom/start", json={"scope": "calendar"})
        no_csrf = await http.post(f"{BASE}/calendar/start", json={}, headers={"X-CSRF-Token": ""})

    assert calendar.status_code == 200
    assert calendar.json() == {
        "authorization_url": "https://accounts.google.com/o/oauth2/v2/auth?state=x"
    }
    cookie = calendar.headers["set-cookie"].lower()
    assert f"studyflow_google_import_state={STATE}" in cookie
    assert "httponly" in cookie
    assert "samesite=lax" in cookie
    assert calendar.headers["cache-control"] == "no-store"
    assert classroom.status_code == 200
    assert imports.starts == [
        (GoogleImportSource.CALENDAR, 14),
        (GoogleImportSource.CLASSROOM, 28),
        (GoogleImportSource.CALENDAR, 28),
    ]
    assert rate_limit.calls[0] == ("127.0.0.1", str(ACCOUNT_ID))
    assert too_far.status_code == 422
    assert unexpected.status_code == 422
    assert no_csrf.status_code == 403

    async with client(rate_limit=RateLimitStub(exceeded=True)) as http:
        limited = await http.post(f"{BASE}/calendar/start", json={})
    assert limited.status_code == 429
    assert limited.headers["retry-after"] == "900"


@pytest.mark.anyio
async def test_start_reports_missing_configuration_and_accounts() -> None:
    class MissingAccount(ImportsStub):
        async def start(
            self, account_id: UUID, source: GoogleImportSource, horizon_days: int
        ) -> GoogleImportStart:
            raise GoogleImportNotFoundError

    async with client(UnconfiguredGoogleImports()) as http:
        unconfigured = await http.post(f"{BASE}/calendar/start", json={})
    async with client(MissingAccount()) as http:
        missing = await http.post(f"{BASE}/calendar/start", json={})

    assert unconfigured.status_code == 503
    assert unconfigured.json() == {"detail": "Google import is not configured"}
    assert missing.status_code == 401


@pytest.mark.anyio
async def test_callback_redirects_to_the_preview_and_clears_the_state_cookie() -> None:
    async with client() as http:
        http.cookies.set("studyflow_google_import_state", STATE)
        response = await http.get(f"{BASE}/callback", params={"code": "code", "state": STATE})

    assert response.status_code == 303
    assert response.headers["location"] == f"http://localhost:3000/import/google/{CALENDAR_IMPORT}"
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["referrer-policy"] == "no-referrer"
    assert 'studyflow_google_import_state=""' in response.headers["set-cookie"]


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("params", "with_cookie", "error", "code"),
    [
        ({"error": "access_denied", "state": STATE}, True, None, "denied"),
        ({"error": "server_error"}, True, None, "invalid"),
        ({"code": "code", "state": STATE}, False, None, "invalid"),
        ({"state": STATE}, True, None, "invalid"),
        ({"code": "code", "state": STATE}, True, InvalidGoogleImportCallbackError(), "invalid"),
        ({"code": "code", "state": STATE}, True, GoogleImportPermissionError(), "permission"),
        (
            {"code": "code", "state": STATE},
            True,
            GoogleImportProviderUnavailableError(),
            "unavailable",
        ),
        (
            {"code": "code", "state": STATE},
            True,
            GoogleImportNotConfiguredError(),
            "not-configured",
        ),
    ],
)
async def test_callback_failures_redirect_with_a_generic_error_code(
    params: dict[str, str], with_cookie: bool, error: Exception | None, code: str
) -> None:
    async with client(ImportsStub(complete_error=error)) as http:
        if with_cookie:
            http.cookies.set("studyflow_google_import_state", STATE)
        response = await http.get(f"{BASE}/callback", params=params)

    assert response.status_code == 303
    assert response.headers["location"] == f"http://localhost:3000/import/google?error={code}"


@pytest.mark.anyio
async def test_previews_are_typed_by_source() -> None:
    async with client() as http:
        calendar = await http.get(f"{BASE}/imports/{CALENDAR_IMPORT}")
        classroom = await http.get(f"{BASE}/imports/{CLASSROOM_IMPORT}")
        missing = await http.get(f"{BASE}/imports/55555555-5555-4555-8555-555555555555")
    async with client(UnconfiguredGoogleImports()) as http:
        unconfigured = await http.get(f"{BASE}/imports/{CALENDAR_IMPORT}")

    assert calendar.status_code == 200
    assert calendar.headers["cache-control"] == "no-store"
    assert calendar.json() == {
        "id": str(CALENDAR_IMPORT),
        "source": "google_calendar",
        "expires_at": "2026-09-18T08:30:00Z",
        "items": [
            {
                "id": ITEM_ID,
                "title": "Shift",
                "starts_at": "2026-09-18T08:00:00Z",
                "ends_at": "2026-09-18T10:00:00Z",
                "all_day": False,
                "status": "changed",
            }
        ],
    }
    assert classroom.json()["source"] == "google_classroom"
    assert classroom.json()["items"][0] == {
        "id": ITEM_ID,
        "title": "Lab report",
        "course": "Physics",
        "due_at": "2026-09-20T08:00:00Z",
        "link": None,
        "suggested_category": "assignment",
        "status": "new",
    }
    assert missing.status_code == 404
    assert missing.json() == {"detail": "Import not found or expired"}
    assert unconfigured.status_code == 503


@pytest.mark.anyio
async def test_calendar_import_confirmation_contract() -> None:
    async with client() as http:
        imported = await http.post(
            f"{BASE}/imports/{CALENDAR_IMPORT}/calendar", json={"item_ids": [ITEM_ID]}
        )
        unknown = await http.post(
            f"{BASE}/imports/{CALENDAR_IMPORT}/calendar", json={"item_ids": ["b" * 64]}
        )
        wrong_import = await http.post(
            f"{BASE}/imports/{CLASSROOM_IMPORT}/calendar", json={"item_ids": [ITEM_ID]}
        )
        empty = await http.post(f"{BASE}/imports/{CALENDAR_IMPORT}/calendar", json={"item_ids": []})
        malformed = await http.post(
            f"{BASE}/imports/{CALENDAR_IMPORT}/calendar", json={"item_ids": ["short"]}
        )
    async with client(UnconfiguredGoogleImports()) as http:
        unconfigured = await http.post(
            f"{BASE}/imports/{CALENDAR_IMPORT}/calendar", json={"item_ids": [ITEM_ID]}
        )

    assert imported.status_code == 200
    assert imported.json() == {
        "created": 1,
        "updated": 0,
        "unchanged": 0,
        "skipped_past": 0,
        "invalidated_future_session_ids": ["22222222-2222-4222-8222-222222222222"],
    }
    assert unknown.status_code == 422
    assert wrong_import.status_code == 404
    assert empty.status_code == 422
    assert malformed.status_code == 422
    assert unconfigured.status_code == 503


@pytest.mark.anyio
async def test_classroom_import_confirmation_contract() -> None:
    imports = ImportsStub()
    selection = {"id": ITEM_ID, "category": "project", "priority": "high", "estimate_minutes": 120}
    async with client(imports) as http:
        imported = await http.post(
            f"{BASE}/imports/{CLASSROOM_IMPORT}/classroom", json={"items": [selection]}
        )
        wrong_import = await http.post(
            f"{BASE}/imports/{CALENDAR_IMPORT}/classroom", json={"items": [selection]}
        )
        too_long = await http.post(
            f"{BASE}/imports/{CLASSROOM_IMPORT}/classroom",
            json={"items": [{**selection, "estimate_minutes": 10081}]},
        )
    async with client(UnconfiguredGoogleImports()) as http:
        unconfigured = await http.post(
            f"{BASE}/imports/{CLASSROOM_IMPORT}/classroom", json={"items": [selection]}
        )

    assert imported.status_code == 200
    assert imported.json() == {
        "created_task_ids": ["44444444-4444-4444-8444-444444444444"],
        "already_imported": [],
        "failed": [{"id": "b" * 64, "reason": "deadline_passed"}],
    }
    assert imports.classroom_selections == [
        ClassroomSelection(ITEM_ID, TaskCategory.PROJECT, TaskPriority.HIGH, 120)
    ]
    assert wrong_import.status_code == 404
    assert too_long.status_code == 422
    assert unconfigured.status_code == 503


@pytest.mark.anyio
async def test_classroom_import_reports_invalid_selections() -> None:
    class Rejecting(ImportsStub):
        async def import_classroom(
            self, account_id: UUID, snapshot_id: UUID, selections: Sequence[ClassroomSelection]
        ) -> ClassroomImportResult:
            raise UnknownGoogleImportItemError("A selected item is not part of this import")

    selection = {"id": ITEM_ID, "category": "project", "estimate_minutes": 60}
    async with client(Rejecting()) as http:
        response = await http.post(
            f"{BASE}/imports/{CLASSROOM_IMPORT}/classroom", json={"items": [selection]}
        )

    assert response.status_code == 422
    assert response.json() == {"detail": "A selected item is not part of this import"}


@pytest.mark.anyio
async def test_discarding_an_import() -> None:
    async with client() as http:
        discarded = await http.delete(f"{BASE}/imports/{CALENDAR_IMPORT}")
        missing = await http.delete(f"{BASE}/imports/{CLASSROOM_IMPORT}")
    async with client(UnconfiguredGoogleImports()) as http:
        unconfigured = await http.delete(f"{BASE}/imports/{CALENDAR_IMPORT}")

    assert discarded.status_code == 204
    assert missing.status_code == 404
    assert unconfigured.status_code == 503


def test_production_uses_host_prefixed_import_state_cookie() -> None:
    from studyflow.auth.cookies import CookiePolicy

    assert (
        CookiePolicy.for_environment(Environment.PRODUCTION).google_import_state_name
        == "__Host-studyflow_google_import_state"
    )
