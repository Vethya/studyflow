"""HTTP-level two-account ownership matrix for SPEC §18.3 and NFR-01."""

from dataclasses import dataclass
from datetime import UTC, datetime, time, timedelta
from uuid import UUID

import pytest
from httpx import ASGITransport, AsyncClient

from studyflow.app import create_app
from studyflow.auth.session_authentication import SessionPrincipal
from studyflow.database import Base, Database
from studyflow.database.models.authentication import AuthenticationIdentity, StudentAccount
from studyflow.database.models.availability import AvailabilityWindow, UnavailablePeriod
from studyflow.database.models.scheduling import (
    ProposalTaskAllocation,
    ScheduleProposal,
    StudySession,
    StudySessionOutcome,
)
from studyflow.database.models.tasks import AcademicTask

ACCOUNT_A = UUID("00000000-0000-0000-0000-0000000000a1")
ACCOUNT_B = UUID("00000000-0000-0000-0000-0000000000b1")
TASK_A_MUTABLE = UUID("00000000-0000-0000-0000-0000000001a1")
TASK_A_COMPLETED = UUID("00000000-0000-0000-0000-0000000001a2")
TASK_B_MUTABLE = UUID("00000000-0000-0000-0000-0000000001b1")
TASK_B_COMPLETED = UUID("00000000-0000-0000-0000-0000000001b2")
PROPOSAL_A = UUID("00000000-0000-0000-0000-0000000002a1")
PROPOSAL_B = UUID("00000000-0000-0000-0000-0000000002b1")
SESSION_A_ACCEPTED = UUID("00000000-0000-0000-0000-0000000003a1")
SESSION_A_PROPOSED = UUID("00000000-0000-0000-0000-0000000003a2")
SESSION_B_ACCEPTED = UUID("00000000-0000-0000-0000-0000000003b1")
SESSION_B_PROPOSED = UUID("00000000-0000-0000-0000-0000000003b2")
PERIOD_A = UUID("00000000-0000-0000-0000-0000000004a1")
PERIOD_B = UUID("00000000-0000-0000-0000-0000000004b1")
WINDOW_A = UUID("00000000-0000-0000-0000-0000000005a1")
WINDOW_B = UUID("00000000-0000-0000-0000-0000000005b1")
IDENTITY_A = UUID("00000000-0000-0000-0000-0000000006a1")
IDENTITY_B = UUID("00000000-0000-0000-0000-0000000006b1")


@dataclass
class TwoAccountAuthentication:
    principals: dict[str, SessionPrincipal]

    async def authenticate(
        self, session_token: str, csrf_token: str | None = None
    ) -> SessionPrincipal | None:
        principal = self.principals.get(session_token)
        if principal is None:
            return None
        if csrf_token is not None and csrf_token != f"{session_token}-csrf":
            return None
        return principal

    async def revoke(self, session_token: str, csrf_token: str) -> bool:
        return False


def _account(
    account_id: UUID, email: str, name: str, timezone: str, now: datetime
) -> StudentAccount:
    return StudentAccount(
        id=account_id,
        email=email,
        name=name,
        password_hash="hash",
        email_verified_at=now,
        timezone=timezone,
        availability_timezone_confirmed=True,
        preferred_session_length_minutes=60,
        minimum_break_minutes=10,
        created_at=now,
        updated_at=now,
    )


def _task(
    task_id: UUID,
    account_id: UUID,
    title: str,
    now: datetime,
    *,
    completed: bool,
) -> AcademicTask:
    return AcademicTask(
        id=task_id,
        account_id=account_id,
        title=title,
        category="reading",
        priority="medium",
        course=None,
        notes=None,
        deadline_at=now + timedelta(days=7),
        original_estimate_minutes=60,
        adaptive_estimate_minutes=None,
        planned_source="original",
        planned_duration_minutes=60,
        estimate_frozen_at=now - timedelta(days=1) if completed else None,
        completed_at=now - timedelta(hours=3) if completed else None,
        finished_early_at=None,
        created_at=now - timedelta(days=2),
        updated_at=now - timedelta(days=2),
    )


async def _seed_isolation_fixture(database: Database, now: datetime) -> None:
    async with database.transaction() as session:
        await session.run_sync(
            lambda sync_session: Base.metadata.create_all(sync_session.connection())
        )
        session.add_all(
            [
                _account(ACCOUNT_A, "a@example.com", "Account A", "UTC", now),
                _account(ACCOUNT_B, "b@example.com", "Account B", "Asia/Tokyo", now),
                AuthenticationIdentity(
                    id=IDENTITY_A,
                    account_id=ACCOUNT_A,
                    provider="google",
                    subject="google-a",
                    email="a@example.com",
                    created_at=now,
                ),
                AuthenticationIdentity(
                    id=IDENTITY_B,
                    account_id=ACCOUNT_B,
                    provider="google",
                    subject="google-b",
                    email="b@example.com",
                    created_at=now,
                ),
            ]
        )
        session.add_all(
            [
                _task(TASK_A_MUTABLE, ACCOUNT_A, "A private draft", now, completed=False),
                _task(TASK_A_COMPLETED, ACCOUNT_A, "A completed reading", now, completed=True),
                _task(TASK_B_MUTABLE, ACCOUNT_B, "B private draft", now, completed=False),
                _task(TASK_B_COMPLETED, ACCOUNT_B, "B completed reading", now, completed=True),
            ]
        )
        session.add_all(
            [
                AvailabilityWindow(
                    id=WINDOW_A,
                    account_id=ACCOUNT_A,
                    weekday=0,
                    local_start_time=time(9),
                    local_end_time=time(17),
                    crosses_midnight=False,
                ),
                AvailabilityWindow(
                    id=WINDOW_B,
                    account_id=ACCOUNT_B,
                    weekday=1,
                    local_start_time=time(10),
                    local_end_time=time(18),
                    crosses_midnight=False,
                ),
                UnavailablePeriod(
                    id=PERIOD_A,
                    account_id=ACCOUNT_A,
                    starts_at=now + timedelta(days=2),
                    ends_at=now + timedelta(days=2, hours=1),
                    reason="A private block",
                ),
                UnavailablePeriod(
                    id=PERIOD_B,
                    account_id=ACCOUNT_B,
                    starts_at=now + timedelta(days=3),
                    ends_at=now + timedelta(days=3, hours=1),
                    reason="B private block",
                ),
            ]
        )
        for account_id, proposal_id, task_ids in (
            (ACCOUNT_A, PROPOSAL_A, (TASK_A_MUTABLE, TASK_A_COMPLETED)),
            (ACCOUNT_B, PROPOSAL_B, (TASK_B_MUTABLE, TASK_B_COMPLETED)),
        ):
            session.add(
                ScheduleProposal(
                    id=proposal_id,
                    account_id=account_id,
                    kind="generation",
                    revision_reason=None,
                    status="feasible",
                    input_fingerprint=(str(account_id).replace("-", "") * 4)[:64],
                    scenario=None,
                    created_at=now - timedelta(hours=2),
                )
            )
            for task_id in task_ids:
                session.add(
                    ProposalTaskAllocation(
                        proposal_id=proposal_id,
                        task_id=task_id,
                        deadline_at=now + timedelta(days=7),
                        required_minutes=60,
                        scheduled_minutes=60,
                        unscheduled_minutes=0,
                        raw_calendar_capacity_minutes=480,
                        available_minutes_before_deadline=480,
                        shortfall_minutes=0,
                    )
                )
        session.add_all(
            [
                StudySession(
                    id=SESSION_A_ACCEPTED,
                    account_id=ACCOUNT_A,
                    task_id=TASK_A_COMPLETED,
                    proposal_id=None,
                    starts_at=now - timedelta(hours=4),
                    ends_at=now - timedelta(hours=3),
                    planned_duration_minutes=60,
                ),
                StudySession(
                    id=SESSION_A_PROPOSED,
                    account_id=ACCOUNT_A,
                    task_id=TASK_A_MUTABLE,
                    proposal_id=PROPOSAL_A,
                    starts_at=now + timedelta(days=1),
                    ends_at=now + timedelta(days=1, hours=1),
                    planned_duration_minutes=60,
                ),
                StudySession(
                    id=SESSION_B_ACCEPTED,
                    account_id=ACCOUNT_B,
                    task_id=TASK_B_COMPLETED,
                    proposal_id=None,
                    starts_at=now - timedelta(hours=4),
                    ends_at=now - timedelta(hours=3),
                    planned_duration_minutes=60,
                ),
                StudySession(
                    id=SESSION_B_PROPOSED,
                    account_id=ACCOUNT_B,
                    task_id=TASK_B_MUTABLE,
                    proposal_id=PROPOSAL_B,
                    starts_at=now + timedelta(days=1),
                    ends_at=now + timedelta(days=1, hours=1),
                    planned_duration_minutes=60,
                ),
                StudySessionOutcome(
                    session_id=SESSION_A_ACCEPTED,
                    kind="completed",
                    actual_minutes=45,
                    remaining_minutes=0,
                    recorded_at=now - timedelta(hours=2),
                    rescheduled_at=None,
                ),
                StudySessionOutcome(
                    session_id=SESSION_B_ACCEPTED,
                    kind="completed",
                    actual_minutes=50,
                    remaining_minutes=0,
                    recorded_at=now - timedelta(hours=2),
                    rescheduled_at=None,
                ),
            ]
        )


def _headers(token: str) -> dict[str, str]:
    return {"X-CSRF-Token": f"{token}-csrf"}


@pytest.mark.anyio
async def test_cross_user_isolation_matrix_covers_all_student_resources() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    now = datetime.now(UTC).replace(microsecond=0)
    authentication = TwoAccountAuthentication(
        {
            "session-a": SessionPrincipal(ACCOUNT_A, "a@example.com", "Account A"),
            "session-b": SessionPrincipal(ACCOUNT_B, "b@example.com", "Account B"),
        }
    )
    app = create_app(database=database, session_authentication=authentication)
    await _seed_isolation_fixture(database, now)

    try:
        async with (
            AsyncClient(
                transport=ASGITransport(app=app),
                base_url="https://test",
                cookies={"studyflow_session": "session-a"},
            ) as client_a,
            AsyncClient(
                transport=ASGITransport(app=app),
                base_url="https://test",
                cookies={"studyflow_session": "session-b"},
            ) as client_b,
        ):
            # Read isolation: lists and derived views never expose A's IDs/content to B.
            tasks_b = await client_b.get("/api/v1/tasks")
            windows_b = await client_b.get("/api/v1/availability/windows")
            periods_b = await client_b.get("/api/v1/availability/unavailable-periods")
            sessions_b = await client_b.get("/api/v1/study-sessions")
            current_b = await client_b.get("/api/v1/schedule-proposals/current")
            progress_b = await client_b.get("/api/v1/progress")
            profile_b = await client_b.get("/api/v1/account/profile")
            preferences_b = await client_b.get("/api/v1/account/preferences")
            identities_b = await client_b.get("/api/v1/account/identities")

            assert tasks_b.status_code == 200
            assert {item["id"] for item in tasks_b.json()} == {
                str(TASK_B_MUTABLE),
                str(TASK_B_COMPLETED),
            }
            assert windows_b.status_code == 200
            assert {item["id"] for item in windows_b.json()} == {str(WINDOW_B)}
            assert periods_b.status_code == 200
            assert {item["id"] for item in periods_b.json()} == {str(PERIOD_B)}
            assert sessions_b.status_code == 200
            assert {item["id"] for item in sessions_b.json()} == {str(SESSION_B_ACCEPTED)}
            assert current_b.status_code == 200
            assert {item["task_id"] for item in current_b.json()["task_allocations"]} == {
                str(TASK_B_MUTABLE),
                str(TASK_B_COMPLETED),
            }
            assert progress_b.status_code == 200
            assert {item["task_id"] for item in progress_b.json()} == {
                str(TASK_B_MUTABLE),
                str(TASK_B_COMPLETED),
            }
            assert profile_b.status_code == 200
            assert profile_b.json()["id"] == str(ACCOUNT_B)
            assert profile_b.json()["email"] == "b@example.com"
            assert profile_b.json()["name"] == "Account B"
            assert preferences_b.status_code == 200
            assert preferences_b.json()["timezone"] == "Asia/Tokyo"
            assert identities_b.status_code == 200
            assert identities_b.json() == [
                {
                    "provider": "google",
                    "email": "b@example.com",
                    "linked_at": now.isoformat().replace("+00:00", "Z"),
                }
            ]

            # Direct resource reads and mutations use the authenticated account scope.
            task_body = {
                "title": "Attempted cross-user update",
                "category": "reading",
                "priority": "medium",
                "course": None,
                "notes": None,
                "deadline_at": (now + timedelta(days=8)).isoformat(),
                "original_estimate_minutes": 60,
                "planned_source": "original",
            }
            assert (await client_b.get(f"/api/v1/tasks/{TASK_A_MUTABLE}")).status_code == 404
            assert (
                await client_b.put(
                    f"/api/v1/tasks/{TASK_A_MUTABLE}",
                    headers=_headers("session-b"),
                    json=task_body,
                )
            ).status_code == 404
            assert (
                await client_b.delete(
                    f"/api/v1/tasks/{TASK_A_MUTABLE}?confirmed=true",
                    headers=_headers("session-b"),
                )
            ).status_code == 404

            period_body = {
                "starts_at": (now + timedelta(days=4)).isoformat(),
                "ends_at": (now + timedelta(days=4, hours=1)).isoformat(),
                "reason": "cross-user attempt",
            }
            assert (
                await client_b.put(
                    f"/api/v1/availability/unavailable-periods/{PERIOD_A}",
                    headers=_headers("session-b"),
                    json=period_body,
                )
            ).status_code == 404
            assert (
                await client_b.delete(
                    f"/api/v1/availability/unavailable-periods/{PERIOD_A}?confirmed=true",
                    headers=_headers("session-b"),
                )
            ).status_code == 404
            assert (
                await client_b.put(
                    "/api/v1/availability/study-time",
                    headers=_headers("session-b"),
                    json={
                        "blocked_periods": {"update": [{"period_id": str(PERIOD_A), **period_body}]}
                    },
                )
            ).status_code == 404

            assert (
                await client_b.post(
                    f"/api/v1/study-sessions/{SESSION_A_ACCEPTED}/outcomes",
                    headers=_headers("session-b"),
                    json={"outcome": "completed", "actual_minutes": 45},
                )
            ).status_code == 404
            assert (
                await client_b.post(
                    f"/api/v1/schedule-proposals/{PROPOSAL_A}/accept",
                    headers=_headers("session-b"),
                )
            ).status_code == 404
            assert (
                await client_b.post(
                    f"/api/v1/schedule-proposals/{PROPOSAL_A}/reject",
                    headers=_headers("session-b"),
                )
            ).status_code == 404

            # The same ownership guarantees hold in the opposite direction.
            assert (await client_a.get(f"/api/v1/tasks/{TASK_B_MUTABLE}")).status_code == 404
            assert (
                await client_a.put(
                    f"/api/v1/tasks/{TASK_B_MUTABLE}",
                    headers=_headers("session-a"),
                    json=task_body,
                )
            ).status_code == 404
            assert (
                await client_a.put(
                    f"/api/v1/availability/unavailable-periods/{PERIOD_B}",
                    headers=_headers("session-a"),
                    json=period_body,
                )
            ).status_code == 404
            assert (
                await client_a.put(
                    "/api/v1/availability/study-time",
                    headers=_headers("session-a"),
                    json={
                        "blocked_periods": {"update": [{"period_id": str(PERIOD_B), **period_body}]}
                    },
                )
            ).status_code == 404
            assert (
                await client_a.post(
                    f"/api/v1/study-sessions/{SESSION_B_ACCEPTED}/outcomes",
                    headers=_headers("session-a"),
                    json={"outcome": "completed", "actual_minutes": 50},
                )
            ).status_code == 404
            assert (
                await client_a.post(
                    f"/api/v1/schedule-proposals/{PROPOSAL_B}/accept",
                    headers=_headers("session-a"),
                )
            ).status_code == 404

            # A remains unchanged after every attempted B mutation.
            tasks_a = await client_a.get("/api/v1/tasks")
            periods_a = await client_a.get("/api/v1/availability/unavailable-periods")
            current_a = await client_a.get("/api/v1/schedule-proposals/current")
            assert {item["id"] for item in tasks_a.json()} == {
                str(TASK_A_MUTABLE),
                str(TASK_A_COMPLETED),
            }
            assert periods_a.json()[0]["id"] == str(PERIOD_A)
            assert current_a.json()["id"] == str(PROPOSAL_A)
    finally:
        await database.stop()
