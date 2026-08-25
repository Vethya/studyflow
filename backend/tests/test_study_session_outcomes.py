from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import cast
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from studyflow.app import create_app
from studyflow.auth.session_authentication import SessionPrincipal
from studyflow.database import Base, Database
from studyflow.database.models import AcademicTask, StudentAccount
from studyflow.database.models import StudySession as SessionRow
from studyflow.scheduling.outcome_repositories import SqlAlchemyStudySessionOutcomeRepository
from studyflow.scheduling.outcomes import (
    DuplicateSessionOutcomeError,
    FutureSessionOutcomeError,
    ProposedSessionOutcomeError,
    SessionOutcomeKind,
    StudySessionDetails,
    StudySessionOutcomeRecord,
    StudySessions,
    StudySessionService,
)

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

    async def get(self, account_id: UUID, session_id: UUID) -> StudySessionDetails | None:
        return self.details

    async def record_missed(
        self, account_id: UUID, session_id: UUID
    ) -> StudySessionOutcomeRecord | None:
        if self.error is not None:
            raise self.error
        return self.outcome


def _api(stub: StudySessionsStub, *, authenticated: bool = True) -> FastAPI:
    return create_app(
        session_authentication=AuthenticationStub(authenticated),
        study_sessions=cast(StudySessions, stub),
    )


@pytest.mark.anyio
async def test_study_session_api_gets_and_records_missed_with_csrf() -> None:
    from studyflow.scheduling.proposals import StudySessionRecord

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
    assert recorded.json()["kind"] == "missed"
    assert recorded.json()["remaining_minutes"] == 60


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
