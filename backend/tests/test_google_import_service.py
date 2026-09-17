from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import parse_qs, urlsplit
from uuid import UUID, uuid4

import pytest

from studyflow.integrations.google_import import (
    CalendarImportItem,
    CalendarImportPreview,
    CalendarImportResult,
    ClassroomImportItem,
    ClassroomImportPreview,
    ClassroomSelection,
    ExistingCalendarPeriod,
    GoogleImportAccount,
    GoogleImportNotConfiguredError,
    GoogleImportNotFoundError,
    GoogleImportPermissionError,
    GoogleImportService,
    GoogleImportSource,
    GrantedGoogleToken,
    InvalidGoogleImportCallbackError,
    PendingGoogleImport,
    StoredImportSnapshot,
    UnconfiguredGoogleImports,
    UnknownGoogleImportItemError,
    external_item_id,
    hash_import_state,
    pkce_challenge,
)
from studyflow.tasks.service import (
    AcademicTaskRecord,
    DuplicateExternalTaskError,
    InvalidTaskDeadlineError,
    NewAcademicTask,
    TaskCategory,
    TaskFilters,
    TaskPriority,
)

ACCOUNT_ID = UUID("5b15bfef-8c44-45d5-a70e-574beb999fb3")
NOW = datetime(2026, 9, 18, 8, tzinfo=UTC)
STATE = "s" * 43
VERIFIER = "v" * 86
ACCESS_TOKEN = "ya29.never-stored-access-token"
CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events.readonly"
CLASSROOM_SCOPES = (
    "https://www.googleapis.com/auth/classroom.courses.readonly "
    "https://www.googleapis.com/auth/classroom.coursework.me.readonly"
)


@dataclass
class FakeRepository:
    pending: PendingGoogleImport | None = None
    snapshot: StoredImportSnapshot | None = None
    stored_states: list[tuple[Any, ...]] = field(default_factory=list)
    stored_snapshots: list[tuple[Any, ...]] = field(default_factory=list)
    imported_classroom: set[str] = field(default_factory=set)
    existing_periods: dict[str, ExistingCalendarPeriod] = field(default_factory=dict)
    claims: int = 0

    async def account(self, account_id: UUID) -> GoogleImportAccount | None:
        return (
            GoogleImportAccount("student@example.com", "UTC") if account_id == ACCOUNT_ID else None
        )

    async def store_state(self, *args: Any) -> None:
        self.stored_states.append(args)

    async def consume_state(self, state_hash: str, now: datetime) -> PendingGoogleImport | None:
        if state_hash != hash_import_state(STATE):
            return None
        pending, self.pending = self.pending, None
        return pending

    async def store_snapshot(self, *args: Any) -> UUID:
        self.stored_snapshots.append(args)
        return UUID("11111111-1111-4111-8111-111111111111")

    async def open_snapshot(
        self, account_id: UUID, snapshot_id: UUID, now: datetime
    ) -> StoredImportSnapshot | None:
        if self.snapshot is None or account_id != ACCOUNT_ID or snapshot_id != self.snapshot.id:
            return None
        return self.snapshot

    async def claim_snapshot(
        self, account_id: UUID, snapshot_id: UUID, source: GoogleImportSource, now: datetime
    ) -> StoredImportSnapshot | None:
        snapshot = await self.open_snapshot(account_id, snapshot_id, now)
        if snapshot is None or snapshot.source is not source:
            return None
        self.claims += 1
        self.snapshot = None
        return snapshot

    async def discard_snapshot(self, account_id: UUID, snapshot_id: UUID, now: datetime) -> bool:
        return await self.open_snapshot(account_id, snapshot_id, now) is not None

    async def calendar_periods(
        self, account_id: UUID, external_ids: Sequence[str]
    ) -> dict[str, ExistingCalendarPeriod]:
        return self.existing_periods

    async def classroom_task_ids(self, account_id: UUID, external_ids: Sequence[str]) -> set[str]:
        return self.imported_classroom & set(external_ids)

    async def import_calendar(
        self, account_id: UUID, snapshot_id: UUID, item_ids: Sequence[str], now: datetime
    ) -> CalendarImportResult | None:
        if await self.open_snapshot(account_id, snapshot_id, now) is None:
            return None
        return CalendarImportResult(len(item_ids), 0, 0, 0, [])


@dataclass
class FakeClient:
    scopes: str = CALENDAR_SCOPE
    events: list[dict[str, Any]] = field(default_factory=list)
    coursework: list[dict[str, Any]] = field(default_factory=list)
    exchanges: list[tuple[str, str]] = field(default_factory=list)
    calendar_windows: list[tuple[datetime, datetime]] = field(default_factory=list)

    async def exchange_code(self, code: str, code_verifier: str) -> GrantedGoogleToken:
        self.exchanges.append((code, code_verifier))
        return GrantedGoogleToken(ACCESS_TOKEN, frozenset(self.scopes.split()))

    async def calendar_events(
        self, access_token: str, time_min: datetime, time_max: datetime
    ) -> list[dict[str, Any]]:
        assert access_token == ACCESS_TOKEN
        self.calendar_windows.append((time_min, time_max))
        return self.events

    async def classroom_coursework(self, access_token: str) -> list[dict[str, Any]]:
        assert access_token == ACCESS_TOKEN
        return self.coursework


@dataclass
class FakeTasks:
    created: list[NewAcademicTask] = field(default_factory=list)
    duplicate_ids: set[str] = field(default_factory=set)
    invalid_deadline_ids: set[str] = field(default_factory=set)

    async def create(self, account_id: UUID, task: NewAcademicTask) -> AcademicTaskRecord:
        if task.external_id in self.duplicate_ids:
            raise DuplicateExternalTaskError
        if task.external_id in self.invalid_deadline_ids:
            raise InvalidTaskDeadlineError
        self.created.append(task)
        return AcademicTaskRecord(
            id=uuid4(),
            account_id=account_id,
            title=task.title,
            category=task.category,
            priority=task.priority,
            course=task.course,
            notes=task.notes,
            deadline_at=task.deadline_at,
            original_estimate_minutes=task.original_estimate_minutes,
            planned_duration_minutes=task.original_estimate_minutes,
            created_at=NOW,
            updated_at=NOW,
        )

    async def list(
        self, account_id: UUID, filters: TaskFilters | None = None
    ) -> list[AcademicTaskRecord]:
        raise AssertionError("not used")

    async def get(self, account_id: UUID, task_id: UUID) -> AcademicTaskRecord | None:
        raise AssertionError("not used")

    async def update(
        self, account_id: UUID, task_id: UUID, task: NewAcademicTask
    ) -> AcademicTaskRecord | None:
        raise AssertionError("not used")

    async def delete(self, account_id: UUID, task_id: UUID) -> bool:
        raise AssertionError("not used")

    async def finish_early(self, account_id: UUID, task_id: UUID) -> bool:
        raise AssertionError("not used")

    async def mark_started(self, account_id: UUID, task_id: UUID) -> bool:
        raise AssertionError("not used")


def service(
    repository: FakeRepository | None = None,
    client: FakeClient | None = None,
    tasks: FakeTasks | None = None,
) -> tuple[GoogleImportService, FakeRepository, FakeClient, FakeTasks]:
    repository = repository or FakeRepository()
    client = client or FakeClient()
    tasks = tasks or FakeTasks()
    return (
        GoogleImportService(
            repository,
            client,
            tasks,
            "client-id.apps.googleusercontent.com",
            "https://studyflow.example/api/v1/integrations/google/callback",
            token_factory=lambda: STATE,
            verifier_factory=lambda: VERIFIER,
            clock=lambda: NOW,
        ),
        repository,
        client,
        tasks,
    )


@pytest.mark.anyio
async def test_start_requests_only_read_only_scopes_with_pkce_and_no_refresh_token() -> None:
    imports, repository, _, _ = service()

    started = await imports.start(ACCOUNT_ID, GoogleImportSource.CLASSROOM, 28)

    url = urlsplit(started.authorization_url)
    query = {key: values[0] for key, values in parse_qs(url.query).items()}
    assert f"{url.scheme}://{url.netloc}{url.path}" == (
        "https://accounts.google.com/o/oauth2/v2/auth"
    )
    assert query["scope"] == CLASSROOM_SCOPES
    assert query["code_challenge"] == pkce_challenge(VERIFIER)
    assert query["code_challenge_method"] == "S256"
    assert query["access_type"] == "online"
    assert query["include_granted_scopes"] == "false"
    assert query["state"] == STATE
    assert query["login_hint"] == "student@example.com"
    assert "client_secret" not in query
    assert started.state == STATE
    stored = repository.stored_states[0]
    assert stored[1] == hash_import_state(STATE)
    assert STATE not in stored
    assert stored[-1] - stored[-2] == timedelta(minutes=10)


@pytest.mark.anyio
async def test_start_rejects_unknown_accounts_and_out_of_range_horizons() -> None:
    imports, _, _, _ = service()

    with pytest.raises(GoogleImportNotFoundError):
        await imports.start(uuid4(), GoogleImportSource.CALENDAR, 28)
    with pytest.raises(ValueError, match="horizon_days"):
        await imports.start(ACCOUNT_ID, GoogleImportSource.CALENDAR, 91)


@pytest.mark.anyio
async def test_callback_requires_matching_cookie_and_an_unused_state() -> None:
    imports, repository, client, _ = service()

    with pytest.raises(InvalidGoogleImportCallbackError):
        await imports.complete("code", STATE, "another-browser-state")
    with pytest.raises(InvalidGoogleImportCallbackError):
        await imports.complete("code", STATE, STATE)

    assert client.exchanges == []
    assert repository.stored_snapshots == []


@pytest.mark.anyio
async def test_callback_rejects_a_token_missing_a_required_scope() -> None:
    repository = FakeRepository(
        pending=PendingGoogleImport(ACCOUNT_ID, GoogleImportSource.CLASSROOM, VERIFIER, 28)
    )
    imports, _, _, _ = service(
        repository,
        FakeClient(scopes="https://www.googleapis.com/auth/classroom.courses.readonly"),
    )

    with pytest.raises(GoogleImportPermissionError):
        await imports.complete("code", STATE, STATE)
    assert repository.stored_snapshots == []


@pytest.mark.anyio
async def test_calendar_callback_stores_a_short_lived_snapshot_without_the_token() -> None:
    repository = FakeRepository(
        pending=PendingGoogleImport(ACCOUNT_ID, GoogleImportSource.CALENDAR, VERIFIER, 14)
    )
    client = FakeClient(
        events=[
            {
                "id": "event-1",
                "summary": "Part-time shift",
                "start": {"dateTime": "2026-09-19T10:00:00Z"},
                "end": {"dateTime": "2026-09-19T14:00:00Z"},
            }
        ]
    )
    imports, _, _, _ = service(repository, client)

    snapshot_id = await imports.complete("auth-code", STATE, STATE)

    assert snapshot_id == UUID("11111111-1111-4111-8111-111111111111")
    assert client.exchanges == [("auth-code", VERIFIER)]
    assert client.calendar_windows == [(NOW, NOW + timedelta(days=14))]
    account_id, source, items, now, expires_at = repository.stored_snapshots[0]
    assert (account_id, source, now) == (ACCOUNT_ID, GoogleImportSource.CALENDAR, NOW)
    assert expires_at == NOW + timedelta(minutes=30)
    assert items == [
        {
            "id": external_item_id("primary", "event-1"),
            "title": "Part-time shift",
            "starts_at": "2026-09-19T10:00:00+00:00",
            "ends_at": "2026-09-19T14:00:00+00:00",
            "all_day": False,
        }
    ]
    assert ACCESS_TOKEN not in repr(repository.stored_snapshots)
    assert ACCESS_TOKEN not in repr(repository.stored_states)


@pytest.mark.anyio
async def test_classroom_callback_maps_coursework() -> None:
    repository = FakeRepository(
        pending=PendingGoogleImport(ACCOUNT_ID, GoogleImportSource.CLASSROOM, VERIFIER, 28)
    )
    client = FakeClient(
        scopes=CLASSROOM_SCOPES,
        coursework=[
            {
                "id": "work-1",
                "courseId": "course-1",
                "courseName": "Physics",
                "title": "Lab report",
                "dueDate": {"year": 2026, "month": 9, "day": 30},
            }
        ],
    )
    imports, _, _, _ = service(repository, client)

    await imports.complete("code", STATE, STATE)

    items = repository.stored_snapshots[0][2]
    assert [item["title"] for item in items] == ["Lab report"]


def calendar_snapshot() -> StoredImportSnapshot:
    items = [
        CalendarImportItem(
            external_item_id("primary", name),
            name,
            NOW + timedelta(days=1),
            NOW + timedelta(days=1, hours=2),
            False,
        )
        for name in ("new", "same", "moved")
    ]
    return StoredImportSnapshot(
        uuid4(), GoogleImportSource.CALENDAR, [item.to_json() for item in items], NOW
    )


@pytest.mark.anyio
async def test_calendar_preview_marks_new_changed_and_unchanged_items() -> None:
    snapshot = calendar_snapshot()
    repository = FakeRepository(
        snapshot=snapshot,
        existing_periods={
            external_item_id("primary", "same"): ExistingCalendarPeriod(
                NOW + timedelta(days=1), NOW + timedelta(days=1, hours=2), "same"
            ),
            external_item_id("primary", "moved"): ExistingCalendarPeriod(
                NOW + timedelta(days=2), NOW + timedelta(days=2, hours=2), "moved"
            ),
        },
    )
    imports, _, _, _ = service(repository)

    preview = await imports.preview(ACCOUNT_ID, snapshot.id)

    assert isinstance(preview, CalendarImportPreview)
    assert [(entry.item.title, entry.status) for entry in preview.items] == [
        ("new", "new"),
        ("same", "unchanged"),
        ("moved", "changed"),
    ]
    with pytest.raises(GoogleImportNotFoundError):
        await imports.preview(uuid4(), snapshot.id)


@pytest.mark.anyio
async def test_calendar_import_rejects_empty_or_repeated_selections() -> None:
    snapshot = calendar_snapshot()
    imports, _, _, _ = service(FakeRepository(snapshot=snapshot))
    item_id = snapshot.items[0]["id"]

    with pytest.raises(UnknownGoogleImportItemError):
        await imports.import_calendar(ACCOUNT_ID, snapshot.id, [])
    with pytest.raises(UnknownGoogleImportItemError):
        await imports.import_calendar(ACCOUNT_ID, snapshot.id, [item_id, item_id])
    with pytest.raises(GoogleImportNotFoundError):
        await imports.import_calendar(ACCOUNT_ID, uuid4(), [item_id])
    result = await imports.import_calendar(ACCOUNT_ID, snapshot.id, [item_id])
    assert result.created == 1


def classroom_snapshot() -> StoredImportSnapshot:
    items = [
        ClassroomImportItem(
            external_item_id("course", name),
            name,
            "Physics",
            NOW + due,
            "https://classroom.google.com/c/1/a/2/details",
            TaskCategory.ASSIGNMENT,
        )
        for name, due in (
            ("fresh", timedelta(days=3)),
            ("imported", timedelta(days=4)),
            ("expired", timedelta(hours=-1)),
            ("race", timedelta(days=5)),
        )
    ]
    return StoredImportSnapshot(
        uuid4(), GoogleImportSource.CLASSROOM, [item.to_json() for item in items], NOW
    )


def selection(snapshot: StoredImportSnapshot, index: int, minutes: int = 90) -> ClassroomSelection:
    return ClassroomSelection(
        snapshot.items[index]["id"], TaskCategory.PROJECT, TaskPriority.HIGH, minutes
    )


@pytest.mark.anyio
async def test_classroom_import_creates_selected_tasks_once() -> None:
    snapshot = classroom_snapshot()
    repository = FakeRepository(snapshot=snapshot, imported_classroom={snapshot.items[1]["id"]})
    tasks = FakeTasks(duplicate_ids={snapshot.items[3]["id"]})
    imports, _, _, _ = service(repository, tasks=tasks)

    preview = await imports.preview(ACCOUNT_ID, snapshot.id)
    assert isinstance(preview, ClassroomImportPreview)
    assert [entry.status for entry in preview.items] == [
        "new",
        "already_imported",
        "new",
        "new",
    ]

    result = await imports.import_classroom(
        ACCOUNT_ID, snapshot.id, [selection(snapshot, index) for index in range(4)]
    )

    assert len(result.created_task_ids) == 1
    assert result.already_imported == [snapshot.items[1]["id"], snapshot.items[3]["id"]]
    assert [(failure.id, failure.reason) for failure in result.failed] == [
        (snapshot.items[2]["id"], "deadline_passed")
    ]
    created = tasks.created[0]
    assert created.title == "fresh"
    assert created.course == "Physics"
    assert created.category is TaskCategory.PROJECT
    assert created.priority is TaskPriority.HIGH
    assert created.original_estimate_minutes == 90
    assert created.external_source == "google_classroom"
    assert created.external_id == snapshot.items[0]["id"]
    assert created.notes == (
        "Imported from Google Classroom: https://classroom.google.com/c/1/a/2/details"
    )
    assert repository.claims == 1

    with pytest.raises(GoogleImportNotFoundError):
        await imports.import_classroom(ACCOUNT_ID, snapshot.id, [selection(snapshot, 0)])


@pytest.mark.anyio
async def test_classroom_import_validates_selections_before_claiming() -> None:
    snapshot = classroom_snapshot()
    repository = FakeRepository(snapshot=snapshot)
    imports, _, _, _ = service(repository)
    unknown = ClassroomSelection("f" * 64, TaskCategory.OTHER, TaskPriority.LOW, 30)

    with pytest.raises(UnknownGoogleImportItemError):
        await imports.import_classroom(ACCOUNT_ID, snapshot.id, [unknown])
    with pytest.raises(UnknownGoogleImportItemError):
        await imports.import_classroom(ACCOUNT_ID, snapshot.id, [])
    with pytest.raises(ValueError, match="estimate_minutes"):
        await imports.import_classroom(ACCOUNT_ID, snapshot.id, [selection(snapshot, 0, 0)])
    with pytest.raises(GoogleImportNotFoundError):
        await imports.import_classroom(ACCOUNT_ID, uuid4(), [selection(snapshot, 0)])

    assert repository.claims == 0


@pytest.mark.anyio
async def test_classroom_import_reports_deadlines_rejected_by_the_task_service() -> None:
    snapshot = classroom_snapshot()
    tasks = FakeTasks(invalid_deadline_ids={snapshot.items[0]["id"]})
    imports, _, _, _ = service(FakeRepository(snapshot=snapshot), tasks=tasks)

    result = await imports.import_classroom(ACCOUNT_ID, snapshot.id, [selection(snapshot, 0)])

    assert [failure.reason for failure in result.failed] == ["deadline_passed"]


@pytest.mark.anyio
async def test_discard_and_unconfigured_imports() -> None:
    snapshot = calendar_snapshot()
    imports, _, _, _ = service(FakeRepository(snapshot=snapshot))
    unconfigured = UnconfiguredGoogleImports()

    assert imports.configured is True
    assert await imports.discard(ACCOUNT_ID, snapshot.id) is True
    assert unconfigured.configured is False
    for call in (
        unconfigured.start(ACCOUNT_ID, GoogleImportSource.CALENDAR, 28),
        unconfigured.complete("code", STATE, STATE),
        unconfigured.preview(ACCOUNT_ID, snapshot.id),
        unconfigured.import_calendar(ACCOUNT_ID, snapshot.id, ["a"]),
        unconfigured.import_classroom(ACCOUNT_ID, snapshot.id, []),
        unconfigured.discard(ACCOUNT_ID, snapshot.id),
    ):
        with pytest.raises(GoogleImportNotConfiguredError):
            await call
