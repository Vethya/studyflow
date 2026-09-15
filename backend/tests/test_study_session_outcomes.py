from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any, cast
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
    InvalidSessionOutcomeError,
    LargeActualDurationConfirmationRequired,
    ProposedSessionOutcomeError,
    SessionOutcomeKind,
    StudySessionDetails,
    StudySessionFilters,
    StudySessionOutcomeRecord,
    StudySessionOutcomeRepositorySnapshots,
    StudySessions,
    StudySessionService,
    StudySessionSnapshots,
    read_task_schedule_adjustments,
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
async def test_completed_and_delayed_outcomes_record_actual_work_and_remaining_work() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    try:
        account_id, task_id = uuid4(), uuid4()
        completed_id, delayed_id = uuid4(), uuid4()
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
                        original_estimate_minutes=120,
                        planned_duration_minutes=120,
                    ),
                    SessionRow(
                        id=completed_id,
                        account_id=account_id,
                        task_id=task_id,
                        proposal_id=None,
                        starts_at=NOW - timedelta(hours=4),
                        ends_at=NOW - timedelta(hours=3),
                        planned_duration_minutes=60,
                    ),
                    SessionRow(
                        id=delayed_id,
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

        completed = await service.record_completed(account_id, completed_id, actual_minutes=75)
        delayed = await service.record_delayed(
            account_id,
            delayed_id,
            actual_minutes=40,
            remaining_minutes=35,
        )

        assert completed is not None
        assert (completed.kind, completed.actual_minutes, completed.remaining_minutes) == (
            SessionOutcomeKind.COMPLETED,
            75,
            0,
        )
        assert delayed is not None
        assert (delayed.kind, delayed.actual_minutes, delayed.remaining_minutes) == (
            SessionOutcomeKind.DELAYED,
            40,
            35,
        )
        assert await service.task_actual_minutes(account_id, task_id) == 115
        assert await service.task_actual_minutes(uuid4(), task_id) == 0
        async with database.transaction() as db_session:
            task = await db_session.get(AcademicTask, task_id)
        assert task is not None
        assert task.completed_at is None
        assert task.estimate_frozen_at is not None
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_delayed_defaults_remaining_and_completed_marks_the_task_complete() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    try:
        account_id = uuid4()
        delayed_task_id, completed_task_id = uuid4(), uuid4()
        delayed_id, completed_id = uuid4(), uuid4()
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
            for task_id, title in (
                (delayed_task_id, "Reading"),
                (completed_task_id, "Essay"),
            ):
                db_session.add(
                    AcademicTask(
                        id=task_id,
                        account_id=account_id,
                        title=title,
                        category="assignment",
                        deadline_at=NOW + timedelta(days=1),
                        original_estimate_minutes=60,
                        planned_duration_minutes=60,
                    )
                )
            db_session.add_all(
                [
                    SessionRow(
                        id=delayed_id,
                        account_id=account_id,
                        task_id=delayed_task_id,
                        proposal_id=None,
                        starts_at=NOW - timedelta(hours=4),
                        ends_at=NOW - timedelta(hours=3),
                        planned_duration_minutes=60,
                    ),
                    SessionRow(
                        id=completed_id,
                        account_id=account_id,
                        task_id=completed_task_id,
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

        delayed = await service.record_delayed(account_id, delayed_id, actual_minutes=25)
        assert delayed is not None and delayed.remaining_minutes == 35
        with pytest.raises(LargeActualDurationConfirmationRequired):
            await service.record_completed(account_id, completed_id, actual_minutes=121)
        completed = await service.record_completed(
            account_id,
            completed_id,
            actual_minutes=121,
            large_actual_confirmed=True,
        )

        assert completed is not None and completed.actual_minutes == 121
        async with database.transaction() as db_session:
            completed_task = await db_session.get(AcademicTask, completed_task_id)
        assert completed_task is not None
        assert completed_task.completed_at is not None
        assert completed_task.completed_at.replace(tzinfo=UTC) == NOW
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_outcome_validation_rejects_nonpositive_actual_or_remaining_minutes() -> None:
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

        with pytest.raises(InvalidSessionOutcomeError):
            await service.record_completed(account_id, session_id, actual_minutes=0)
        with pytest.raises(InvalidSessionOutcomeError):
            await service.record_delayed(
                account_id,
                session_id,
                actual_minutes=60,
            )
        with pytest.raises(InvalidSessionOutcomeError):
            await service.record_delayed(
                account_id,
                session_id,
                actual_minutes=30,
                remaining_minutes=0,
            )
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

    async def record_completed(
        self,
        account_id: UUID,
        session_id: UUID,
        actual_minutes: int,
        *,
        large_actual_confirmed: bool = False,
    ) -> StudySessionOutcomeRecord | None:
        if self.error is not None:
            raise self.error
        self.recorded = True
        return self.outcome

    async def record_delayed(
        self,
        account_id: UUID,
        session_id: UUID,
        actual_minutes: int,
        remaining_minutes: int | None = None,
        *,
        large_actual_confirmed: bool = False,
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
async def test_study_session_api_records_completed_and_delayed_outcomes() -> None:
    session = StudySessionRecord(
        SESSION_ID,
        ACCOUNT_ID,
        uuid4(),
        None,
        NOW - timedelta(hours=2),
        NOW - timedelta(hours=1),
        60,
    )
    completed_outcome = StudySessionOutcomeRecord(
        SESSION_ID, SessionOutcomeKind.COMPLETED, 55, 0, NOW, None
    )
    application = _api(StudySessionsStub(StudySessionDetails(session, None), completed_outcome))
    async with AsyncClient(
        transport=ASGITransport(app=application),
        base_url="https://test",
        cookies={"studyflow_session": "session"},
    ) as client:
        completed_resp = await client.post(
            f"/api/v1/study-sessions/{SESSION_ID}/outcomes",
            json={"outcome": "completed", "actual_minutes": 55},
            headers={"X-CSRF-Token": "csrf"},
        )
    assert completed_resp.status_code == 201
    assert completed_resp.headers["location"] == f"/api/v1/study-sessions/{SESSION_ID}"
    assert completed_resp.json()["outcome"]["kind"] == "completed"
    assert completed_resp.json()["outcome"]["actual_minutes"] == 55
    assert completed_resp.json()["revision"] is None

    delayed_outcome = StudySessionOutcomeRecord(
        SESSION_ID, SessionOutcomeKind.DELAYED, 30, 30, NOW, None
    )
    delayed_app = _api(StudySessionsStub(StudySessionDetails(session, None), delayed_outcome))
    async with AsyncClient(
        transport=ASGITransport(app=delayed_app),
        base_url="https://test",
        cookies={"studyflow_session": "session"},
    ) as client:
        delayed_resp = await client.post(
            f"/api/v1/study-sessions/{SESSION_ID}/outcomes",
            json={"outcome": "delayed", "actual_minutes": 30, "remaining_minutes": 30},
            headers={"X-CSRF-Token": "csrf"},
        )
    assert delayed_resp.status_code == 201
    assert delayed_resp.headers["location"] == "/api/v1/schedule-proposals/current"
    assert delayed_resp.json()["outcome"]["kind"] == "delayed"
    assert delayed_resp.json()["outcome"]["actual_minutes"] == 30
    assert delayed_resp.json()["outcome"]["remaining_minutes"] == 30
    assert delayed_resp.json()["revision"]["kind"] == "revision"


@pytest.mark.anyio
async def test_study_session_api_maps_invalid_outcome_to_422() -> None:
    session = StudySessionRecord(
        SESSION_ID,
        ACCOUNT_ID,
        uuid4(),
        None,
        NOW - timedelta(hours=2),
        NOW - timedelta(hours=1),
        60,
    )
    sessions = StudySessionsStub(
        StudySessionDetails(session, None),
        None,
        error=InvalidSessionOutcomeError("Outcome invalid"),
    )
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
    assert response.status_code == 422
    assert response.json()["detail"] == "Outcome invalid"


@pytest.mark.anyio
async def test_study_session_api_maps_none_recovery_proposal_to_503() -> None:
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
    application = _api(sessions, recovery=RecoveryStub(None))
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
    assert response.json()["detail"] == "Recovery proposal could not be generated"


@pytest.mark.anyio
async def test_study_session_api_rejects_duplicate_outcome_on_already_completed_session() -> None:
    session = StudySessionRecord(
        SESSION_ID,
        ACCOUNT_ID,
        uuid4(),
        None,
        NOW - timedelta(hours=2),
        NOW - timedelta(hours=1),
        60,
    )
    existing_outcome = StudySessionOutcomeRecord(
        SESSION_ID, SessionOutcomeKind.COMPLETED, 60, 0, NOW, None
    )
    sessions = StudySessionsStub(StudySessionDetails(session, existing_outcome), None)
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
    assert response.status_code == 409
    assert response.json()["detail"] == "The study session already has an outcome"


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


@pytest.mark.anyio
async def test_read_task_schedule_adjustments_and_snapshots() -> None:
    task_id = uuid4()
    account_id = uuid4()

    class PlainSessionsStub:
        async def list(
            self, account_id: UUID, filters: StudySessionFilters
        ) -> list[StudySessionDetails]:
            return []

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
            return {task_id: 30}

    class SnapshotSessionsStub(PlainSessionsStub, StudySessionSnapshots):
        async def task_schedule_adjustments_snapshot(self, account_id: UUID) -> dict[UUID, int]:
            return {task_id: 45}

    # 1. read_task_schedule_adjustments with StudySessionSnapshots and read_only=True
    snap_stub = SnapshotSessionsStub()
    res1 = await read_task_schedule_adjustments(
        cast(StudySessions, snap_stub), account_id, read_only=True
    )
    assert res1 == {task_id: 45}

    # 2. read_task_schedule_adjustments with StudySessionSnapshots and read_only=False
    res2 = await read_task_schedule_adjustments(
        cast(StudySessions, snap_stub), account_id, read_only=False
    )
    assert res2 == {task_id: 30}

    # 3. read_task_schedule_adjustments without StudySessionSnapshots and read_only=True
    plain_stub = PlainSessionsStub()
    res3 = await read_task_schedule_adjustments(
        cast(StudySessions, plain_stub), account_id, read_only=True
    )
    assert res3 == {task_id: 30}

    # 4. StudySessionService snapshot delegation
    class RepoStub:
        async def task_schedule_adjustments(self, account_id: UUID) -> dict[UUID, int]:
            return {task_id: 50}

        async def task_actual_minutes(self, account_id: UUID, task_id: UUID) -> int:
            return 0

    class RepoSnapshotStub(RepoStub, StudySessionOutcomeRepositorySnapshots):
        async def task_schedule_adjustments_snapshot(self, account_id: UUID) -> dict[UUID, int]:
            return {task_id: 60}

    service_snap = StudySessionService(cast(Any, RepoSnapshotStub()))
    assert await service_snap.task_schedule_adjustments_snapshot(account_id) == {task_id: 60}

    service_plain = StudySessionService(cast(Any, RepoStub()))
    assert await service_plain.task_schedule_adjustments(account_id) == {task_id: 50}
    assert await service_plain.task_schedule_adjustments_snapshot(account_id) == {task_id: 50}


@pytest.mark.anyio
async def test_sqlalchemy_outcome_repository_task_schedule_adjustments_snapshot() -> None:
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
                    OutcomeRow(
                        session_id=session_id,
                        kind=SessionOutcomeKind.DELAYED.value,
                        actual_minutes=40,
                        remaining_minutes=20,
                        recorded_at=NOW - timedelta(minutes=30),
                        rescheduled_at=None,
                    ),
                ]
            )
        repo = SqlAlchemyStudySessionOutcomeRepository(database, clock=lambda: NOW)
        adjustments = await repo.task_schedule_adjustments_snapshot(account_id)
        assert adjustments == {task_id: 40}
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_sqlalchemy_outcome_repository_has_unfinished_work_branches() -> None:
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
                        title="Project",
                        category="assignment",
                        deadline_at=NOW + timedelta(days=2),
                        original_estimate_minutes=60,
                        planned_duration_minutes=60,
                    ),
                    SessionRow(
                        id=session_id,
                        account_id=account_id,
                        task_id=task_id,
                        proposal_id=None,
                        starts_at=NOW - timedelta(hours=3),
                        ends_at=NOW - timedelta(hours=2),
                        planned_duration_minutes=60,
                        invalidated_at=NOW - timedelta(hours=1),
                    ),
                    OutcomeRow(
                        session_id=session_id,
                        kind=SessionOutcomeKind.DELAYED.value,
                        actual_minutes=30,
                        remaining_minutes=30,
                        recorded_at=NOW - timedelta(hours=1, minutes=30),
                        rescheduled_at=None,
                    ),
                ]
            )

        # 1. Invalidated session with remaining > 0 and rescheduled_at is None
        # -> has unfinished work
        async with database.transaction() as db_session:
            has_work = await SqlAlchemyStudySessionOutcomeRepository._has_unfinished_work(
                db_session, account_id, task_id, planned_duration_minutes=60
            )
            assert has_work is True

        # 2. Invalidated session with remaining > 0 but rescheduled_at is set
        # -> no unfinished work (since planned <= scheduled)
        async with database.transaction() as db_session:
            outcome = await db_session.get(OutcomeRow, session_id)
            assert outcome is not None
            outcome.rescheduled_at = NOW
            await db_session.flush()
            has_work = await SqlAlchemyStudySessionOutcomeRepository._has_unfinished_work(
                db_session, account_id, task_id, planned_duration_minutes=60
            )
            assert has_work is False

        # 3. Invalidated session with remaining == 0 -> no unfinished work
        async with database.transaction() as db_session:
            outcome = await db_session.get(OutcomeRow, session_id)
            assert outcome is not None
            outcome.rescheduled_at = None
            outcome.remaining_minutes = 0
            await db_session.flush()
            has_work = await SqlAlchemyStudySessionOutcomeRepository._has_unfinished_work(
                db_session, account_id, task_id, planned_duration_minutes=60
            )
            assert has_work is False

        # 4. Invalidated session with no outcome row -> continue (False if planned <= scheduled)
        async with database.transaction() as db_session:
            outcome = await db_session.get(OutcomeRow, session_id)
            assert outcome is not None
            await db_session.delete(outcome)
            await db_session.flush()
            has_work = await SqlAlchemyStudySessionOutcomeRepository._has_unfinished_work(
                db_session, account_id, task_id, planned_duration_minutes=60
            )
            assert has_work is False
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_outcome_repository_edge_cases() -> None:
    from sqlalchemy.ext.asyncio import AsyncSession

    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    account_id = uuid4()
    task_id = uuid4()
    session_id = uuid4()

    class StubRemediator:
        def __init__(self, t_ids: list[UUID]) -> None:
            self.t_ids = t_ids

        async def remediate_overdue_tasks(
            self, session: AsyncSession, acc_id: UUID, now: datetime
        ) -> list[UUID]:
            return self.t_ids

    class StubInvalidator:
        def __init__(self) -> None:
            self.invalidated: list[UUID] = []

        async def invalidate_for_task(
            self, session: AsyncSession, acc_id: UUID, t_id: UUID
        ) -> None:
            self.invalidated.append(t_id)

    try:
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
                    title="Task",
                    category="reading",
                    priority="medium",
                    original_estimate_minutes=60,
                    planned_duration_minutes=60,
                    planned_source="original",
                    deadline_at=NOW + timedelta(days=1),
                )
            )
            db_session.add(
                SessionRow(
                    id=session_id,
                    account_id=account_id,
                    task_id=task_id,
                    starts_at=NOW - timedelta(hours=2),
                    ends_at=NOW - timedelta(hours=1),
                    planned_duration_minutes=60,
                )
            )

        invalidator_stub = StubInvalidator()
        repo = SqlAlchemyStudySessionOutcomeRepository(
            database,
            overdue_remediator=StubRemediator([task_id]),
            proposal_invalidator=invalidator_stub,
            clock=lambda: NOW,
        )

        # 1. _reconcile_overdue invalidates proposals for overdue tasks
        async with database.transaction() as db_session:
            await repo._reconcile_overdue(db_session, account_id, NOW)
        assert invalidator_stub.invalidated == [task_id]

        # 2. list() with individual filters
        by_from = await repo.list(
            account_id, StudySessionFilters(starts_from=NOW - timedelta(hours=3))
        )
        assert len(by_from) == 1
        by_from_empty = await repo.list(account_id, StudySessionFilters(starts_from=NOW))
        assert len(by_from_empty) == 0

        by_to = await repo.list(account_id, StudySessionFilters(starts_to=NOW))
        assert len(by_to) == 1
        by_to_empty = await repo.list(
            account_id, StudySessionFilters(starts_to=NOW - timedelta(hours=3))
        )
        assert len(by_to_empty) == 0

        by_task = await repo.list(account_id, StudySessionFilters(task_id=task_id))
        assert len(by_task) == 1
        by_task_empty = await repo.list(account_id, StudySessionFilters(task_id=uuid4()))
        assert len(by_task_empty) == 0

        # 3. record non-existent account -> None
        res_no_acc = await repo.record(
            uuid4(), session_id, SessionOutcomeKind.COMPLETED, 60, None, False, NOW
        )
        assert res_no_acc is None

        # record non-existent session -> None
        res_no_session = await repo.record(
            account_id, uuid4(), SessionOutcomeKind.COMPLETED, 60, None, False, NOW
        )
        assert res_no_session is None

        # record non-existent task -> None
        orphan_session_id = uuid4()
        async with database.transaction() as db_session:
            db_session.add(
                SessionRow(
                    id=orphan_session_id,
                    account_id=account_id,
                    task_id=uuid4(),  # task doesn't exist
                    starts_at=NOW - timedelta(hours=3),
                    ends_at=NOW - timedelta(hours=2),
                    planned_duration_minutes=60,
                )
            )
        res_no_task = await repo.record(
            account_id, orphan_session_id, SessionOutcomeKind.COMPLETED, 60, None, False, NOW
        )
        assert res_no_task is None

        # 4. task_schedule_adjustments
        adjustments = await repo.task_schedule_adjustments(account_id)
        assert isinstance(adjustments, dict)

        # 5. _has_unfinished_work where session not invalidated,
        # outcome remaining > 0, rescheduled_at is None
        async with database.transaction() as db_session:
            db_session.add(
                OutcomeRow(
                    session_id=session_id,
                    kind=SessionOutcomeKind.DELAYED.value,
                    actual_minutes=30,
                    remaining_minutes=30,
                    recorded_at=NOW,
                    rescheduled_at=None,
                )
            )
            has_unfinished = await SqlAlchemyStudySessionOutcomeRepository._has_unfinished_work(
                db_session, account_id, task_id, planned_duration_minutes=60
            )
            assert has_unfinished is True
    finally:
        await database.stop()
