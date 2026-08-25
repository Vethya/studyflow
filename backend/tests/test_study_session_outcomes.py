from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import cast
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from studyflow.app import create_app
from studyflow.auth.session_authentication import SessionPrincipal
from studyflow.availability.unavailable import UnavailablePeriods
from studyflow.database import Base, Database
from studyflow.database.models import AcademicTask, StudentAccount
from studyflow.database.models import StudySession as SessionRow
from studyflow.database.models import StudySessionOutcome as OutcomeRow
from studyflow.scheduling.assembly import SchedulingInputTooLargeError
from studyflow.scheduling.outcome_repositories import SqlAlchemyStudySessionOutcomeRepository
from studyflow.scheduling.outcomes import (
    DuplicateSessionOutcomeError,
    FutureSessionOutcomeError,
    ProposedSessionOutcomeError,
    SessionOutcomeKind,
    StudySessionDetails,
    StudySessionFilters,
    StudySessionOutcomeRecord,
    StudySessions,
    StudySessionService,
)
from studyflow.scheduling.proposals import (
    ProposalKind,
    ProposalStatus,
    ScheduleProposalRecord,
    StudySessionRecord,
)
from studyflow.scheduling.recovery import InvalidRecoveryTriggerError, ScheduleRecovery
from studyflow.scheduling.service import ScheduleGenerationFailedError
from studyflow.tasks.service import AcademicTasks

NOW = datetime(2026, 8, 24, 12, tzinfo=UTC)
ACCOUNT_ID = UUID("00000000-0000-0000-0000-000000000001")
SESSION_ID = UUID("00000000-0000-0000-0000-000000000002")


@pytest.mark.anyio
async def test_missed_outcome_is_immutable_and_keeps_session_and_task_work() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    try:
        account_id, task_id, session_id = uuid4(), uuid4(), uuid4()
        async with database.transaction() as db_session:
            await db_session.run_sync(lambda sync: Base.metadata.create_all(sync.connection()))
            db_session.add_all(
                [
                    StudentAccount(
                        id=account_id,
                        email="student@example.com",
                        name="Student",
                        password_hash="$argon2id$hash",
                        email_verified_at=NOW,
                        timezone="UTC",
                    ),
                    AcademicTask(
                        id=task_id,
                        account_id=account_id,
                        title="Essay",
                        category="assignment",
                        deadline_at=NOW + timedelta(days=1),
                        original_estimate_minutes=60,
                        planned_duration_minutes=60,
                    ),
                    SessionRow(
                        id=session_id,
                        account_id=account_id,
                        task_id=task_id,
                        proposal_id=None,
                        starts_at=NOW - timedelta(hours=2),
                        ends_at=NOW - timedelta(hours=1),
                        planned_duration_minutes=60,
                    ),
                ]
            )
        service = StudySessionService(
            SqlAlchemyStudySessionOutcomeRepository(database), clock=lambda: NOW
        )

        outcome = await service.record_missed(account_id, session_id)

        assert outcome is not None
        assert (
            outcome.kind,
            outcome.actual_minutes,
            outcome.remaining_minutes,
            outcome.recorded_at,
            outcome.rescheduled_at,
        ) == (SessionOutcomeKind.MISSED, 0, 60, NOW, None)
        loaded = await service.get(account_id, session_id)
        assert loaded is not None and loaded.outcome == outcome
        with pytest.raises(DuplicateSessionOutcomeError):
            await service.record_missed(account_id, session_id)
        async with database.transaction() as db_session:
            session_row = await db_session.get(SessionRow, session_id)
            task_row = await db_session.get(AcademicTask, task_id)
        assert session_row is not None and session_row.planned_duration_minutes == 60
        assert task_row is not None and task_row.planned_duration_minutes == 60
        assert await service.get(uuid4(), session_id) is None
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_missed_outcome_rejects_future_and_proposed_sessions() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    try:
        account_id, task_id, proposal_id = uuid4(), uuid4(), uuid4()
        future_id, proposed_id = uuid4(), uuid4()
        async with database.transaction() as db_session:
            await db_session.run_sync(lambda sync: Base.metadata.create_all(sync.connection()))
            db_session.add(
                StudentAccount(
                    id=account_id,
                    email="student@example.com",
                    name="Student",
                    password_hash="$argon2id$hash",
                    email_verified_at=NOW,
                    timezone="UTC",
                )
            )
            db_session.add(
                AcademicTask(
                    id=task_id,
                    account_id=account_id,
                    title="Essay",
                    category="assignment",
                    deadline_at=NOW + timedelta(days=2),
                    original_estimate_minutes=60,
                    planned_duration_minutes=60,
                )
            )
            from studyflow.database.models import ScheduleProposal

            db_session.add(
                ScheduleProposal(
                    id=proposal_id,
                    account_id=account_id,
                    kind="generation",
                    revision_reason=None,
                    status="feasible",
                    input_fingerprint="a" * 64,
                )
            )
            db_session.add_all(
                [
                    SessionRow(
                        id=future_id,
                        account_id=account_id,
                        task_id=task_id,
                        proposal_id=None,
                        starts_at=NOW,
                        ends_at=NOW + timedelta(hours=1),
                        planned_duration_minutes=60,
                    ),
                    SessionRow(
                        id=proposed_id,
                        account_id=account_id,
                        task_id=task_id,
                        proposal_id=proposal_id,
                        starts_at=NOW - timedelta(hours=2),
                        ends_at=NOW - timedelta(hours=1),
                        planned_duration_minutes=60,
                    ),
                ]
            )
        service = StudySessionService(
            SqlAlchemyStudySessionOutcomeRepository(database), clock=lambda: NOW
        )
        with pytest.raises(FutureSessionOutcomeError):
            await service.record_missed(account_id, future_id)
        with pytest.raises(ProposedSessionOutcomeError):
            await service.record_missed(account_id, proposed_id)
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_list_sessions_is_owner_scoped_and_excludes_proposed_and_invalidated_rows() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    try:
        account_id, other_account_id, task_id, proposal_id = uuid4(), uuid4(), uuid4(), uuid4()
        accepted_id, proposed_id, invalidated_id, outside_id, other_id = (
            uuid4(),
            uuid4(),
            uuid4(),
            uuid4(),
            uuid4(),
        )
        from studyflow.database.models import ScheduleProposal

        async with database.transaction() as db_session:
            await db_session.run_sync(lambda sync: Base.metadata.create_all(sync.connection()))
            db_session.add_all(
                [
                    StudentAccount(
                        id=account_id,
                        email="student@example.com",
                        name="Student",
                        password_hash="$argon2id$hash",
                        email_verified_at=NOW,
                        timezone="UTC",
                    ),
                    StudentAccount(
                        id=other_account_id,
                        email="other@example.com",
                        name="Other",
                        password_hash="$argon2id$hash",
                        email_verified_at=NOW,
                        timezone="UTC",
                    ),
                    AcademicTask(
                        id=task_id,
                        account_id=account_id,
                        title="Essay",
                        category="assignment",
                        deadline_at=NOW + timedelta(days=3),
                        original_estimate_minutes=180,
                        planned_duration_minutes=180,
                    ),
                    ScheduleProposal(
                        id=proposal_id,
                        account_id=account_id,
                        kind="generation",
                        revision_reason=None,
                        status="feasible",
                        input_fingerprint="a" * 64,
                    ),
                ]
            )
            db_session.add_all(
                [
                    SessionRow(
                        id=accepted_id,
                        account_id=account_id,
                        task_id=task_id,
                        proposal_id=None,
                        starts_at=NOW - timedelta(minutes=30),
                        ends_at=NOW + timedelta(minutes=30),
                        planned_duration_minutes=60,
                    ),
                    SessionRow(
                        id=proposed_id,
                        account_id=account_id,
                        task_id=task_id,
                        proposal_id=proposal_id,
                        starts_at=NOW,
                        ends_at=NOW + timedelta(hours=1),
                        planned_duration_minutes=60,
                    ),
                    SessionRow(
                        id=invalidated_id,
                        account_id=account_id,
                        task_id=task_id,
                        proposal_id=None,
                        starts_at=NOW,
                        ends_at=NOW + timedelta(hours=1),
                        planned_duration_minutes=60,
                        invalidated_at=NOW - timedelta(hours=1),
                        invalidation_reason="availability",
                    ),
                    SessionRow(
                        id=outside_id,
                        account_id=account_id,
                        task_id=task_id,
                        proposal_id=None,
                        starts_at=NOW + timedelta(days=2),
                        ends_at=NOW + timedelta(days=2, hours=1),
                        planned_duration_minutes=60,
                    ),
                    SessionRow(
                        id=other_id,
                        account_id=other_account_id,
                        task_id=task_id,
                        proposal_id=None,
                        starts_at=NOW,
                        ends_at=NOW + timedelta(hours=1),
                        planned_duration_minutes=60,
                    ),
                ]
            )
            db_session.add(
                OutcomeRow(
                    session_id=accepted_id,
                    kind="missed",
                    actual_minutes=0,
                    remaining_minutes=60,
                    recorded_at=NOW,
                    rescheduled_at=None,
                )
            )

        service = StudySessionService(SqlAlchemyStudySessionOutcomeRepository(database))
        listed = await service.list(
            account_id,
            StudySessionFilters(
                starts_from=NOW,
                starts_to=NOW + timedelta(days=1),
                task_id=task_id,
            ),
        )

        assert [details.session.id for details in listed] == [accepted_id]
        assert listed[0].outcome is not None
        assert listed[0].outcome.kind is SessionOutcomeKind.MISSED
    finally:
        await database.stop()


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
class StudySessionsStub:
    details: StudySessionDetails | None
    outcome: StudySessionOutcomeRecord | None
    error: Exception | None = None
    recorded: bool = False
    listed: list[StudySessionDetails] = field(default_factory=list)
    filters: StudySessionFilters | None = None

    async def list(
        self, account_id: UUID, filters: StudySessionFilters
    ) -> list[StudySessionDetails]:
        self.filters = filters
        return self.listed

    async def get(self, account_id: UUID, session_id: UUID) -> StudySessionDetails | None:
        return self.details

    async def record_missed(
        self, account_id: UUID, session_id: UUID
    ) -> StudySessionOutcomeRecord | None:
        if self.error is not None:
            raise self.error
        self.recorded = True
        return self.outcome


@dataclass
class RecoveryStub:
    result: ScheduleProposalRecord | None
    error: Exception | None = None

    async def propose(
        self, account_id: UUID, missed_session_id: UUID
    ) -> ScheduleProposalRecord | None:
        if self.error is not None:
            raise self.error
        return self.result


class EmptyTasksStub:
    async def list(self, account_id: UUID, filters: object = None) -> list[object]:
        return []


class EmptyUnavailableStub:
    async def list_periods(self, account_id: UUID) -> list[object]:
        return []


def _revision() -> ScheduleProposalRecord:
    return ScheduleProposalRecord(
        uuid4(),
        ACCOUNT_ID,
        ProposalKind.REVISION,
        "Missed study session",
        ProposalStatus.FEASIBLE,
        "a" * 64,
        NOW,
        (),
        (),
    )


def _api(
    stub: StudySessionsStub,
    *,
    authenticated: bool = True,
    recovery: RecoveryStub | None = None,
) -> FastAPI:
    return create_app(
        session_authentication=AuthenticationStub(authenticated),
        study_sessions=cast(StudySessions, stub),
        schedule_recovery=cast(ScheduleRecovery, recovery or RecoveryStub(_revision())),
        academic_tasks=cast(AcademicTasks, EmptyTasksStub()),
        unavailable_periods=cast(UnavailablePeriods, EmptyUnavailableStub()),
    )


@pytest.mark.anyio
async def test_study_session_api_gets_and_records_missed_with_csrf() -> None:
    session = StudySessionRecord(
        SESSION_ID,
        ACCOUNT_ID,
        uuid4(),
        None,
        NOW - timedelta(hours=2),
        NOW - timedelta(hours=1),
        60,
    )
    outcome = StudySessionOutcomeRecord(SESSION_ID, SessionOutcomeKind.MISSED, 0, 60, NOW, None)
    application = _api(StudySessionsStub(StudySessionDetails(session, None), outcome))
    async with AsyncClient(
        transport=ASGITransport(app=application),
        base_url="https://test",
        cookies={"studyflow_session": "session"},
    ) as client:
        fetched = await client.get(f"/api/v1/study-sessions/{SESSION_ID}")
        missing_csrf = await client.post(
            f"/api/v1/study-sessions/{SESSION_ID}/outcomes", json={"outcome": "missed"}
        )
        recorded = await client.post(
            f"/api/v1/study-sessions/{SESSION_ID}/outcomes",
            json={"outcome": "missed"},
            headers={"X-CSRF-Token": "csrf"},
        )

    assert fetched.status_code == 200 and fetched.json()["outcome"] is None
    assert missing_csrf.status_code == 403
    assert recorded.status_code == 201
    assert recorded.headers["location"] == "/api/v1/schedule-proposals/current"
    assert recorded.json()["outcome"]["kind"] == "missed"
    assert recorded.json()["outcome"]["remaining_minutes"] == 60
    assert recorded.json()["revision"]["kind"] == "revision"


@pytest.mark.anyio
async def test_study_session_api_lists_sessions_with_filters() -> None:
    task_id = uuid4()
    session = StudySessionRecord(
        SESSION_ID,
        ACCOUNT_ID,
        task_id,
        None,
        NOW - timedelta(hours=2),
        NOW - timedelta(hours=1),
        60,
    )
    outcome = StudySessionOutcomeRecord(SESSION_ID, SessionOutcomeKind.MISSED, 0, 60, NOW, None)
    sessions = StudySessionsStub(
        StudySessionDetails(session, outcome),
        outcome,
        listed=[StudySessionDetails(session, outcome)],
    )
    application = _api(sessions)

    async with AsyncClient(
        transport=ASGITransport(app=application),
        base_url="https://test",
        cookies={"studyflow_session": "session"},
    ) as client:
        response = await client.get(
            "/api/v1/study-sessions",
            params={
                "from": (NOW - timedelta(days=1)).isoformat(),
                "to": (NOW + timedelta(days=1)).isoformat(),
                "task_id": str(task_id),
            },
        )

    assert response.status_code == 200
    assert response.json() == [
        {
            "id": str(SESSION_ID),
            "task_id": str(task_id),
            "starts_at": "2026-08-24T10:00:00Z",
            "ends_at": "2026-08-24T11:00:00Z",
            "planned_duration_minutes": 60,
            "outcome": {
                "session_id": str(SESSION_ID),
                "kind": "missed",
                "actual_minutes": 0,
                "remaining_minutes": 60,
                "recorded_at": "2026-08-24T12:00:00Z",
                "rescheduled_at": None,
            },
        }
    ]
    assert sessions.filters == StudySessionFilters(
        starts_from=NOW - timedelta(days=1),
        starts_to=NOW + timedelta(days=1),
        task_id=task_id,
    )


@pytest.mark.anyio
async def test_study_session_api_validates_list_time_range_and_authentication() -> None:
    sessions = StudySessionsStub(None, None)
    application = _api(sessions)
    unauthenticated = _api(StudySessionsStub(None, None), authenticated=False)

    async with AsyncClient(
        transport=ASGITransport(app=application),
        base_url="https://test",
        cookies={"studyflow_session": "session"},
    ) as client:
        empty = await client.get("/api/v1/study-sessions")
        naive = await client.get("/api/v1/study-sessions", params={"from": "2026-08-24T10:00:00"})
        reversed_range = await client.get(
            "/api/v1/study-sessions",
            params={
                "from": "2026-08-24T12:00:00Z",
                "to": "2026-08-24T10:00:00Z",
            },
        )
    async with AsyncClient(
        transport=ASGITransport(app=unauthenticated),
        base_url="https://test",
        cookies={"studyflow_session": "session"},
    ) as client:
        unauthorized = await client.get("/api/v1/study-sessions")

    assert empty.status_code == 200 and empty.json() == []
    assert sessions.filters == StudySessionFilters()
    assert naive.status_code == 422
    assert reversed_range.status_code == 422
    assert unauthorized.status_code == 401


@pytest.mark.anyio
async def test_study_session_api_hides_cross_user_and_maps_conflicts() -> None:
    missing_app = _api(StudySessionsStub(None, None))
    conflict_app = _api(
        StudySessionsStub(None, None, DuplicateSessionOutcomeError("Already recorded"))
    )
    async with AsyncClient(
        transport=ASGITransport(app=missing_app),
        base_url="https://test",
        cookies={"studyflow_session": "session"},
    ) as client:
        missing_get = await client.get(f"/api/v1/study-sessions/{SESSION_ID}")
        missing_post = await client.post(
            f"/api/v1/study-sessions/{SESSION_ID}/outcomes",
            json={"outcome": "missed"},
            headers={"X-CSRF-Token": "csrf"},
        )
    async with AsyncClient(
        transport=ASGITransport(app=conflict_app),
        base_url="https://test",
        cookies={"studyflow_session": "session"},
    ) as client:
        conflict = await client.post(
            f"/api/v1/study-sessions/{SESSION_ID}/outcomes",
            json={"outcome": "missed"},
            headers={"X-CSRF-Token": "csrf"},
        )

    assert missing_get.status_code == 404
    assert missing_post.status_code == 404
    assert conflict.status_code == 409


@pytest.mark.anyio
async def test_recovery_failure_returns_503_after_missed_outcome_is_recorded() -> None:
    session = StudySessionRecord(
        SESSION_ID,
        ACCOUNT_ID,
        uuid4(),
        None,
        NOW - timedelta(hours=2),
        NOW - timedelta(hours=1),
        60,
    )
    outcome = StudySessionOutcomeRecord(SESSION_ID, SessionOutcomeKind.MISSED, 0, 60, NOW, None)
    sessions = StudySessionsStub(StudySessionDetails(session, None), outcome)
    application = _api(
        sessions,
        recovery=RecoveryStub(None, ScheduleGenerationFailedError("Solver failed")),
    )
    async with AsyncClient(
        transport=ASGITransport(app=application),
        base_url="https://test",
        cookies={"studyflow_session": "session"},
    ) as client:
        response = await client.post(
            f"/api/v1/study-sessions/{SESSION_ID}/outcomes",
            json={"outcome": "missed"},
            headers={"X-CSRF-Token": "csrf"},
        )

    assert response.status_code == 503
    assert sessions.recorded and sessions.outcome == outcome


@pytest.mark.anyio
async def test_unresolved_missed_outcome_retries_recovery_without_duplicate_insert() -> None:
    session = StudySessionRecord(
        SESSION_ID,
        ACCOUNT_ID,
        uuid4(),
        None,
        NOW - timedelta(hours=2),
        NOW - timedelta(hours=1),
        60,
    )
    outcome = StudySessionOutcomeRecord(SESSION_ID, SessionOutcomeKind.MISSED, 0, 60, NOW, None)
    sessions = StudySessionsStub(StudySessionDetails(session, outcome), outcome)
    application = _api(sessions)
    async with AsyncClient(
        transport=ASGITransport(app=application),
        base_url="https://test",
        cookies={"studyflow_session": "session"},
    ) as client:
        response = await client.post(
            f"/api/v1/study-sessions/{SESSION_ID}/outcomes",
            json={"outcome": "missed"},
            headers={"X-CSRF-Token": "csrf"},
        )

    assert response.status_code == 201
    assert response.json()["outcome"]["kind"] == "missed"
    assert not sessions.recorded


@pytest.mark.anyio
async def test_retry_maps_invalid_recovery_trigger_to_conflict() -> None:
    session = StudySessionRecord(
        SESSION_ID,
        ACCOUNT_ID,
        uuid4(),
        None,
        NOW - timedelta(hours=2),
        NOW - timedelta(hours=1),
        60,
    )
    outcome = StudySessionOutcomeRecord(SESSION_ID, SessionOutcomeKind.MISSED, 0, 60, NOW, None)
    sessions = StudySessionsStub(StudySessionDetails(session, outcome), outcome)
    application = _api(
        sessions,
        recovery=RecoveryStub(
            None,
            InvalidRecoveryTriggerError("Recovery trigger is no longer unresolved"),
        ),
    )
    async with AsyncClient(
        transport=ASGITransport(app=application),
        base_url="https://test",
        cookies={"studyflow_session": "session"},
    ) as client:
        response = await client.post(
            f"/api/v1/study-sessions/{SESSION_ID}/outcomes",
            json={"outcome": "missed"},
            headers={"X-CSRF-Token": "csrf"},
        )

    assert response.status_code == 409
    assert response.json()["detail"] == "Recovery trigger is no longer unresolved"
    assert not sessions.recorded


@pytest.mark.anyio
async def test_recovery_input_too_large_maps_to_documented_422() -> None:
    session = StudySessionRecord(
        SESSION_ID,
        ACCOUNT_ID,
        uuid4(),
        None,
        NOW - timedelta(hours=2),
        NOW - timedelta(hours=1),
        60,
    )
    outcome = StudySessionOutcomeRecord(SESSION_ID, SessionOutcomeKind.MISSED, 0, 60, NOW, None)
    sessions = StudySessionsStub(StudySessionDetails(session, outcome), outcome)
    application = _api(
        sessions,
        recovery=RecoveryStub(None, SchedulingInputTooLargeError("Recovery is too large")),
    )
    async with AsyncClient(
        transport=ASGITransport(app=application),
        base_url="https://test",
        cookies={"studyflow_session": "session"},
    ) as client:
        response = await client.post(
            f"/api/v1/study-sessions/{SESSION_ID}/outcomes",
            json={"outcome": "missed"},
            headers={"X-CSRF-Token": "csrf"},
        )

    operation = application.openapi()["paths"]["/api/v1/study-sessions/{session_id}/outcomes"][
        "post"
    ]
    assert response.status_code == 422
    assert response.json()["detail"] == "Recovery is too large"
    assert "422" in operation["responses"]
