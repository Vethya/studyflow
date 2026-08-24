from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import cast
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from studyflow.app import create_app
from studyflow.auth.session_authentication import SessionPrincipal
from studyflow.scheduling import (
    AvailabilityTimezoneConfirmationRequiredError,
    ProposalKind,
    ProposalStatus,
    ScheduleGeneration,
    ScheduleGenerationFailedError,
    SchedulingInputTooLargeError,
)
from studyflow.scheduling.proposals import (
    ScheduleProposalRecord,
    ScheduleProposalRepository,
    StudySessionRecord,
    TaskAllocationRecord,
)
from studyflow.tasks.service import (
    AcademicTaskRecord,
    AcademicTasks,
    TaskCategory,
    TaskPriority,
)

ACCOUNT_ID = UUID("00000000-0000-0000-0000-000000000001")
TASK_ID = UUID("00000000-0000-0000-0000-000000000002")


@dataclass
class AuthenticationStub:
    authenticated: bool = True

    async def authenticate(
        self, session_token: str, csrf_token: str | None = None
    ) -> SessionPrincipal | None:
        if not self.authenticated:
            return None
        return SessionPrincipal(ACCOUNT_ID, "student@example.com", "Student")

    async def revoke(self, session_token: str, csrf_token: str) -> bool:
        return False


@dataclass
class GenerationStub:
    result: ScheduleProposalRecord | None = None
    error: Exception | None = None

    async def generate(self, account_id: UUID, **kwargs: object) -> ScheduleProposalRecord | None:
        if self.error is not None:
            raise self.error
        return self.result


@dataclass
class ProposalsStub:
    result: ScheduleProposalRecord | None

    async def get(self, account_id: UUID) -> ScheduleProposalRecord | None:
        return self.result


@dataclass
class TasksStub:
    records: list[AcademicTaskRecord]

    async def list(self, account_id: UUID, filters: object = None) -> list[AcademicTaskRecord]:
        return self.records


def _task() -> AcademicTaskRecord:
    now = datetime(2026, 8, 24, tzinfo=UTC)
    return AcademicTaskRecord(
        TASK_ID,
        ACCOUNT_ID,
        "Calculus exam",
        TaskCategory.EXAM_PREPARATION,
        TaskPriority.HIGH,
        None,
        None,
        now + timedelta(days=2),
        60,
        60,
        now,
        now,
    )


def _proposal() -> ScheduleProposalRecord:
    proposal_id = uuid4()
    early = datetime(2026, 8, 25, 9, tzinfo=UTC)
    late = datetime(2026, 8, 25, 11, tzinfo=UTC)
    return ScheduleProposalRecord(
        proposal_id,
        ACCOUNT_ID,
        ProposalKind.GENERATION,
        None,
        ProposalStatus.OVERLOAD,
        "a" * 64,
        datetime(2026, 8, 24, 12, tzinfo=UTC),
        (
            StudySessionRecord(
                uuid4(), ACCOUNT_ID, TASK_ID, proposal_id, late, late + timedelta(minutes=15), 15
            ),
            StudySessionRecord(
                uuid4(),
                ACCOUNT_ID,
                TASK_ID,
                proposal_id,
                early,
                early + timedelta(minutes=15),
                15,
            ),
        ),
        (
            TaskAllocationRecord(
                proposal_id,
                TASK_ID,
                datetime(2026, 8, 26, 12, tzinfo=UTC),
                60,
                30,
                30,
                120,
                30,
                30,
            ),
        ),
    )


def _app(
    generation: GenerationStub,
    proposals: ProposalsStub,
    *,
    authenticated: bool = True,
) -> FastAPI:
    return create_app(
        session_authentication=AuthenticationStub(authenticated),
        schedule_generation=cast(ScheduleGeneration, generation),
        schedule_proposals=cast(ScheduleProposalRepository, proposals),
        academic_tasks=cast(AcademicTasks, TasksStub([_task()])),
    )


@pytest.mark.anyio
async def test_generate_and_get_preview_with_overload_details() -> None:
    proposal = _proposal()
    application = _app(GenerationStub(proposal), ProposalsStub(proposal))
    async with AsyncClient(
        transport=ASGITransport(app=application),
        base_url="https://test",
        cookies={"studyflow_session": "session"},
    ) as client:
        generated = await client.post(
            "/api/v1/schedule-proposals", headers={"X-CSRF-Token": "csrf"}
        )
        current = await client.get("/api/v1/schedule-proposals/current")

    assert generated.status_code == 201
    assert current.status_code == 200
    body = generated.json()
    assert body["status"] == "overload"
    assert [item["starts_at"] for item in body["sessions"]] == sorted(
        item["starts_at"] for item in body["sessions"]
    )
    assert body["sessions"][0]["task_title"] == "Calculus exam"
    assert body["unscheduled_work"] == [
        {
            "task_id": str(TASK_ID),
            "task_title": "Calculus exam",
            "required_minutes": 60,
            "available_minutes_before_deadline": 30,
            "shortfall_minutes": 30,
            "unscheduled_minutes": 30,
        }
    ]
    assert body["overload_warning"]["remedies"] == [
        "extend_deadline",
        "add_availability",
    ]
    assert len(body["task_allocations"]) == 1


@pytest.mark.anyio
async def test_proposal_endpoints_enforce_session_and_csrf_and_map_missing() -> None:
    application = _app(GenerationStub(None), ProposalsStub(None))
    async with AsyncClient(
        transport=ASGITransport(app=application), base_url="https://test"
    ) as client:
        unauthenticated = await client.get("/api/v1/schedule-proposals/current")
        client.cookies.set("studyflow_session", "session")
        missing_csrf = await client.post("/api/v1/schedule-proposals")
        missing_generated = await client.post(
            "/api/v1/schedule-proposals", headers={"X-CSRF-Token": "csrf"}
        )
        missing_current = await client.get("/api/v1/schedule-proposals/current")

    assert unauthenticated.status_code == 401
    assert missing_csrf.status_code == 403
    assert missing_generated.status_code == 404
    assert missing_current.status_code == 404


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("error", "expected_status"),
    [
        (AvailabilityTimezoneConfirmationRequiredError("Confirm timezone"), 409),
        (SchedulingInputTooLargeError("Too large"), 422),
        (ScheduleGenerationFailedError("Solver timeout"), 503),
    ],
)
async def test_generation_maps_domain_failures(error: Exception, expected_status: int) -> None:
    application = _app(GenerationStub(error=error), ProposalsStub(None))
    async with AsyncClient(
        transport=ASGITransport(app=application),
        base_url="https://test",
        cookies={"studyflow_session": "session"},
    ) as client:
        response = await client.post("/api/v1/schedule-proposals", headers={"X-CSRF-Token": "csrf"})

    assert response.status_code == expected_status


def test_schedule_proposal_openapi_contract() -> None:
    schema = _app(GenerationStub(), ProposalsStub(None)).openapi()

    assert "/api/v1/schedule-proposals" in schema["paths"]
    assert "/api/v1/schedule-proposals/current" in schema["paths"]
    assert schema["paths"]["/api/v1/schedule-proposals"]["post"]["responses"]["201"]
    assert {"409", "422", "503"}.issubset(
        schema["paths"]["/api/v1/schedule-proposals"]["post"]["responses"]
    )
