from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from studyflow.database import Base, Database
from studyflow.database.models import (
    GoogleImportSnapshot,
    GoogleImportState,
    StudentAccount,
    UnavailablePeriod,
)
from studyflow.integrations.google_import import (
    CalendarImportItem,
    ExistingCalendarPeriod,
    GoogleImportSource,
    UnknownGoogleImportItemError,
    external_item_id,
)
from studyflow.integrations.repositories import SqlAlchemyGoogleImportRepository
from studyflow.tasks.repositories import (
    SqlAlchemyAcademicTaskRepository,
    SqlAlchemyTaskDeadlineSessionInvalidator,
)
from studyflow.tasks.service import (
    DuplicateExternalTaskError,
    NewAcademicTask,
    TaskCategory,
    TaskPriority,
)

NOW = datetime(2026, 9, 18, 8, tzinfo=UTC)
OWNER = UUID("5b15bfef-8c44-45d5-a70e-574beb999fb3")
OTHER = UUID("0f2c0b2e-3d4f-4a8b-9c1d-2e3f4a5b6c7d")


@dataclass
class RecordingInvalidator:
    calls: list[tuple[UUID, datetime, datetime]] = field(default_factory=list)

    async def remove_conflicting_future_sessions(
        self,
        session: AsyncSession,
        account_id: UUID,
        starts_at: datetime,
        ends_at: datetime,
    ) -> list[UUID]:
        self.calls.append((account_id, starts_at, ends_at))
        return [UUID("22222222-2222-4222-8222-222222222222")]


@pytest.fixture
async def database() -> AsyncIterator[Database]:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    async with database.transaction() as session:
        await session.run_sync(
            lambda sync_session: Base.metadata.create_all(sync_session.connection())
        )
        for account_id, email in ((OWNER, "owner@example.com"), (OTHER, "other@example.com")):
            session.add(
                StudentAccount(
                    id=account_id,
                    email=email,
                    name="Student",
                    password_hash="$argon2id$hash",
                    email_verified_at=NOW,
                    timezone="Asia/Phnom_Penh",
                )
            )
    try:
        yield database
    finally:
        await database.stop()


def calendar_item(name: str, start_hours: int, duration_hours: int = 2) -> CalendarImportItem:
    return CalendarImportItem(
        id=external_item_id("primary", name),
        title=name,
        starts_at=NOW + timedelta(hours=start_hours),
        ends_at=NOW + timedelta(hours=start_hours + duration_hours),
        all_day=False,
    )


@pytest.mark.anyio
async def test_import_state_is_single_use_expiring_and_one_per_account(database: Database) -> None:
    repository = SqlAlchemyGoogleImportRepository(database, RecordingInvalidator())

    assert await repository.account(OWNER) is not None
    assert (await repository.account(OWNER)).timezone == "Asia/Phnom_Penh"  # type: ignore[union-attr]
    assert await repository.account(uuid4()) is None

    await repository.store_state(
        OWNER, "a" * 64, GoogleImportSource.CALENDAR, "v" * 43, 14, NOW, NOW + timedelta(minutes=10)
    )
    await repository.store_state(
        OWNER,
        "b" * 64,
        GoogleImportSource.CLASSROOM,
        "w" * 43,
        28,
        NOW,
        NOW + timedelta(minutes=10),
    )

    # Starting a second import replaces the first one's state.
    assert await repository.consume_state("a" * 64, NOW) is None
    pending = await repository.consume_state("b" * 64, NOW)
    assert pending is not None
    assert (pending.account_id, pending.source, pending.code_verifier, pending.horizon_days) == (
        OWNER,
        GoogleImportSource.CLASSROOM,
        "w" * 43,
        28,
    )
    assert await repository.consume_state("b" * 64, NOW) is None

    await repository.store_state(
        OTHER, "c" * 64, GoogleImportSource.CALENDAR, "x" * 43, 14, NOW, NOW + timedelta(minutes=10)
    )
    assert await repository.consume_state("c" * 64, NOW + timedelta(minutes=11)) is None
    async with database.transaction() as session:
        remaining = list(await session.scalars(select(GoogleImportState.state_hash)))
    assert remaining == ["c" * 64]


@pytest.mark.anyio
async def test_snapshots_are_owner_only_expiring_and_claimed_once(database: Database) -> None:
    repository = SqlAlchemyGoogleImportRepository(database, RecordingInvalidator())
    items = [calendar_item("shift", 24).to_json()]

    older = await repository.store_snapshot(
        OWNER, GoogleImportSource.CALENDAR, items, NOW, NOW + timedelta(minutes=30)
    )
    snapshot_id = await repository.store_snapshot(
        OWNER, GoogleImportSource.CALENDAR, items, NOW, NOW + timedelta(minutes=30)
    )

    assert await repository.open_snapshot(OWNER, older, NOW) is None
    assert await repository.open_snapshot(OTHER, snapshot_id, NOW) is None
    assert await repository.open_snapshot(OWNER, snapshot_id, NOW + timedelta(minutes=31)) is None
    opened = await repository.open_snapshot(OWNER, snapshot_id, NOW)
    assert opened is not None
    assert opened.items == items
    assert opened.expires_at == NOW + timedelta(minutes=30)

    assert (
        await repository.claim_snapshot(OWNER, snapshot_id, GoogleImportSource.CLASSROOM, NOW)
        is None
    )
    assert (
        await repository.claim_snapshot(OWNER, snapshot_id, GoogleImportSource.CALENDAR, NOW)
        is not None
    )
    assert (
        await repository.claim_snapshot(OWNER, snapshot_id, GoogleImportSource.CALENDAR, NOW)
        is None
    )

    discardable = await repository.store_snapshot(
        OWNER, GoogleImportSource.CLASSROOM, [], NOW, NOW + timedelta(minutes=30)
    )
    assert await repository.discard_snapshot(OTHER, discardable, NOW) is False
    assert await repository.discard_snapshot(OWNER, discardable, NOW) is True
    async with database.transaction() as session:
        assert list(await session.scalars(select(GoogleImportSnapshot.id))) == []


@pytest.mark.anyio
async def test_calendar_import_creates_updates_and_skips_in_one_transaction(
    database: Database,
) -> None:
    invalidator = RecordingInvalidator()
    repository = SqlAlchemyGoogleImportRepository(database, invalidator)
    first = [calendar_item("shift", 24), calendar_item("trip", 48), calendar_item("gone", -5, 1)]
    snapshot_id = await repository.store_snapshot(
        OWNER,
        GoogleImportSource.CALENDAR,
        [item.to_json() for item in first],
        NOW,
        NOW + timedelta(minutes=30),
    )

    result = await repository.import_calendar(OWNER, snapshot_id, [item.id for item in first], NOW)

    assert result is not None
    assert (result.created, result.updated, result.unchanged, result.skipped_past) == (2, 0, 0, 1)
    assert result.invalidated_future_session_ids == [UUID("22222222-2222-4222-8222-222222222222")]
    assert [call[1] for call in invalidator.calls] == [first[0].starts_at, first[1].starts_at]
    assert await repository.import_calendar(OWNER, snapshot_id, [first[0].id], NOW) is None

    existing = await repository.calendar_periods(OWNER, [item.id for item in first])
    assert existing[first[0].id] == ExistingCalendarPeriod(
        first[0].starts_at, first[0].ends_at, "shift"
    )
    assert await repository.calendar_periods(OTHER, [item.id for item in first]) == {}
    assert await repository.calendar_periods(OWNER, []) == {}

    moved = calendar_item("trip", 72)
    second_id = await repository.store_snapshot(
        OWNER,
        GoogleImportSource.CALENDAR,
        [first[0].to_json(), moved.to_json()],
        NOW,
        NOW + timedelta(minutes=30),
    )
    second = await repository.import_calendar(OWNER, second_id, [first[0].id, moved.id], NOW)

    assert second is not None
    assert (second.created, second.updated, second.unchanged) == (0, 1, 1)
    async with database.transaction() as session:
        rows = list(
            await session.scalars(select(UnavailablePeriod).order_by(UnavailablePeriod.starts_at))
        )
    assert [(row.reason, row.external_source) for row in rows] == [
        ("shift", "google_calendar"),
        ("trip", "google_calendar"),
    ]
    assert rows[1].starts_at.replace(tzinfo=UTC) == moved.starts_at


@pytest.mark.anyio
async def test_calendar_import_rejects_items_outside_the_snapshot(database: Database) -> None:
    repository = SqlAlchemyGoogleImportRepository(database, RecordingInvalidator())
    item = calendar_item("shift", 24)
    snapshot_id = await repository.store_snapshot(
        OWNER, GoogleImportSource.CALENDAR, [item.to_json()], NOW, NOW + timedelta(minutes=30)
    )

    with pytest.raises(UnknownGoogleImportItemError):
        await repository.import_calendar(OWNER, snapshot_id, ["f" * 64], NOW)
    assert await repository.import_calendar(OTHER, snapshot_id, [item.id], NOW) is None
    assert await repository.import_calendar(uuid4(), snapshot_id, [item.id], NOW) is None
    # A rejected selection leaves the import usable.
    assert await repository.import_calendar(OWNER, snapshot_id, [item.id], NOW) is not None


@pytest.mark.anyio
async def test_imported_tasks_are_recognised_and_cannot_be_duplicated(database: Database) -> None:
    repository = SqlAlchemyGoogleImportRepository(database, RecordingInvalidator())
    tasks = SqlAlchemyAcademicTaskRepository(
        database, SqlAlchemyTaskDeadlineSessionInvalidator(), clock=lambda: NOW
    )
    external_id = external_item_id("course", "work")
    task = NewAcademicTask(
        title="Lab report",
        category=TaskCategory.ASSIGNMENT,
        priority=TaskPriority.MEDIUM,
        course="Physics",
        notes=None,
        deadline_at=NOW + timedelta(days=3),
        original_estimate_minutes=90,
        external_source="google_classroom",
        external_id=external_id,
    )

    await tasks.create(OWNER, task)
    await tasks.create(OTHER, task)

    assert await repository.classroom_task_ids(OWNER, [external_id, "f" * 64]) == {external_id}
    assert await repository.classroom_task_ids(OWNER, []) == set()
    with pytest.raises(DuplicateExternalTaskError):
        await tasks.create(OWNER, task)
