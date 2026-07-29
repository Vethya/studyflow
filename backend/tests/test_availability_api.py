from dataclasses import dataclass, field
from datetime import time
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient

from studyflow.app import create_app
from studyflow.auth.session_authentication import SessionPrincipal
from studyflow.availability.windows import AvailabilityWindow, AvailabilityWindowDraft

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

    async def list_windows(self, account_id: UUID) -> list[AvailabilityWindow]:
        return self.windows

    async def replace(
        self, account_id: UUID, windows: list[AvailabilityWindowDraft]
    ) -> list[AvailabilityWindow]:
        self.replacements.append((account_id, windows))
        return self.windows

    async def confirm_timezone(self, account_id: UUID) -> bool:
        self.confirmations.append(account_id)
        return True


@pytest.mark.anyio
async def test_availability_read_replace_and_timezone_confirmation_contract() -> None:
    stored = AvailabilityWindow(uuid4(), 0, time(18), time(22), False)
    availability = AvailabilityStub([stored])
    app = create_app(session_authentication=AuthenticationStub(), availability_windows=availability)
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="https://test",
        cookies={"__Host-studyflow_session": "session-token"},
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
    assert confirmed.status_code == 204
    assert availability.replacements[0][0] == ACCOUNT_ID
    assert availability.confirmations == [ACCOUNT_ID]


@pytest.mark.anyio
async def test_availability_rejects_non_local_times_and_false_confirmation() -> None:
    availability = AvailabilityStub([])
    app = create_app(session_authentication=AuthenticationStub(), availability_windows=availability)
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="https://test",
        cookies={"__Host-studyflow_session": "session-token"},
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
