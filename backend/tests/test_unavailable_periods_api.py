from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient

from studyflow.app import create_app
from studyflow.auth.session_authentication import SessionPrincipal
from studyflow.availability.unavailable import (
    UnavailablePeriod,
    UnavailablePeriodChange,
    UnavailablePeriodDraft,
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
class UnavailableStub:
    period: UnavailablePeriod
    created: list[UnavailablePeriodDraft] = field(default_factory=list)

    async def list_periods(self, account_id: UUID) -> list[UnavailablePeriod]:
        return [self.period]

    async def create(
        self, account_id: UUID, draft: UnavailablePeriodDraft
    ) -> UnavailablePeriodChange:
        self.created.append(draft)
        return UnavailablePeriodChange(self.period, [uuid4()])

    async def update(
        self, account_id: UUID, period_id: UUID, draft: UnavailablePeriodDraft
    ) -> UnavailablePeriodChange | None:
        return UnavailablePeriodChange(self.period, [])

    async def delete(self, account_id: UUID, period_id: UUID) -> bool:
        return period_id == self.period.id


@pytest.mark.anyio
async def test_unavailable_period_crud_contract() -> None:
    period_id = uuid4()
    period = UnavailablePeriod(
        period_id,
        datetime(2026, 8, 1, 12, tzinfo=UTC),
        datetime(2026, 8, 1, 14, tzinfo=UTC),
        "Exam",
    )
    unavailable = UnavailableStub(period)
    app = create_app(session_authentication=AuthenticationStub(), unavailable_periods=unavailable)
    headers = {"X-CSRF-Token": "csrf-token"}
    body = {
        "starts_at": "2026-08-01T12:00:00Z",
        "ends_at": "2026-08-01T14:00:00Z",
        "reason": "Exam",
    }
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="https://test",
        cookies={"__Host-studyflow_session": "session-token"},
    ) as client:
        listed = await client.get("/api/v1/availability/unavailable-periods")
        created = await client.post(
            "/api/v1/availability/unavailable-periods", headers=headers, json=body
        )
        updated = await client.put(
            f"/api/v1/availability/unavailable-periods/{period_id}", headers=headers, json=body
        )
        deleted = await client.delete(
            f"/api/v1/availability/unavailable-periods/{period_id}?confirmed=true",
            headers=headers,
        )

    assert listed.status_code == 200
    assert created.status_code == 201
    assert created.json()["invalidated_future_session_ids"]
    assert updated.status_code == 200
    assert deleted.status_code == 204
    assert unavailable.created[0].starts_at.utcoffset() == timedelta(0)
