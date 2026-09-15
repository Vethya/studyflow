from dataclasses import dataclass, field
from datetime import time
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient

from studyflow.app import create_app
from studyflow.auth.session_authentication import SessionPrincipal
from studyflow.availability.study_time import (
    StudyTimePeriodNotFoundError,
    StudyTimeUpdateResult,
)
from studyflow.availability.windows import (
    AvailabilityTimezoneConfirmation,
    AvailabilityWindow,
    AvailabilityWindowChange,
    AvailabilityWindowDraft,
)

ACCOUNT_ID = UUID("5b15bfef-8c44-45d5-a70e-574beb999fb3")


@dataclass
class AuthenticationStub:
    async def authenticate(
        self, session_token: str, csrf_token: str | None = None
    ) -> SessionPrincipal | None:
        return SessionPrincipal(ACCOUNT_ID, "student@example.com", "Student")

    async def revoke(self, session_token: str, csrf_token: str) -> bool:
        return False


@dataclass
class AvailabilityStub:
    windows: list[AvailabilityWindow]
    replacements: list[tuple[UUID, list[AvailabilityWindowDraft]]] = field(default_factory=list)
    confirmations: list[UUID] = field(default_factory=list)
    invalidated_future_session_ids: list[UUID] = field(default_factory=list)

    async def list_windows(self, account_id: UUID) -> list[AvailabilityWindow]:
        return self.windows

    async def replace(
        self, account_id: UUID, windows: list[AvailabilityWindowDraft]
    ) -> AvailabilityWindowChange:
        self.replacements.append((account_id, windows))
        return AvailabilityWindowChange(self.windows, self.invalidated_future_session_ids)

    async def confirm_timezone(self, account_id: UUID) -> AvailabilityTimezoneConfirmation | None:
        self.confirmations.append(account_id)
        return AvailabilityTimezoneConfirmation(self.invalidated_future_session_ids)


@pytest.mark.anyio
async def test_availability_read_replace_and_timezone_confirmation_contract() -> None:
    stored = AvailabilityWindow(uuid4(), 0, time(18), time(22), False)
    invalidated_id = uuid4()
    availability = AvailabilityStub([stored], invalidated_future_session_ids=[invalidated_id])
    app = create_app(session_authentication=AuthenticationStub(), availability_windows=availability)
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="https://test",
        cookies={"studyflow_session": "session-token"},
    ) as client:
        listed = await client.get("/api/v1/availability/windows")
        replaced = await client.put(
            "/api/v1/availability/windows",
            headers={"X-CSRF-Token": "csrf-token"},
            json={"windows": [{"weekday": 0, "start_time": "18:00", "end_time": "22:00"}]},
        )
        confirmed = await client.post(
            "/api/v1/availability/confirm-timezone",
            headers={"X-CSRF-Token": "csrf-token"},
            json={"confirmed": True},
        )

    assert listed.status_code == 200
    assert replaced.status_code == 200
    assert replaced.json()["windows"][0]["id"] == str(stored.id)
    assert replaced.json()["invalidated_future_session_ids"] == [str(invalidated_id)]
    assert confirmed.status_code == 200
    assert confirmed.json() == {"invalidated_future_session_ids": [str(invalidated_id)]}
    assert availability.replacements[0][0] == ACCOUNT_ID
    assert availability.confirmations == [ACCOUNT_ID]


@pytest.mark.anyio
async def test_availability_rejects_non_local_times_and_false_confirmation() -> None:
    availability = AvailabilityStub([])
    app = create_app(session_authentication=AuthenticationStub(), availability_windows=availability)
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="https://test",
        cookies={"studyflow_session": "session-token"},
    ) as client:
        invalid_time = await client.put(
            "/api/v1/availability/windows",
            headers={"X-CSRF-Token": "csrf-token"},
            json={"windows": [{"weekday": 0, "start_time": "18:00:01", "end_time": "22:00"}]},
        )
        false_confirmation = await client.post(
            "/api/v1/availability/confirm-timezone",
            headers={"X-CSRF-Token": "csrf-token"},
            json={"confirmed": False},
        )

    assert invalid_time.status_code == 422
    assert false_confirmation.status_code == 422
    assert availability.replacements == []
    assert availability.confirmations == []


@pytest.mark.anyio
async def test_availability_replace_maps_value_error_to_422() -> None:
    class ValueErrorAvailabilityStub(AvailabilityStub):
        async def replace(
            self, account_id: UUID, windows: list[AvailabilityWindowDraft]
        ) -> AvailabilityWindowChange:
            raise ValueError("Overlapping recurring windows")

    app = create_app(
        session_authentication=AuthenticationStub(),
        availability_windows=ValueErrorAvailabilityStub([]),
    )
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="https://test",
        cookies={"studyflow_session": "session-token"},
    ) as client:
        response = await client.put(
            "/api/v1/availability/windows",
            headers={"X-CSRF-Token": "csrf-token"},
            json={"windows": [{"weekday": 0, "start_time": "18:00", "end_time": "22:00"}]},
        )
    assert response.status_code == 422
    assert response.json()["detail"] == "Overlapping recurring windows"


@pytest.mark.anyio
async def test_availability_confirm_timezone_returns_401_when_unauthenticated() -> None:
    class NoneConfirmationStub(AvailabilityStub):
        async def confirm_timezone(
            self, account_id: UUID
        ) -> AvailabilityTimezoneConfirmation | None:
            return None

    app = create_app(
        session_authentication=AuthenticationStub(),
        availability_windows=NoneConfirmationStub([]),
    )
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="https://test",
        cookies={"studyflow_session": "session-token"},
    ) as client:
        response = await client.post(
            "/api/v1/availability/confirm-timezone",
            headers={"X-CSRF-Token": "csrf-token"},
            json={"confirmed": True},
        )
    assert response.status_code == 401
    assert response.json()["detail"] == "Not authenticated"


@dataclass
class StudyTimeUpdatesStub:
    result: StudyTimeUpdateResult | None = None
    error: Exception | None = None

    async def apply(self, account_id: UUID, changes: object) -> StudyTimeUpdateResult | None:
        if self.error is not None:
            raise self.error
        return self.result


@pytest.mark.anyio
async def test_study_time_update_requires_at_least_one_change() -> None:
    app = create_app(
        session_authentication=AuthenticationStub(),
        study_time_updates=StudyTimeUpdatesStub(),
    )
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="https://test",
        cookies={"studyflow_session": "session-token"},
    ) as client:
        response = await client.put(
            "/api/v1/availability/study-time",
            headers={"X-CSRF-Token": "csrf-token"},
            json={},
        )
    assert response.status_code == 422


@pytest.mark.anyio
async def test_study_time_update_maps_errors_and_returns_response() -> None:
    success_result = StudyTimeUpdateResult(
        timezone_confirmed=True,
        planning_preferences=None,
        recurring_windows=None,
        added_blocked_periods=[],
        updated_blocked_periods=[],
        removed_blocked_period_ids=[],
        invalidated_future_session_ids=[],
    )
    success_app = create_app(
        session_authentication=AuthenticationStub(),
        study_time_updates=StudyTimeUpdatesStub(result=success_result),
    )
    period_not_found_app = create_app(
        session_authentication=AuthenticationStub(),
        study_time_updates=StudyTimeUpdatesStub(
            error=StudyTimePeriodNotFoundError("Period not found")
        ),
    )
    value_error_app = create_app(
        session_authentication=AuthenticationStub(),
        study_time_updates=StudyTimeUpdatesStub(error=ValueError("Invalid study time")),
    )
    unauth_app = create_app(
        session_authentication=AuthenticationStub(),
        study_time_updates=StudyTimeUpdatesStub(result=None),
    )

    payload = {"confirm_timezone": True}
    headers = {"X-CSRF-Token": "csrf-token"}
    cookies = {"studyflow_session": "session-token"}

    async with AsyncClient(
        transport=ASGITransport(app=success_app), base_url="https://test", cookies=cookies
    ) as client:
        res = await client.put("/api/v1/availability/study-time", headers=headers, json=payload)
        assert res.status_code == 200
        assert res.json()["timezone_confirmed"] is True

    async with AsyncClient(
        transport=ASGITransport(app=period_not_found_app), base_url="https://test", cookies=cookies
    ) as client:
        res = await client.put("/api/v1/availability/study-time", headers=headers, json=payload)
        assert res.status_code == 404

    async with AsyncClient(
        transport=ASGITransport(app=value_error_app), base_url="https://test", cookies=cookies
    ) as client:
        res = await client.put("/api/v1/availability/study-time", headers=headers, json=payload)
        assert res.status_code == 422

    async with AsyncClient(
        transport=ASGITransport(app=unauth_app), base_url="https://test", cookies=cookies
    ) as client:
        res = await client.put("/api/v1/availability/study-time", headers=headers, json=payload)
        assert res.status_code == 401
