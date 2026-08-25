from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import cast
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from studyflow.app import create_app
from studyflow.auth.session_authentication import SessionPrincipal
from studyflow.availability.unavailable import UnavailablePeriod, UnavailablePeriods
from studyflow.scheduling import (
    AvailabilityTimezoneConfirmationRequiredError,
    ProposalKind,
    ProposalNotFeasibleError,
    ProposalStatus,
    ScheduleAcceptance,
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
class AcceptanceStub:
    result: tuple[StudySessionRecord, ...] | None = None
    error: Exception | None = None
    reject_result: bool = True

    async def accept(
        self, account_id: UUID, proposal_id: UUID
    ) -> tuple[StudySessionRecord, ...] | None:
        if self.error is not None:
            raise self.error
        return self.result

    async def reject(self, account_id: UUID, proposal_id: UUID) -> bool:
        return self.reject_result


@dataclass
class TasksStub:
    records: list[AcademicTaskRecord]

    async def list(self, account_id: UUID, filters: object = None) -> list[AcademicTaskRecord]:
        return self.records


@dataclass
class UnavailablePeriodsStub:
    periods: list[UnavailablePeriod]

    async def list_periods(self, account_id: UUID) -> list[UnavailablePeriod]:
        return self.periods


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
    unavailable_periods: list[UnavailablePeriod] | None = None,
    acceptance: AcceptanceStub | None = None,
) -> FastAPI:
    return create_app(
        session_authentication=AuthenticationStub(authenticated),
        schedule_generation=cast(ScheduleGeneration, generation),
        schedule_proposals=cast(ScheduleProposalRepository, proposals),
        academic_tasks=cast(AcademicTasks, TasksStub([_task()])),
        unavailable_periods=cast(
            UnavailablePeriods,
            UnavailablePeriodsStub(unavailable_periods or []),
        ),
        schedule_acceptance=cast(ScheduleAcceptance, acceptance or AcceptanceStub()),
    )


@pytest.mark.anyio
async def test_generate_and_get_preview_with_overload_details() -> None:
    proposal = _proposal()
    relevant_period = UnavailablePeriod(
        uuid4(),
        datetime(2026, 8, 25, 13, tzinfo=UTC),
        datetime(2026, 8, 25, 14, tzinfo=UTC),
        "Doctor appointment",
    )
    after_deadline = UnavailablePeriod(
        uuid4(),
        datetime(2026, 8, 26, 12, tzinfo=UTC),
        datetime(2026, 8, 26, 13, tzinfo=UTC),
        None,
    )
    application = _app(
        GenerationStub(proposal),
        ProposalsStub(proposal),
        unavailable_periods=[after_deadline, relevant_period],
    )
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
    assert body["overload_warning"]["relevant_unavailable_periods"] == [
        {
            "id": str(relevant_period.id),
            "starts_at": "2026-08-25T13:00:00Z",
            "ends_at": "2026-08-25T14:00:00Z",
            "reason": "Doctor appointment",
        }
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
    assert "/api/v1/schedule-proposals/{proposal_id}/accept" in schema["paths"]
    assert "/api/v1/schedule-proposals/{proposal_id}/reject" in schema["paths"]


@pytest.mark.anyio
async def test_accept_and_reject_proposal_are_csrf_protected() -> None:
    proposal = _proposal()
    acceptance = AcceptanceStub(tuple(proposal.sessions))
    application = _app(GenerationStub(proposal), ProposalsStub(proposal), acceptance=acceptance)
    async with AsyncClient(
        transport=ASGITransport(app=application),
        base_url="https://test",
        cookies={"studyflow_session": "session"},
    ) as client:
        missing_csrf = await client.post(f"/api/v1/schedule-proposals/{proposal.id}/accept")
        accepted = await client.post(
            f"/api/v1/schedule-proposals/{proposal.id}/accept",
            headers={"X-CSRF-Token": "csrf"},
        )
        rejected = await client.post(
            f"/api/v1/schedule-proposals/{proposal.id}/reject",
            headers={"X-CSRF-Token": "csrf"},
        )

    assert missing_csrf.status_code == 403
    assert accepted.status_code == 200
    assert len(accepted.json()["sessions"]) == 2
    assert rejected.status_code == 204


@pytest.mark.anyio
async def test_acceptance_maps_missing_and_conflicting_proposals() -> None:
    proposal = _proposal()
    missing_app = _app(
        GenerationStub(),
        ProposalsStub(None),
        acceptance=AcceptanceStub(None, reject_result=False),
    )
    conflict_app = _app(
        GenerationStub(),
        ProposalsStub(proposal),
        acceptance=AcceptanceStub(error=ProposalNotFeasibleError("Overload")),
    )
    async with AsyncClient(
        transport=ASGITransport(app=missing_app),
        base_url="https://test",
        cookies={"studyflow_session": "session"},
    ) as client:
        missing_accept = await client.post(
            f"/api/v1/schedule-proposals/{proposal.id}/accept",
            headers={"X-CSRF-Token": "csrf"},
        )
        missing_reject = await client.post(
            f"/api/v1/schedule-proposals/{proposal.id}/reject",
            headers={"X-CSRF-Token": "csrf"},
        )
    async with AsyncClient(
        transport=ASGITransport(app=conflict_app),
        base_url="https://test",
        cookies={"studyflow_session": "session"},
    ) as client:
        conflict = await client.post(
            f"/api/v1/schedule-proposals/{proposal.id}/accept",
            headers={"X-CSRF-Token": "csrf"},
        )

    assert missing_accept.status_code == 404
    assert missing_reject.status_code == 404
    assert conflict.status_code == 409
