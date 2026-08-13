from dataclasses import dataclass, field
from datetime import UTC, datetime
from uuid import UUID

import pytest
from httpx import ASGITransport, AsyncClient

from studyflow.app import create_app
from studyflow.auth.session_authentication import SessionPrincipal
from studyflow.tasks.service import (
    AcademicTaskRecord,
    InvalidTaskDeadlineError,
    NewAcademicTask,
    TaskCategory,
    TaskFilters,
    TaskPriority,
)

ACCOUNT_ID = UUID("5b15bfef-8c44-45d5-a70e-574beb999fb3")
TASK_ID = UUID("f53012c2-7a44-4571-a401-9dc69f33d77f")


@dataclass
class AuthenticationStub:
    authenticated: bool = True

    async def authenticate(
        self, session_token: str, csrf_token: str | None = None
    ) -> SessionPrincipal | None:
        return (
            SessionPrincipal(ACCOUNT_ID, "student@example.com", "Student")
            if self.authenticated
            else None
        )

    async def revoke(self, session_token: str, csrf_token: str) -> bool:
        return False


@dataclass
class TasksStub:
    records: list[AcademicTaskRecord]
    creates: list[tuple[UUID, NewAcademicTask]] = field(default_factory=list)
    filters: list[TaskFilters] = field(default_factory=list)
    create_failure: bool = False

    async def create(self, account_id: UUID, task: NewAcademicTask) -> AcademicTaskRecord:
        if self.create_failure:
            raise InvalidTaskDeadlineError
        self.creates.append((account_id, task))
        return self.records[0]

    async def list(
        self, account_id: UUID, filters: TaskFilters | None = None
    ) -> list[AcademicTaskRecord]:
        self.filters.append(filters or TaskFilters())
        return self.records

    async def get(self, account_id: UUID, task_id: UUID) -> AcademicTaskRecord | None:
        return next((task for task in self.records if task.id == task_id), None)


def task_record() -> AcademicTaskRecord:
    now = datetime(2026, 7, 29, 12, tzinfo=UTC)
    return AcademicTaskRecord(
        TASK_ID,
        ACCOUNT_ID,
        "Read chapter 4",
        TaskCategory.READING,
        TaskPriority.MEDIUM,
        None,
        None,
        datetime(2026, 7, 30, 12, tzinfo=UTC),
        90,
        90,
        now,
        now,
    )


@pytest.mark.anyio
async def test_task_create_list_and_detail_contract() -> None:
    tasks = TasksStub([task_record()])
    app = create_app(session_authentication=AuthenticationStub(), academic_tasks=tasks)
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="https://test",
        cookies={"__Host-studyflow_session": "session-token"},
    ) as client:
        created = await client.post(
            "/api/v1/tasks",
            headers={"X-CSRF-Token": "csrf-token"},
            json={
                "title": "Read chapter 4",
                "category": "reading",
                "deadline_at": "2026-07-30T12:00:00Z",
                "original_estimate_minutes": 90,
            },
        )
        listed = await client.get(
            "/api/v1/tasks",
            params={"course": "Algorithms", "category": "reading", "priority": "medium"},
        )
        detail = await client.get(f"/api/v1/tasks/{TASK_ID}")

    assert created.status_code == 201
    assert listed.status_code == 200 and len(listed.json()) == 1
    assert detail.status_code == 200
    assert detail.json()["planned_duration_minutes"] == 90
    assert tasks.creates[0][0] == ACCOUNT_ID
    assert tasks.creates[0][1].priority is TaskPriority.MEDIUM
    assert tasks.filters[0] == TaskFilters(
        course="Algorithms", category=TaskCategory.READING, priority=TaskPriority.MEDIUM
    )


@pytest.mark.anyio
async def test_task_detail_returns_404_for_unowned_or_missing_id() -> None:
    app = create_app(session_authentication=AuthenticationStub(), academic_tasks=TasksStub([]))
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="https://test",
        cookies={"__Host-studyflow_session": "session-token"},
    ) as client:
        response = await client.get(f"/api/v1/tasks/{TASK_ID}")

    assert response.status_code == 404


@pytest.mark.anyio
async def test_task_endpoints_require_authentication_csrf_and_valid_absolute_fields() -> None:
    record = task_record()
    unauthenticated = create_app(
        session_authentication=AuthenticationStub(authenticated=False),
        academic_tasks=TasksStub([record]),
    )
    invalid_deadline_tasks = TasksStub([record], create_failure=True)
    authenticated = create_app(
        session_authentication=AuthenticationStub(), academic_tasks=invalid_deadline_tasks
    )
    cookies = {"__Host-studyflow_session": "session-token"}
    valid_payload = {
        "title": "Read chapter 4",
        "category": "reading",
        "deadline_at": "2026-07-30T12:00:00Z",
        "original_estimate_minutes": 90,
    }
    async with AsyncClient(
        transport=ASGITransport(app=unauthenticated), base_url="https://test", cookies=cookies
    ) as client:
        unauthenticated_read = await client.get("/api/v1/tasks")
    async with AsyncClient(
        transport=ASGITransport(app=authenticated), base_url="https://test", cookies=cookies
    ) as client:
        missing_csrf = await client.post("/api/v1/tasks", json=valid_payload)
        naive = await client.post(
            "/api/v1/tasks",
            headers={"X-CSRF-Token": "csrf-token"},
            json={**valid_payload, "deadline_at": "2026-07-30T12:00:00"},
        )
        overflow = await client.post(
            "/api/v1/tasks",
            headers={"X-CSRF-Token": "csrf-token"},
            json={**valid_payload, "original_estimate_minutes": 2_147_483_648},
        )
        past = await client.post(
            "/api/v1/tasks",
            headers={"X-CSRF-Token": "csrf-token"},
            json=valid_payload,
        )

    assert unauthenticated_read.status_code == 401
    assert missing_csrf.status_code == 403
    assert naive.status_code == 422
    assert overflow.status_code == 422
    assert past.status_code == 422
