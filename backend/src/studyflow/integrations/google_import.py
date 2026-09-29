"""One-time, read-only imports from Google Calendar and Google Classroom.

Security model:

* The student starts an import from an authenticated, CSRF-protected request.
  The OAuth ``state`` is random, stored only as a hash, bound to that account,
  single-use, valid for ten minutes, and mirrored in an HttpOnly cookie so the
  callback must return to the same browser.
* The authorization code is exchanged with PKCE (S256) and the client secret.
* Only read-only scopes are requested, and the callback rejects a token that
  does not carry every scope the import needs.
* The access token is used once inside the callback and is never stored,
  logged, or returned. No refresh token is requested.
* What Google returns is reduced to the few fields StudyFlow needs and kept as
  a snapshot that expires after thirty minutes. Nothing becomes a task or a
  blocked period until the student confirms a selection.
"""

import base64
import hashlib
import hmac
import logging
import secrets
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from enum import StrEnum
from typing import Any, Literal, Protocol
from urllib.parse import urlencode
from uuid import UUID
from zoneinfo import ZoneInfo

from studyflow.estimation import AdaptiveEstimateUnavailableError
from studyflow.tasks.service import (
    AcademicTasks,
    DuplicateExternalTaskError,
    InvalidTaskDeadlineError,
    NewAcademicTask,
    TaskCategory,
    TaskPriority,
)

GOOGLE_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"

logger = logging.getLogger(__name__)

STATE_LIFETIME = timedelta(minutes=10)
SNAPSHOT_LIFETIME = timedelta(minutes=30)
DEFAULT_CALENDAR_HORIZON_DAYS = 28
MAX_CALENDAR_HORIZON_DAYS = 90
MAX_CALENDAR_EVENTS = 500
MAX_CLASSROOM_ITEMS = 300
MAX_TASK_ESTIMATE_MINUTES = 7 * 24 * 60

TITLE_LIMIT = 200
COURSE_LIMIT = 100
REASON_LIMIT = 200
LINK_LIMIT = 1000


class GoogleImportSource(StrEnum):
    CALENDAR = "google_calendar"
    CLASSROOM = "google_classroom"


CLASSROOM_COURSEWORK_SCOPE = "https://www.googleapis.com/auth/classroom.coursework.me.readonly"
CLASSROOM_STUDENT_SUBMISSIONS_SCOPE = (
    "https://www.googleapis.com/auth/classroom.student-submissions.me.readonly"
)

GOOGLE_IMPORT_SCOPES: Mapping[GoogleImportSource, tuple[str, ...]] = {
    GoogleImportSource.CALENDAR: ("https://www.googleapis.com/auth/calendar.events.readonly",),
    GoogleImportSource.CLASSROOM: (
        "https://www.googleapis.com/auth/classroom.courses.readonly",
        CLASSROOM_COURSEWORK_SCOPE,
    ),
}


class GoogleImportNotConfiguredError(RuntimeError):
    """Google import credentials or the import redirect URI are not configured."""


class InvalidGoogleImportCallbackError(ValueError):
    """The callback state, cookie, or authorization code did not validate."""


class GoogleImportPermissionError(PermissionError):
    """The student declined, or Google withheld, a permission the import needs."""


class GoogleImportProviderUnavailableError(RuntimeError):
    """Google could not answer because of a temporary failure."""


class GoogleImportNotFoundError(LookupError):
    """The import does not exist for this account, has expired, or was already used."""


class UnknownGoogleImportItemError(ValueError):
    """A selection referenced an item that is not part of the import."""


@dataclass(frozen=True, slots=True)
class GoogleImportStart:
    authorization_url: str
    state: str


@dataclass(frozen=True, slots=True)
class GoogleImportStatus:
    configured: bool
    """When the student last asked Google for each source's data."""
    last_checked: dict[GoogleImportSource, datetime]


@dataclass(frozen=True, slots=True)
class GoogleImportAccount:
    email: str
    timezone: str


@dataclass(frozen=True, slots=True)
class PendingGoogleImport:
    account_id: UUID
    source: GoogleImportSource
    code_verifier: str
    horizon_days: int
    redirect_uri: str | None = None


@dataclass(frozen=True, slots=True)
class GrantedGoogleToken:
    access_token: str
    scopes: frozenset[str]


@dataclass(frozen=True, slots=True)
class CalendarImportItem:
    id: str
    title: str
    starts_at: datetime
    ends_at: datetime
    all_day: bool

    def to_json(self) -> dict[str, object]:
        return {
            "id": self.id,
            "title": self.title,
            "starts_at": self.starts_at.isoformat(),
            "ends_at": self.ends_at.isoformat(),
            "all_day": self.all_day,
        }

    @classmethod
    def from_json(cls, value: Mapping[str, Any]) -> "CalendarImportItem":
        return cls(
            id=str(value["id"]),
            title=str(value["title"]),
            starts_at=datetime.fromisoformat(str(value["starts_at"])),
            ends_at=datetime.fromisoformat(str(value["ends_at"])),
            all_day=bool(value["all_day"]),
        )


@dataclass(frozen=True, slots=True)
class ClassroomImportItem:
    id: str
    title: str
    course: str | None
    due_at: datetime
    link: str | None
    suggested_category: TaskCategory

    def to_json(self) -> dict[str, object]:
        return {
            "id": self.id,
            "title": self.title,
            "course": self.course,
            "due_at": self.due_at.isoformat(),
            "link": self.link,
            "suggested_category": self.suggested_category.value,
        }

    @classmethod
    def from_json(cls, value: Mapping[str, Any]) -> "ClassroomImportItem":
        course = value.get("course")
        link = value.get("link")
        return cls(
            id=str(value["id"]),
            title=str(value["title"]),
            course=str(course) if course is not None else None,
            due_at=datetime.fromisoformat(str(value["due_at"])),
            link=str(link) if link is not None else None,
            suggested_category=TaskCategory(str(value["suggested_category"])),
        )


type CalendarItemStatus = Literal["new", "changed", "unchanged"]
type ClassroomItemStatus = Literal["new", "already_imported"]


@dataclass(frozen=True, slots=True)
class CalendarPreviewItem:
    item: CalendarImportItem
    status: CalendarItemStatus


@dataclass(frozen=True, slots=True)
class ClassroomPreviewItem:
    item: ClassroomImportItem
    status: ClassroomItemStatus


@dataclass(frozen=True, slots=True)
class CalendarImportPreview:
    id: UUID
    expires_at: datetime
    items: list[CalendarPreviewItem]
    source: Literal[GoogleImportSource.CALENDAR] = GoogleImportSource.CALENDAR


@dataclass(frozen=True, slots=True)
class ClassroomImportPreview:
    id: UUID
    expires_at: datetime
    items: list[ClassroomPreviewItem]
    source: Literal[GoogleImportSource.CLASSROOM] = GoogleImportSource.CLASSROOM


@dataclass(frozen=True, slots=True)
class StoredImportSnapshot:
    id: UUID
    source: GoogleImportSource
    items: list[dict[str, Any]]
    expires_at: datetime


@dataclass(frozen=True, slots=True)
class ExistingCalendarPeriod:
    starts_at: datetime
    ends_at: datetime
    reason: str | None


@dataclass(frozen=True, slots=True)
class CalendarImportResult:
    created: int
    updated: int
    unchanged: int
    skipped_past: int
    invalidated_future_session_ids: list[UUID]


@dataclass(frozen=True, slots=True)
class ClassroomSelection:
    id: str
    category: TaskCategory
    priority: TaskPriority
    estimate_minutes: int


@dataclass(frozen=True, slots=True)
class ClassroomImportFailure:
    id: str
    reason: Literal["deadline_passed", "invalid"]


@dataclass(frozen=True, slots=True)
class ClassroomImportResult:
    created_task_ids: list[UUID]
    already_imported: list[str]
    failed: list[ClassroomImportFailure]


class GoogleImportRepository(Protocol):
    async def account(self, account_id: UUID) -> GoogleImportAccount | None: ...
    async def last_checked(self, account_id: UUID) -> dict[GoogleImportSource, datetime]: ...
    async def store_state(
        self,
        account_id: UUID,
        state_hash: str,
        source: GoogleImportSource,
        code_verifier: str,
        horizon_days: int,
        now: datetime,
        expires_at: datetime,
        redirect_uri: str | None = None,
    ) -> None: ...
    async def consume_state(self, state_hash: str, now: datetime) -> PendingGoogleImport | None: ...
    async def store_snapshot(
        self,
        account_id: UUID,
        source: GoogleImportSource,
        items: list[dict[str, object]],
        now: datetime,
        expires_at: datetime,
    ) -> UUID: ...
    async def open_snapshot(
        self, account_id: UUID, snapshot_id: UUID, now: datetime
    ) -> StoredImportSnapshot | None: ...
    async def claim_snapshot(
        self,
        account_id: UUID,
        snapshot_id: UUID,
        source: GoogleImportSource,
        now: datetime,
    ) -> StoredImportSnapshot | None: ...
    async def discard_snapshot(
        self, account_id: UUID, snapshot_id: UUID, now: datetime
    ) -> bool: ...
    async def calendar_periods(
        self, account_id: UUID, external_ids: Sequence[str]
    ) -> dict[str, ExistingCalendarPeriod]: ...
    async def classroom_task_ids(
        self, account_id: UUID, external_ids: Sequence[str]
    ) -> set[str]: ...
    async def import_calendar(
        self,
        account_id: UUID,
        snapshot_id: UUID,
        item_ids: Sequence[str],
        now: datetime,
    ) -> CalendarImportResult | None: ...


class GoogleImportClient(Protocol):
    async def exchange_code(
        self, code: str, code_verifier: str, redirect_uri: str | None = None
    ) -> GrantedGoogleToken: ...
    async def calendar_events(
        self, access_token: str, time_min: datetime, time_max: datetime
    ) -> list[dict[str, Any]]: ...
    async def classroom_coursework(self, access_token: str) -> list[dict[str, Any]]: ...


class GoogleImports(Protocol):
    @property
    def configured(self) -> bool: ...
    async def status(self, account_id: UUID) -> GoogleImportStatus: ...
    async def start(
        self,
        account_id: UUID,
        source: GoogleImportSource,
        horizon_days: int,
        redirect_uri: str | None = None,
    ) -> GoogleImportStart: ...
    async def complete(self, code: str, state: str, state_cookie: str) -> UUID: ...
    async def complete_mobile(self, code: str, state: str) -> UUID: ...
    async def preview(
        self, account_id: UUID, snapshot_id: UUID
    ) -> CalendarImportPreview | ClassroomImportPreview: ...
    async def import_calendar(
        self, account_id: UUID, snapshot_id: UUID, item_ids: Sequence[str]
    ) -> CalendarImportResult: ...
    async def import_classroom(
        self, account_id: UUID, snapshot_id: UUID, selections: Sequence[ClassroomSelection]
    ) -> ClassroomImportResult: ...
    async def discard(self, account_id: UUID, snapshot_id: UUID) -> bool: ...


def hash_import_state(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def external_item_id(*parts: str) -> str:
    """A fixed-length, non-reversible key for one Google item within one account."""

    return hashlib.sha256("\x1f".join(parts).encode()).hexdigest()


def pkce_challenge(code_verifier: str) -> str:
    digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def _missing_google_import_scopes(
    source: GoogleImportSource, granted_scopes: frozenset[str]
) -> set[str]:
    missing_scopes = set(GOOGLE_IMPORT_SCOPES[source]) - granted_scopes
    if (
        source is GoogleImportSource.CLASSROOM
        and CLASSROOM_COURSEWORK_SCOPE in missing_scopes
        and CLASSROOM_STUDENT_SUBMISSIONS_SCOPE in granted_scopes
    ):
        missing_scopes.remove(CLASSROOM_COURSEWORK_SCOPE)
    return missing_scopes


class GoogleImportService:
    def __init__(
        self,
        repository: GoogleImportRepository,
        client: GoogleImportClient,
        tasks: AcademicTasks,
        client_id: str,
        redirect_uri: str,
        token_factory: Callable[[], str] = lambda: secrets.token_urlsafe(32),
        verifier_factory: Callable[[], str] = lambda: secrets.token_urlsafe(64),
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self._repository = repository
        self._client = client
        self._tasks = tasks
        self._client_id = client_id
        self._redirect_uri = redirect_uri
        self._token_factory = token_factory
        self._verifier_factory = verifier_factory
        self._clock = clock

    @property
    def configured(self) -> bool:
        return True

    async def status(self, account_id: UUID) -> GoogleImportStatus:
        return GoogleImportStatus(True, await self._repository.last_checked(account_id))

    async def start(
        self,
        account_id: UUID,
        source: GoogleImportSource,
        horizon_days: int,
        redirect_uri: str | None = None,
    ) -> GoogleImportStart:
        if not 1 <= horizon_days <= MAX_CALENDAR_HORIZON_DAYS:
            raise ValueError("horizon_days must be between 1 and 90")
        account = await self._repository.account(account_id)
        if account is None:
            raise GoogleImportNotFoundError
        state = self._token_factory()
        code_verifier = self._verifier_factory()
        now = self._clock()
        state_args = (
            account_id,
            hash_import_state(state),
            source,
            code_verifier,
            horizon_days,
            now,
            now + STATE_LIFETIME,
        )
        if redirect_uri is None:
            await self._repository.store_state(*state_args)
        else:
            await self._repository.store_state(*state_args, redirect_uri=redirect_uri)
        query = urlencode(
            {
                "client_id": self._client_id,
                "redirect_uri": redirect_uri or self._redirect_uri,
                "response_type": "code",
                "scope": " ".join(GOOGLE_IMPORT_SCOPES[source]),
                "state": state,
                "code_challenge": pkce_challenge(code_verifier),
                "code_challenge_method": "S256",
                "access_type": "online",
                "include_granted_scopes": "false",
                "prompt": "select_account",
                "login_hint": account.email,
            }
        )
        return GoogleImportStart(f"{GOOGLE_AUTHORIZATION_ENDPOINT}?{query}", state)

    async def complete(self, code: str, state: str, state_cookie: str) -> UUID:
        return await self._complete(code, state, state_cookie)

    async def complete_mobile(self, code: str, state: str) -> UUID:
        return await self._complete(code, state, None)

    async def _complete(self, code: str, state: str, state_cookie: str | None) -> UUID:
        if state_cookie is not None and not hmac.compare_digest(
            state.encode(), state_cookie.encode()
        ):
            raise InvalidGoogleImportCallbackError
        now = self._clock()
        pending = await self._repository.consume_state(hash_import_state(state), now)
        if pending is None:
            raise InvalidGoogleImportCallbackError
        account = await self._repository.account(pending.account_id)
        if account is None:
            raise InvalidGoogleImportCallbackError
        try:
            if pending.redirect_uri is None:
                token = await self._client.exchange_code(code, pending.code_verifier)
            else:
                token = await self._client.exchange_code(
                    code, pending.code_verifier, pending.redirect_uri
                )
        except (
            GoogleImportNotConfiguredError,
            GoogleImportProviderUnavailableError,
            InvalidGoogleImportCallbackError,
        ) as error:
            logger.warning(
                "Google import failed source=%s stage=token_exchange error=%s",
                pending.source.value,
                type(error).__name__,
            )
            raise
        missing_scopes = _missing_google_import_scopes(pending.source, token.scopes)
        if missing_scopes:
            logger.warning(
                "Google import failed source=%s stage=scope_check "
                "missing_scopes=%s granted_scopes=%s",
                pending.source.value,
                ",".join(sorted(missing_scopes)),
                ",".join(sorted(token.scopes)),
            )
            raise GoogleImportPermissionError
        items: list[dict[str, object]]
        if pending.source is GoogleImportSource.CALENDAR:
            events = await self._client.calendar_events(
                token.access_token, now, now + timedelta(days=pending.horizon_days)
            )
            items = [
                item.to_json() for item in calendar_items_from_events(events, account.timezone, now)
            ]
        else:
            coursework = await self._client.classroom_coursework(token.access_token)
            items = [
                item.to_json()
                for item in classroom_items_from_coursework(coursework, account.timezone, now)
            ]
        return await self._repository.store_snapshot(
            pending.account_id, pending.source, items, now, now + SNAPSHOT_LIFETIME
        )

    async def preview(
        self, account_id: UUID, snapshot_id: UUID
    ) -> CalendarImportPreview | ClassroomImportPreview:
        snapshot = await self._repository.open_snapshot(account_id, snapshot_id, self._clock())
        if snapshot is None:
            raise GoogleImportNotFoundError
        if snapshot.source is GoogleImportSource.CALENDAR:
            calendar_items = [CalendarImportItem.from_json(item) for item in snapshot.items]
            existing = await self._repository.calendar_periods(
                account_id, [item.id for item in calendar_items]
            )
            return CalendarImportPreview(
                id=snapshot.id,
                expires_at=snapshot.expires_at,
                items=[
                    CalendarPreviewItem(item, _calendar_status(item, existing.get(item.id)))
                    for item in calendar_items
                ],
            )
        classroom_items = [ClassroomImportItem.from_json(item) for item in snapshot.items]
        imported = await self._repository.classroom_task_ids(
            account_id, [item.id for item in classroom_items]
        )
        return ClassroomImportPreview(
            id=snapshot.id,
            expires_at=snapshot.expires_at,
            items=[
                ClassroomPreviewItem(item, "already_imported" if item.id in imported else "new")
                for item in classroom_items
            ],
        )

    async def import_calendar(
        self, account_id: UUID, snapshot_id: UUID, item_ids: Sequence[str]
    ) -> CalendarImportResult:
        if not item_ids or len(set(item_ids)) != len(item_ids):
            raise UnknownGoogleImportItemError("Select each item at most once")
        result = await self._repository.import_calendar(
            account_id, snapshot_id, item_ids, self._clock()
        )
        if result is None:
            raise GoogleImportNotFoundError
        return result

    async def import_classroom(
        self, account_id: UUID, snapshot_id: UUID, selections: Sequence[ClassroomSelection]
    ) -> ClassroomImportResult:
        ids = [selection.id for selection in selections]
        if not ids or len(set(ids)) != len(ids):
            raise UnknownGoogleImportItemError("Select each item at most once")
        if any(
            not 0 < selection.estimate_minutes <= MAX_TASK_ESTIMATE_MINUTES
            for selection in selections
        ):
            raise ValueError("estimate_minutes must be between 1 and 10080")
        now = self._clock()
        snapshot = await self._repository.open_snapshot(account_id, snapshot_id, now)
        if snapshot is None or snapshot.source is not GoogleImportSource.CLASSROOM:
            raise GoogleImportNotFoundError
        items = {
            item.id: item for item in (ClassroomImportItem.from_json(raw) for raw in snapshot.items)
        }
        if any(item_id not in items for item_id in ids):
            raise UnknownGoogleImportItemError("A selected item is not part of this import")
        # Claiming makes the import single-use, so a repeated submission cannot
        # create a second copy of every task.
        if (
            await self._repository.claim_snapshot(account_id, snapshot_id, snapshot.source, now)
            is None
        ):
            raise GoogleImportNotFoundError
        already = await self._repository.classroom_task_ids(account_id, ids)

        created: list[UUID] = []
        already_imported: list[str] = []
        failed: list[ClassroomImportFailure] = []
        for selection in selections:
            item = items[selection.id]
            if item.id in already:
                already_imported.append(item.id)
                continue
            if item.due_at <= self._clock():
                failed.append(ClassroomImportFailure(item.id, "deadline_passed"))
                continue
            try:
                record = await self._tasks.create(
                    account_id,
                    NewAcademicTask(
                        title=item.title,
                        category=selection.category,
                        priority=selection.priority,
                        course=item.course,
                        notes=_classroom_notes(item),
                        deadline_at=item.due_at,
                        original_estimate_minutes=selection.estimate_minutes,
                        external_source=GoogleImportSource.CLASSROOM.value,
                        external_id=item.id,
                    ),
                )
            except DuplicateExternalTaskError:
                already_imported.append(item.id)
            except InvalidTaskDeadlineError:
                failed.append(ClassroomImportFailure(item.id, "deadline_passed"))
            except (AdaptiveEstimateUnavailableError, ValueError):
                failed.append(ClassroomImportFailure(item.id, "invalid"))
            else:
                created.append(record.id)
        return ClassroomImportResult(created, already_imported, failed)

    async def discard(self, account_id: UUID, snapshot_id: UUID) -> bool:
        return await self._repository.discard_snapshot(account_id, snapshot_id, self._clock())


class UnconfiguredGoogleImports:
    @property
    def configured(self) -> bool:
        return False

    async def status(self, account_id: UUID) -> GoogleImportStatus:
        return GoogleImportStatus(False, {})

    async def start(
        self,
        account_id: UUID,
        source: GoogleImportSource,
        horizon_days: int,
        redirect_uri: str | None = None,
    ) -> GoogleImportStart:
        raise GoogleImportNotConfiguredError

    async def complete(self, code: str, state: str, state_cookie: str) -> UUID:
        raise GoogleImportNotConfiguredError

    async def complete_mobile(self, code: str, state: str) -> UUID:
        raise GoogleImportNotConfiguredError

    async def preview(
        self, account_id: UUID, snapshot_id: UUID
    ) -> CalendarImportPreview | ClassroomImportPreview:
        raise GoogleImportNotConfiguredError

    async def import_calendar(
        self, account_id: UUID, snapshot_id: UUID, item_ids: Sequence[str]
    ) -> CalendarImportResult:
        raise GoogleImportNotConfiguredError

    async def import_classroom(
        self, account_id: UUID, snapshot_id: UUID, selections: Sequence[ClassroomSelection]
    ) -> ClassroomImportResult:
        raise GoogleImportNotConfiguredError

    async def discard(self, account_id: UUID, snapshot_id: UUID) -> bool:
        raise GoogleImportNotConfiguredError


def _calendar_status(
    item: CalendarImportItem, existing: ExistingCalendarPeriod | None
) -> CalendarItemStatus:
    if existing is None:
        return "new"
    if (
        existing.starts_at == item.starts_at
        and existing.ends_at == item.ends_at
        and existing.reason == item.title
    ):
        return "unchanged"
    return "changed"


def _classroom_notes(item: ClassroomImportItem) -> str:
    if item.link is None:
        return "Imported from Google Classroom."
    return f"Imported from Google Classroom: {item.link}"


# ─── Google Calendar ────────────────────────────────────────────────────────

_SKIPPED_EVENT_TYPES = frozenset({"workingLocation", "birthday"})


def calendar_items_from_events(
    events: Sequence[Mapping[str, Any]], timezone: str, now: datetime
) -> list[CalendarImportItem]:
    """Keep future events that make the student busy, as blocked-time candidates."""

    zone = ZoneInfo(timezone)
    items: dict[str, CalendarImportItem] = {}
    for event in events:
        event_id = event.get("id")
        if not isinstance(event_id, str) or not event_id:
            continue
        if event.get("status") == "cancelled" or event.get("transparency") == "transparent":
            continue
        if event.get("eventType") in _SKIPPED_EVENT_TYPES or _declined(event):
            continue
        bounds = _event_bounds(event, zone)
        if bounds is None:
            continue
        starts_at, ends_at, all_day = bounds
        if ends_at <= starts_at or ends_at <= now:
            continue
        item_id = external_item_id("primary", event_id)
        items[item_id] = CalendarImportItem(
            id=item_id,
            title=_clean_text(event.get("summary"), REASON_LIMIT) or "Busy",
            starts_at=starts_at,
            ends_at=ends_at,
            all_day=all_day,
        )
        if len(items) >= MAX_CALENDAR_EVENTS:
            break
    return sorted(items.values(), key=lambda item: (item.starts_at, item.ends_at, item.id))


def _declined(event: Mapping[str, Any]) -> bool:
    attendees = event.get("attendees")
    if not isinstance(attendees, list):
        return False
    return any(
        isinstance(attendee, dict)
        and attendee.get("self") is True
        and attendee.get("responseStatus") == "declined"
        for attendee in attendees
    )


def _event_bounds(
    event: Mapping[str, Any], zone: ZoneInfo
) -> tuple[datetime, datetime, bool] | None:
    start = event.get("start")
    end = event.get("end")
    if not isinstance(start, dict) or not isinstance(end, dict):
        return None
    try:
        if isinstance(start.get("dateTime"), str) and isinstance(end.get("dateTime"), str):
            starts_at = datetime.fromisoformat(start["dateTime"])
            ends_at = datetime.fromisoformat(end["dateTime"])
            if starts_at.tzinfo is None or ends_at.tzinfo is None:
                return None
            return starts_at.astimezone(UTC), ends_at.astimezone(UTC), False
        if isinstance(start.get("date"), str) and isinstance(end.get("date"), str):
            # All-day events end on the following date, exclusive, in the
            # student's planning timezone.
            first = date.fromisoformat(start["date"])
            after_last = date.fromisoformat(end["date"])
            return (
                datetime.combine(first, time.min, zone).astimezone(UTC),
                datetime.combine(after_last, time.min, zone).astimezone(UTC),
                True,
            )
    except ValueError:
        return None
    return None


# ─── Google Classroom ───────────────────────────────────────────────────────

_FINISHED_SUBMISSION_STATES = frozenset({"TURNED_IN", "RETURNED"})
_EXAM_WORDS = ("exam", "quiz", "test", "midterm", "final")


def classroom_items_from_coursework(
    coursework: Sequence[Mapping[str, Any]], timezone: str, now: datetime
) -> list[ClassroomImportItem]:
    """Keep unfinished coursework with a future due date, as task candidates."""

    zone = ZoneInfo(timezone)
    items: dict[str, ClassroomImportItem] = {}
    for work in coursework:
        work_id = work.get("id")
        course_id = work.get("courseId")
        if not isinstance(work_id, str) or not isinstance(course_id, str):
            continue
        if not work_id or not course_id:
            continue
        if work.get("submissionState") in _FINISHED_SUBMISSION_STATES:
            continue
        due_at = _due_at(work, zone)
        if due_at is None or due_at <= now:
            continue
        title = _clean_text(work.get("title"), TITLE_LIMIT)
        if not title:
            continue
        item_id = external_item_id(course_id, work_id)
        items[item_id] = ClassroomImportItem(
            id=item_id,
            title=title,
            course=_clean_text(work.get("courseName"), COURSE_LIMIT) or None,
            due_at=due_at,
            link=_https_link(work.get("alternateLink")),
            suggested_category=_suggested_category(title),
        )
        if len(items) >= MAX_CLASSROOM_ITEMS:
            break
    return sorted(items.values(), key=lambda item: (item.due_at, item.title, item.id))


def _due_at(work: Mapping[str, Any], zone: ZoneInfo) -> datetime | None:
    due_date = work.get("dueDate")
    if not isinstance(due_date, dict):
        return None
    try:
        day = date(int(due_date["year"]), int(due_date["month"]), int(due_date["day"]))
    except (KeyError, TypeError, ValueError):
        return None
    due_time = work.get("dueTime")
    if not isinstance(due_time, dict):
        # Classroom treats a date without a time as the end of that day.
        return datetime.combine(day, time(23, 59), zone).astimezone(UTC)
    try:
        # Classroom reports due times in UTC and omits zero-valued fields.
        return datetime.combine(
            day,
            time(int(due_time.get("hours", 0)), int(due_time.get("minutes", 0))),
            UTC,
        )
    except (TypeError, ValueError):
        return None


def _suggested_category(title: str) -> TaskCategory:
    lowered = title.lower()
    if any(word in lowered for word in _EXAM_WORDS):
        return TaskCategory.EXAM_PREPARATION
    return TaskCategory.ASSIGNMENT


def _https_link(value: object) -> str | None:
    if not isinstance(value, str) or len(value) > LINK_LIMIT:
        return None
    if not value.startswith("https://classroom.google.com/"):
        return None
    return value


def _clean_text(value: object, limit: int) -> str:
    if not isinstance(value, str):
        return ""
    return " ".join(value.split())[:limit]


def with_course_names(
    coursework: Sequence[Mapping[str, Any]], course_names: Mapping[str, str]
) -> list[dict[str, Any]]:
    """Attach each course name so mapping does not need a second lookup."""

    return [
        {**work, "courseName": course_names.get(str(work.get("courseId")))} for work in coursework
    ]
