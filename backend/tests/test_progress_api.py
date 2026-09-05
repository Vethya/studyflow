from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import cast
from uuid import UUID, uuid4

import pytest
from fastapi import Request
from httpx import ASGITransport, AsyncClient

from studyflow.api.progress import (
    _response,
    get_academic_tasks,
    get_study_sessions,
)
from studyflow.app import create_app
from studyflow.auth.session_authentication import SessionPrincipal
from studyflow.progress import EffortProgressRecord
from studyflow.scheduling.outcomes import (
    SessionOutcomeKind,
    StudySessionDetails,
    StudySessionFilters,
    StudySessionOutcomeRecord,
    StudySessions,
)
from studyflow.scheduling.proposals import StudySessionRecord
from studyflow.tasks.service import (
    AcademicTaskRecord,
    AcademicTasks,
    NewAcademicTask,
    TaskCategory,
    TaskFilters,
    TaskPriority,
    TaskStatus,
)

ACCOUNT_ID = UUID("00000000-0000-0000-0000-000000000001")
TASK_ID = UUID("00000000-0000-0000-0000-000000000002")
NOW = datetime(2026, 9, 5, 12, 0, 0, tzinfo=UTC)


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
    records: list[AcademicTaskRecord] = field(default_factory=list)
    listed_account_id: UUID | None = None

    async def create(self, account_id: UUID, task: NewAcademicTask) -> AcademicTaskRecord:
        raise NotImplementedError

    async def list(
        self, account_id: UUID, filters: TaskFilters | None = None
    ) -> list[AcademicTaskRecord]:
        self.listed_account_id = account_id
        return self.records

    async def get(self, account_id: UUID, task_id: UUID) -> AcademicTaskRecord | None:
        return None

    async def update(
        self, account_id: UUID, task_id: UUID, task: NewAcademicTask
    ) -> AcademicTaskRecord | None:
        return None

    async def delete(self, account_id: UUID, task_id: UUID) -> bool:
        return False

    async def finish_early(self, account_id: UUID, task_id: UUID) -> bool:
        return False

    async def mark_started(self, account_id: UUID, task_id: UUID) -> bool:
        return False


@dataclass
class StudySessionsStub:
    sessions: list[StudySessionDetails] = field(default_factory=list)
    adjustments: dict[UUID, int] = field(default_factory=dict)
    listed_account_id: UUID | None = None
    adjustments_account_id: UUID | None = None

    async def list(
        self, account_id: UUID, filters: StudySessionFilters
    ) -> list[StudySessionDetails]:
        self.listed_account_id = account_id
        return self.sessions

    async def get(self, account_id: UUID, session_id: UUID) -> StudySessionDetails | None:
        return None

    async def record_completed(
        self,
        account_id: UUID,
        session_id: UUID,
        actual_minutes: int,
        *,
        large_actual_confirmed: bool = False,
    ) -> StudySessionOutcomeRecord | None:
        return None

    async def record_delayed(
        self,
        account_id: UUID,
        session_id: UUID,
        actual_minutes: int,
        remaining_minutes: int | None = None,
        *,
        large_actual_confirmed: bool = False,
    ) -> StudySessionOutcomeRecord | None:
        return None

    async def record_missed(
        self, account_id: UUID, session_id: UUID
    ) -> StudySessionOutcomeRecord | None:
        return None

    async def task_actual_minutes(self, account_id: UUID, task_id: UUID) -> int:
        return 0

    async def task_schedule_adjustments(self, account_id: UUID) -> dict[UUID, int]:
        self.adjustments_account_id = account_id
        return self.adjustments


def sample_task() -> AcademicTaskRecord:
    return AcademicTaskRecord(
        id=TASK_ID,
        account_id=ACCOUNT_ID,
        title="Operating Systems Project",
        category=TaskCategory.PROJECT,
        priority=TaskPriority.HIGH,
        course="CS301",
        notes=None,
        deadline_at=NOW + timedelta(days=5),
        original_estimate_minutes=180,
        planned_duration_minutes=180,
        created_at=NOW - timedelta(days=2),
        updated_at=NOW - timedelta(days=2),
        status=TaskStatus.IN_PROGRESS,
    )


def sample_session_details(task_id: UUID) -> StudySessionDetails:
    session_id = uuid4()
    return StudySessionDetails(
        session=StudySessionRecord(
            id=session_id,
            account_id=ACCOUNT_ID,
            task_id=task_id,
            proposal_id=None,
            starts_at=NOW - timedelta(hours=3),
            ends_at=NOW - timedelta(hours=2),
            planned_duration_minutes=60,
        ),
        outcome=StudySessionOutcomeRecord(
            session_id=session_id,
            kind=SessionOutcomeKind.COMPLETED,
            actual_minutes=60,
            remaining_minutes=120,
            recorded_at=NOW - timedelta(hours=2),
            rescheduled_at=None,
        ),
    )


@pytest.mark.anyio
async def test_list_effort_progress_unauthorized() -> None:
    app = create_app(
        session_authentication=AuthenticationStub(authenticated=False),
        academic_tasks=cast(AcademicTasks, TasksStub()),
        study_sessions=cast(StudySessions, StudySessionsStub()),
    )
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="https://test",
    ) as client:
        response = await client.get("/api/v1/progress")

    assert response.status_code == 401


@pytest.mark.anyio
async def test_list_effort_progress_authenticated() -> None:
    task = sample_task()
    session = sample_session_details(task.id)
    tasks_stub = TasksStub(records=[task])
    sessions_stub = StudySessionsStub(
        sessions=[session],
        adjustments={task.id: 60},
    )
    app = create_app(
        session_authentication=AuthenticationStub(authenticated=True),
        academic_tasks=cast(AcademicTasks, tasks_stub),
        study_sessions=cast(StudySessions, sessions_stub),
    )
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="https://test",
        cookies={"studyflow_session": "valid-token"},
    ) as client:
        response = await client.get("/api/v1/progress")

    assert response.status_code == 200
    assert tasks_stub.listed_account_id == ACCOUNT_ID
    assert sessions_stub.listed_account_id == ACCOUNT_ID
    assert sessions_stub.adjustments_account_id == ACCOUNT_ID

    data = response.json()
    assert len(data) == 1
    item = data[0]
    assert item["task_id"] == str(TASK_ID)
    assert item["task_title"] == "Operating Systems Project"
    assert item["actual_duration_minutes"] == 60
    assert item["estimated_remaining_minutes"] == 120
    assert item["effort_percent"] == 33
    assert item["sessions_completed"] == 1
    assert item["sessions_upcoming"] == 0
    assert item["status"] == "in_progress"


def test_dependency_getters_and_response_mapping() -> None:
    task_stub = TasksStub()
    sessions_stub = StudySessionsStub()

    class FakeState:
        academic_tasks = task_stub
        study_sessions = sessions_stub

    class FakeApp:
        state = FakeState()

    class FakeRequest:
        app = FakeApp()

    req = cast(Request, FakeRequest())
    assert get_academic_tasks(req) is task_stub
    assert get_study_sessions(req) is sessions_stub

    record = EffortProgressRecord(
        task_id=TASK_ID,
        task_title="Test Task",
        actual_duration_minutes=50,
        estimated_remaining_minutes=50,
        effort_percent=50,
        sessions_completed=1,
        sessions_upcoming=1,
        status=TaskStatus.IN_PROGRESS,
    )
    resp = _response(record)
    assert resp.task_id == TASK_ID
    assert resp.task_title == "Test Task"
    assert resp.actual_duration_minutes == 50
    assert resp.estimated_remaining_minutes == 50
    assert resp.effort_percent == 50
    assert resp.sessions_completed == 1
    assert resp.sessions_upcoming == 1
    assert resp.status is TaskStatus.IN_PROGRESS
