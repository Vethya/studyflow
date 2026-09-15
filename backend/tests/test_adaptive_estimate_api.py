from dataclasses import dataclass, field
from decimal import Decimal
from uuid import UUID

import pytest
from httpx import ASGITransport, AsyncClient

from studyflow.app import create_app
from studyflow.auth.session_authentication import SessionPrincipal
from studyflow.estimation import AdaptiveEstimatePreview, AdaptiveEstimateUnavailableError
from studyflow.tasks.service import TaskCategory

ACCOUNT_ID = UUID("5b15bfef-8c44-45d5-a70e-574beb999fb3")
OTHER_ACCOUNT_ID = UUID("26fe0fe0-03bf-42fd-98da-d70db8aa8ac4")


@dataclass
class AuthenticationStub:
    authenticated: bool = True

    async def authenticate(
        self, session_token: str, csrf_token: str | None = None
    ) -> SessionPrincipal | None:
        if not self.authenticated:
            return None
        account_id = OTHER_ACCOUNT_ID if session_token == "other-session" else ACCOUNT_ID
        return SessionPrincipal(account_id, "student@example.com", "Student")

    async def revoke(self, session_token: str, csrf_token: str) -> bool:
        return False


@dataclass
class EstimatorStub:
    previews: dict[UUID, AdaptiveEstimatePreview]
    acknowledgments: list[tuple[UUID, TaskCategory]] = field(default_factory=list)

    async def preview(
        self, account_id: UUID, category: TaskCategory, original_minutes: int
    ) -> AdaptiveEstimatePreview:
        preview = self.previews[account_id]
        return AdaptiveEstimatePreview(
            category=category,
            original_minutes=original_minutes,
            adaptive_minutes=preview.adaptive_minutes,
            correction_factor=preview.correction_factor,
            history_scope=preview.history_scope,
            history_count=preview.history_count,
            available=preview.available,
            planned_source=preview.planned_source,
            acknowledgment_required=preview.acknowledgment_required,
        )

    async def acknowledge(self, account_id: UUID, category: TaskCategory) -> bool:
        self.acknowledgments.append((account_id, category))
        if not self.previews[account_id].available:
            raise AdaptiveEstimateUnavailableError
        return True


def preview(
    *,
    available: bool,
    adaptive_minutes: int | None = None,
    correction_factor: Decimal | None = None,
    history_scope: str | None = None,
    history_count: int | None = None,
    planned_source: str = "original",
    acknowledgment_required: bool = False,
) -> AdaptiveEstimatePreview:
    return AdaptiveEstimatePreview(
        category=TaskCategory.READING,
        original_minutes=60,
        adaptive_minutes=adaptive_minutes,
        correction_factor=correction_factor,
        history_scope=history_scope,  # type: ignore[arg-type]
        history_count=history_count,
        available=available,
        planned_source=planned_source,  # type: ignore[arg-type]
        acknowledgment_required=acknowledgment_required,
    )


@pytest.mark.anyio
async def test_preview_requires_authentication_and_valid_category_and_minutes() -> None:
    estimator = EstimatorStub({ACCOUNT_ID: preview(available=False)})
    app = create_app(session_authentication=AuthenticationStub(), adaptive_estimator=estimator)  # type: ignore[arg-type]
    unauthenticated = create_app(
        session_authentication=AuthenticationStub(authenticated=False),
        adaptive_estimator=estimator,  # type: ignore[arg-type]
    )

    async with AsyncClient(
        transport=ASGITransport(app=unauthenticated), base_url="https://test"
    ) as client:
        missing_auth = await client.get(
            "/api/v1/adaptive-estimates/preview",
            params={"category": "reading", "original_minutes": 60},
        )
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="https://test",
        cookies={"studyflow_session": "session-token"},
    ) as client:
        bad_category = await client.get(
            "/api/v1/adaptive-estimates/preview",
            params={"category": "invalid", "original_minutes": 60},
        )
        zero_minutes = await client.get(
            "/api/v1/adaptive-estimates/preview",
            params={"category": "reading", "original_minutes": 0},
        )
        overflow_minutes = await client.get(
            "/api/v1/adaptive-estimates/preview",
            params={"category": "reading", "original_minutes": 2_147_483_648},
        )

    assert missing_auth.status_code == 401
    assert bad_category.status_code == 422
    assert zero_minutes.status_code == 422
    assert overflow_minutes.status_code == 422


@pytest.mark.anyio
async def test_preview_returns_unavailable_without_hidden_estimation_data() -> None:
    estimator = EstimatorStub({ACCOUNT_ID: preview(available=False)})
    app = create_app(session_authentication=AuthenticationStub(), adaptive_estimator=estimator)  # type: ignore[arg-type]

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="https://test",
        cookies={"studyflow_session": "session-token"},
    ) as client:
        response = await client.get(
            "/api/v1/adaptive-estimates/preview",
            params={"category": "reading", "original_minutes": 60},
        )

    assert response.status_code == 200
    assert response.json() == {
        "category": "reading",
        "original_minutes": 60,
        "adaptive_minutes": None,
        "planned_minutes": 60,
        "correction_factor": None,
        "history_scope": None,
        "history_count": None,
        "available": False,
        "planned_source": "original",
        "acknowledgment_required": False,
    }


@pytest.mark.anyio
async def test_preview_returns_qualified_student_safe_estimate_without_accuracy_metrics() -> None:
    estimator = EstimatorStub(
        {
            ACCOUNT_ID: preview(
                available=True,
                adaptive_minutes=90,
                correction_factor=Decimal("1.5"),
                history_scope="category",
                history_count=5,
                planned_source="adaptive",
            )
        }
    )
    app = create_app(session_authentication=AuthenticationStub(), adaptive_estimator=estimator)  # type: ignore[arg-type]

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="https://test",
        cookies={"studyflow_session": "session-token"},
    ) as client:
        response = await client.get(
            "/api/v1/adaptive-estimates/preview",
            params={"category": "reading", "original_minutes": 60},
        )

    assert response.status_code == 200
    assert response.json() == {
        "category": "reading",
        "original_minutes": 60,
        "adaptive_minutes": 90,
        "planned_minutes": 90,
        "correction_factor": "1.5",
        "history_scope": "category",
        "history_count": 5,
        "available": True,
        "planned_source": "adaptive",
        "acknowledgment_required": False,
    }


@pytest.mark.anyio
async def test_acknowledgment_requires_csrf_and_uses_only_server_computed_factor() -> None:
    estimator = EstimatorStub(
        {
            ACCOUNT_ID: preview(
                available=True,
                adaptive_minutes=150,
                correction_factor=Decimal("2.5"),
                history_scope="category",
                history_count=5,
                acknowledgment_required=True,
            )
        }
    )
    app = create_app(session_authentication=AuthenticationStub(), adaptive_estimator=estimator)  # type: ignore[arg-type]

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="https://test",
        cookies={"studyflow_session": "session-token"},
    ) as client:
        missing_csrf = await client.post(
            "/api/v1/adaptive-estimates/acknowledgments", json={"category": "reading"}
        )
        supplied_factor = await client.post(
            "/api/v1/adaptive-estimates/acknowledgments",
            headers={"X-CSRF-Token": "csrf-token"},
            json={"category": "reading", "correction_factor": 0.01},
        )
        acknowledged = await client.post(
            "/api/v1/adaptive-estimates/acknowledgments",
            headers={"X-CSRF-Token": "csrf-token"},
            json={"category": "reading"},
        )

    assert missing_csrf.status_code == 403
    assert supplied_factor.status_code == 422
    assert acknowledged.status_code == 204
    assert estimator.acknowledgments == [(ACCOUNT_ID, TaskCategory.READING)]


@pytest.mark.anyio
async def test_preview_and_acknowledgment_are_scoped_to_the_authenticated_account() -> None:
    estimator = EstimatorStub(
        {
            ACCOUNT_ID: preview(available=False),
            OTHER_ACCOUNT_ID: preview(
                available=True,
                adaptive_minutes=90,
                correction_factor=Decimal("1.5"),
                history_scope="overall",
                history_count=9,
                planned_source="adaptive",
            ),
        }
    )
    app = create_app(session_authentication=AuthenticationStub(), adaptive_estimator=estimator)  # type: ignore[arg-type]

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="https://test",
        cookies={"studyflow_session": "other-session"},
    ) as client:
        other_preview = await client.get(
            "/api/v1/adaptive-estimates/preview",
            params={"category": "reading", "original_minutes": 60},
        )
        other_acknowledgment = await client.post(
            "/api/v1/adaptive-estimates/acknowledgments",
            headers={"X-CSRF-Token": "csrf-token"},
            json={"category": "reading"},
        )

    assert other_preview.status_code == 200
    assert other_preview.json()["available"] is True
    assert other_acknowledgment.status_code == 204
    assert estimator.acknowledgments == [(OTHER_ACCOUNT_ID, TaskCategory.READING)]


@pytest.mark.anyio
async def test_acknowledgment_maps_unavailable_and_unauthenticated() -> None:
    estimator = EstimatorStub(
        {
            ACCOUNT_ID: preview(available=False),
        }
    )
    app = create_app(session_authentication=AuthenticationStub(), adaptive_estimator=estimator)  # type: ignore[arg-type]

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="https://test",
        cookies={"studyflow_session": "session-token"},
    ) as client:
        unavailable_resp = await client.post(
            "/api/v1/adaptive-estimates/acknowledgments",
            headers={"X-CSRF-Token": "csrf-token"},
            json={"category": "reading"},
        )

    assert unavailable_resp.status_code == 422
    assert unavailable_resp.json()["detail"] == "Adaptive estimate is unavailable"

    unauthenticated_app = create_app(
        session_authentication=AuthenticationStub(authenticated=False),
        adaptive_estimator=estimator,  # type: ignore[arg-type]
    )
    async with AsyncClient(
        transport=ASGITransport(app=unauthenticated_app),
        base_url="https://test",
    ) as client:
        unauth_resp = await client.post(
            "/api/v1/adaptive-estimates/acknowledgments",
            headers={"X-CSRF-Token": "csrf-token"},
            json={"category": "reading"},
        )

    assert unauth_resp.status_code == 401

    class RejectingEstimator(EstimatorStub):
        async def acknowledge(self, account_id: UUID, category: TaskCategory) -> bool:
            return False

    rejecting_app = create_app(
        session_authentication=AuthenticationStub(),
        adaptive_estimator=RejectingEstimator({ACCOUNT_ID: preview(available=True)}),  # type: ignore[arg-type]
    )
    async with AsyncClient(
        transport=ASGITransport(app=rejecting_app),
        base_url="https://test",
        cookies={"studyflow_session": "session-token"},
    ) as client:
        rejected_resp = await client.post(
            "/api/v1/adaptive-estimates/acknowledgments",
            headers={"X-CSRF-Token": "csrf-token"},
            json={"category": "reading"},
        )
    assert rejected_resp.status_code == 401
