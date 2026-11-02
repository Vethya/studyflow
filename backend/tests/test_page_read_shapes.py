"""Page-oriented read shapes: session task context, session filters, task pagination."""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from studyflow.app import create_app
from studyflow.auth.session_authentication import SessionPrincipal
from studyflow.database import Base, Database
from studyflow.database.models import AcademicTask, StudentAccount
from studyflow.database.models import StudySession as SessionRow
from studyflow.database.models import StudySessionOutcome as OutcomeRow
from studyflow.scheduling.outcome_repositories import SqlAlchemyStudySessionOutcomeRepository
from studyflow.scheduling.outcomes import StudySessionFilters, StudySessionService
from studyflow.tasks.repositories import SqlAlchemyAcademicTaskRepository
from studyflow.tasks.service import (
    AcademicTaskPage,
    AcademicTaskPages,
    AcademicTaskRecord,
    AcademicTaskService,
    NewAcademicTask,
    TaskCategory,
    TaskFilters,
    TaskPriority,
)

NOW = datetime(2026, 8, 24, 12, tzinfo=UTC)
DEADLINE = datetime(2030, 1, 1, tzinfo=UTC)


@dataclass
class Fixture:
    database: Database
    owner_id: UUID
    other_id: UUID
    essay_id: UUID
    reading_id: UUID
    other_task_id: UUID
    awaiting_id: UUID
    recorded_id: UUID
    future_id: UUID
    other_session_id: UUID


def _account(account_id: UUID, email: str) -> StudentAccount:
    return StudentAccount(
        id=account_id,
        email=email,
        name="Student",
        password_hash="$argon2id$hash",
        email_verified_at=NOW,
        timezone="UTC",
    )


def _task(task_id: UUID, account_id: UUID, title: str, category: str) -> AcademicTask:
    return AcademicTask(
        id=task_id,
        account_id=account_id,
        title=title,
        category=category,
        deadline_at=DEADLINE,
        original_estimate_minutes=300,
        planned_duration_minutes=300,
    )


def _session(session_id: UUID, account_id: UUID, task_id: UUID, starts_at: datetime) -> SessionRow:
    return SessionRow(
        id=session_id,
        account_id=account_id,
        task_id=task_id,
        proposal_id=None,
        starts_at=starts_at,
        ends_at=starts_at + timedelta(hours=1),
        planned_duration_minutes=60,
    )


async def _seed() -> Fixture:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    fixture = Fixture(database, *(uuid4() for _ in range(9)))
    async with database.transaction() as db_session:
        await db_session.run_sync(lambda sync: Base.metadata.create_all(sync.connection()))
        db_session.add_all(
            [
                _account(fixture.owner_id, "owner@example.com"),
                _account(fixture.other_id, "other@example.com"),
            ]
        )
        await db_session.flush()
        db_session.add_all(
            [
                _task(fixture.essay_id, fixture.owner_id, "Essay", "assignment"),
                _task(fixture.reading_id, fixture.owner_id, "Chapter 4", "reading"),
                _task(fixture.other_task_id, fixture.other_id, "Secret", "project"),
            ]
        )
        await db_session.flush()
        db_session.add_all(
            [
                _session(
                    fixture.awaiting_id,
                    fixture.owner_id,
                    fixture.essay_id,
                    NOW - timedelta(hours=4),
                ),
                _session(
                    fixture.recorded_id,
                    fixture.owner_id,
                    fixture.reading_id,
                    NOW - timedelta(hours=2),
                ),
                _session(
                    fixture.future_id,
                    fixture.owner_id,
                    fixture.essay_id,
                    NOW + timedelta(hours=2),
                ),
                _session(
                    fixture.other_session_id,
                    fixture.other_id,
                    fixture.other_task_id,
                    NOW - timedelta(hours=3),
                ),
            ]
        )
        await db_session.flush()
        db_session.add(
            OutcomeRow(
                session_id=fixture.recorded_id,
                kind="completed",
                actual_minutes=60,
                remaining_minutes=0,
                recorded_at=NOW,
                rescheduled_at=None,
            )
        )
    return fixture


def _sessions(database: Database) -> StudySessionService:
    return StudySessionService(
        SqlAlchemyStudySessionOutcomeRepository(database, clock=lambda: NOW), clock=lambda: NOW
    )


@pytest.mark.anyio
async def test_session_details_carry_task_title_and_category_without_leaking_accounts() -> None:
    fixture = await _seed()
    try:
        service = _sessions(fixture.database)

        listed = await service.list(fixture.owner_id, StudySessionFilters())
        detail = await service.get(fixture.owner_id, fixture.recorded_id)
        other_listed = await service.list(fixture.other_id, StudySessionFilters())

        assert [(item.session.id, item.task_title, item.task_category) for item in listed] == [
            (fixture.awaiting_id, "Essay", TaskCategory.ASSIGNMENT),
            (fixture.recorded_id, "Chapter 4", TaskCategory.READING),
            (fixture.future_id, "Essay", TaskCategory.ASSIGNMENT),
        ]
        assert detail is not None
        assert (detail.task_title, detail.task_category) == ("Chapter 4", TaskCategory.READING)
        assert detail.outcome is not None
        assert [(item.session.id, item.task_title) for item in other_listed] == [
            (fixture.other_session_id, "Secret")
        ]
        assert await service.get(fixture.other_id, fixture.recorded_id) is None
        assert await service.get(fixture.owner_id, fixture.other_session_id) is None
    finally:
        await fixture.database.stop()


@pytest.mark.anyio
async def test_session_list_filters_by_awaiting_outcome_and_time_range() -> None:
    fixture = await _seed()
    try:
        service = _sessions(fixture.database)

        awaiting = await service.list(fixture.owner_id, StudySessionFilters(awaiting_outcome=True))
        not_awaiting = await service.list(
            fixture.owner_id, StudySessionFilters(awaiting_outcome=False)
        )
        ranged = await service.list(
            fixture.owner_id,
            StudySessionFilters(starts_from=NOW - timedelta(hours=1, minutes=30), starts_to=NOW),
        )

        assert [item.session.id for item in awaiting] == [fixture.awaiting_id]
        assert [item.session.id for item in not_awaiting] == [
            fixture.recorded_id,
            fixture.future_id,
        ]
        assert [item.session.id for item in ranged] == [fixture.recorded_id]
    finally:
        await fixture.database.stop()


@dataclass
class SwitchableAuthentication:
    account_id: UUID

    async def authenticate(
        self, session_token: str, csrf_token: str | None = None
    ) -> SessionPrincipal | None:
        return SessionPrincipal(self.account_id, "student@example.com", "Student")

    async def revoke(self, session_token: str, csrf_token: str) -> bool:
        return False


def _app(fixture: Fixture, authentication: SwitchableAuthentication) -> FastAPI:
    return create_app(
        session_authentication=authentication,
        study_sessions=_sessions(fixture.database),
        academic_tasks=AcademicTaskService(SqlAlchemyAcademicTaskRepository(fixture.database)),
    )


@pytest.mark.anyio
async def test_study_session_api_serves_task_context_and_awaiting_filter() -> None:
    fixture = await _seed()
    authentication = SwitchableAuthentication(fixture.owner_id)
    try:
        async with AsyncClient(
            transport=ASGITransport(app=_app(fixture, authentication)),
            base_url="https://test",
            cookies={"studyflow_session": "session"},
        ) as client:
            listed = await client.get("/api/v1/study-sessions")
            awaiting = await client.get(
                "/api/v1/study-sessions", params={"awaiting_outcome": "true"}
            )
            detail = await client.get(f"/api/v1/study-sessions/{fixture.awaiting_id}")
            invalid_flag = await client.get(
                "/api/v1/study-sessions", params={"awaiting_outcome": "sometimes"}
            )
            authentication.account_id = fixture.other_id
            other_listed = await client.get("/api/v1/study-sessions")
            other_detail = await client.get(f"/api/v1/study-sessions/{fixture.awaiting_id}")

        assert listed.status_code == 200
        assert [
            (item["id"], item["task_title"], item["task_category"]) for item in listed.json()
        ] == [
            (str(fixture.awaiting_id), "Essay", "assignment"),
            (str(fixture.recorded_id), "Chapter 4", "reading"),
            (str(fixture.future_id), "Essay", "assignment"),
        ]
        assert [item["id"] for item in awaiting.json()] == [str(fixture.awaiting_id)]
        assert detail.status_code == 200
        assert detail.json()["task_title"] == "Essay"
        assert detail.json()["task_category"] == "assignment"
        assert invalid_flag.status_code == 422
        assert [item["id"] for item in other_listed.json()] == [str(fixture.other_session_id)]
        assert other_listed.json()[0]["task_title"] == "Secret"
        assert other_detail.status_code == 404
    finally:
        await fixture.database.stop()


@pytest.mark.anyio
async def test_study_session_outcome_response_includes_task_context() -> None:
    fixture = await _seed()
    try:
        async with AsyncClient(
            transport=ASGITransport(app=_app(fixture, SwitchableAuthentication(fixture.owner_id))),
            base_url="https://test",
            cookies={"studyflow_session": "session"},
        ) as client:
            recorded = await client.post(
                f"/api/v1/study-sessions/{fixture.awaiting_id}/outcomes",
                json={"outcome": "completed", "actual_minutes": 60},
                headers={"X-CSRF-Token": "csrf"},
            )

        assert recorded.status_code == 201
        assert recorded.json()["session"]["task_title"] == "Essay"
        assert recorded.json()["session"]["task_category"] == "assignment"
    finally:
        await fixture.database.stop()


async def _seed_tasks(database: Database, account_id: UUID, count: int) -> list[UUID]:
    repository = SqlAlchemyAcademicTaskRepository(database)
    ids = []
    for index in range(count):
        created = await repository.create(
            account_id,
            NewAcademicTask(
                f"Task {index}",
                TaskCategory.READING,
                TaskPriority.MEDIUM,
                None,
                None,
                # Two tasks share each deadline so the id tiebreaker is exercised.
                DEADLINE + timedelta(days=index // 2),
                60,
            ),
        )
        ids.append(created.id)
    return ids


@pytest.mark.anyio
async def test_task_repository_pages_deterministically_with_owner_scoped_totals() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    owner_id, other_id = uuid4(), uuid4()
    try:
        async with database.transaction() as db_session:
            await db_session.run_sync(lambda sync: Base.metadata.create_all(sync.connection()))
            db_session.add_all(
                [_account(owner_id, "owner@example.com"), _account(other_id, "other@example.com")]
            )
        await _seed_tasks(database, owner_id, 5)
        await _seed_tasks(database, other_id, 3)
        repository = SqlAlchemyAcademicTaskRepository(database)
        ordered = [task.id for task in await repository.list(owner_id)]

        first = await repository.list_page(owner_id, TaskFilters(limit=2))
        second = await repository.list_page(owner_id, TaskFilters(limit=2, offset=2))
        tail = await repository.list_page(owner_id, TaskFilters(offset=4))
        beyond = await repository.list_page(owner_id, TaskFilters(limit=2, offset=10))
        filtered = await repository.list_page(owner_id, TaskFilters(query="Task 1", limit=1))
        other = await repository.list_page(other_id, TaskFilters(limit=100))

        assert len(ordered) == 5
        assert [task.id for task in first.items + second.items + tail.items] == ordered
        assert (first.total, second.total, tail.total, beyond.total) == (5, 5, 5, 5)
        assert beyond.items == []
        assert filtered.total == 1 and [task.title for task in filtered.items] == ["Task 1"]
        assert other.total == 3
        assert {task.account_id for task in other.items} == {other_id}
    finally:
        await database.stop()


@dataclass
class ListOnlyRepository:
    records: list[AcademicTaskRecord]

    async def list(
        self, account_id: UUID, filters: TaskFilters | None = None
    ) -> list[AcademicTaskRecord]:
        assert filters is not None and filters.limit is None and filters.offset == 0
        return self.records


def _record(title: str) -> AcademicTaskRecord:
    return AcademicTaskRecord(
        uuid4(),
        uuid4(),
        title,
        TaskCategory.READING,
        TaskPriority.MEDIUM,
        None,
        None,
        DEADLINE,
        60,
        60,
        NOW,
        NOW,
    )


@pytest.mark.anyio
async def test_task_service_pages_repositories_without_native_paging() -> None:
    records = [_record(f"Task {index}") for index in range(3)]
    service = AcademicTaskService(ListOnlyRepository(records))  # type: ignore[arg-type]

    page = await service.list_page(uuid4(), TaskFilters(limit=1, offset=1))
    unbounded = await service.list_page(uuid4(), TaskFilters(offset=2))

    assert page == AcademicTaskPage(items=[records[1]], total=3)
    assert unbounded == AcademicTaskPage(items=[records[2]], total=3)


@dataclass
class PagingTasksStub:
    records: list[AcademicTaskRecord]
    filters: TaskFilters | None = None

    async def list(
        self, account_id: UUID, filters: TaskFilters | None = None
    ) -> list[AcademicTaskRecord]:
        raise AssertionError("list_page should be used when available")

    async def list_page(
        self, account_id: UUID, filters: TaskFilters | None = None
    ) -> AcademicTaskPage:
        self.filters = filters
        return AcademicTaskPage(items=self.records[:1], total=len(self.records))


@pytest.mark.anyio
async def test_task_list_api_forwards_offset_and_reports_total_count_header() -> None:
    stub = PagingTasksStub([_record("First"), _record("Second")])
    assert isinstance(stub, AcademicTaskPages)
    app = create_app(
        session_authentication=SwitchableAuthentication(uuid4()),
        academic_tasks=stub,  # type: ignore[arg-type]
    )
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="https://test",
        cookies={"studyflow_session": "session"},
    ) as client:
        page = await client.get("/api/v1/tasks", params={"limit": 1, "offset": 1})
        negative = await client.get("/api/v1/tasks", params={"offset": -1})
        huge = await client.get("/api/v1/tasks", params={"offset": 2_147_483_648})
        zero_limit = await client.get("/api/v1/tasks", params={"limit": 0})
        large_limit = await client.get("/api/v1/tasks", params={"limit": 101})

    assert page.status_code == 200
    assert [item["title"] for item in page.json()] == ["First"]
    assert page.headers["x-total-count"] == "2"
    assert stub.filters == TaskFilters(limit=1, offset=1)
    assert negative.status_code == 422
    assert huge.status_code == 422
    assert zero_limit.status_code == 422
    assert large_limit.status_code == 422


@pytest.mark.anyio
async def test_task_list_api_pages_real_tasks_and_isolates_accounts() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    owner_id, other_id = uuid4(), uuid4()
    try:
        async with database.transaction() as db_session:
            await db_session.run_sync(lambda sync: Base.metadata.create_all(sync.connection()))
            db_session.add_all(
                [_account(owner_id, "owner@example.com"), _account(other_id, "other@example.com")]
            )
        await _seed_tasks(database, owner_id, 3)
        await _seed_tasks(database, other_id, 2)
        repository = SqlAlchemyAcademicTaskRepository(database)
        owner_tasks = [task.id for task in await repository.list(owner_id)]
        other_tasks = [task.id for task in await repository.list(other_id)]
        authentication = SwitchableAuthentication(owner_id)
        app = create_app(
            session_authentication=authentication,
            academic_tasks=AcademicTaskService(repository),
        )
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="https://test",
            cookies={"studyflow_session": "session"},
        ) as client:
            unpaged = await client.get("/api/v1/tasks")
            second_page = await client.get("/api/v1/tasks", params={"limit": 2, "offset": 2})
            authentication.account_id = other_id
            other = await client.get("/api/v1/tasks", params={"limit": 1})

        assert [item["id"] for item in unpaged.json()] == [str(task) for task in owner_tasks]
        assert unpaged.headers["x-total-count"] == "3"
        assert [item["id"] for item in second_page.json()] == [str(owner_tasks[2])]
        assert second_page.headers["x-total-count"] == "3"
        assert [item["id"] for item in other.json()] == [str(other_tasks[0])]
        assert other.headers["x-total-count"] == "2"
    finally:
        await database.stop()
