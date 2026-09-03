"""Authenticated student-safe adaptive estimate endpoints."""

from decimal import Decimal
from typing import Annotated, Literal, cast

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, ConfigDict

from studyflow.api.account import AccountError, require_csrf_session, require_session
from studyflow.auth.session_authentication import SessionPrincipal
from studyflow.estimation import AdaptiveEstimateUnavailableError, AdaptiveEstimator
from studyflow.tasks.service import TaskCategory

router = APIRouter(prefix="/adaptive-estimates", tags=["Adaptive Estimates"])


class AdaptiveEstimateError(BaseModel):
    detail: str


class AdaptiveEstimatePreviewResponse(BaseModel):
    """The estimate details students may inspect before creating a task."""

    category: TaskCategory
    original_minutes: int
    adaptive_minutes: int | None
    planned_minutes: int
    correction_factor: Decimal | None
    history_scope: Literal["overall", "category"] | None
    history_count: int | None
    available: bool
    planned_source: Literal["original", "adaptive"]
    acknowledgment_required: bool


class AcknowledgmentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category: TaskCategory


def get_adaptive_estimator(request: Request) -> AdaptiveEstimator:
    return cast(AdaptiveEstimator, request.app.state.adaptive_estimator)


def preview_response(
    preview_category: TaskCategory,
    original_minutes: int,
    adaptive_minutes: int | None,
    correction_factor: Decimal | None,
    history_scope: Literal["overall", "category"] | None,
    history_count: int | None,
    available: bool,
    planned_source: Literal["original", "adaptive"],
    acknowledgment_required: bool,
) -> AdaptiveEstimatePreviewResponse:
    planned_minutes = (
        adaptive_minutes
        if planned_source == "adaptive" and adaptive_minutes is not None
        else original_minutes
    )
    return AdaptiveEstimatePreviewResponse(
        category=preview_category,
        original_minutes=original_minutes,
        adaptive_minutes=adaptive_minutes,
        planned_minutes=planned_minutes,
        correction_factor=correction_factor,
        history_scope=history_scope,
        history_count=history_count,
        available=available,
        planned_source=planned_source,
        acknowledgment_required=acknowledgment_required,
    )


@router.get(
    "/preview",
    response_model=AdaptiveEstimatePreviewResponse,
    responses={status.HTTP_401_UNAUTHORIZED: {"model": AccountError}},
)
async def get_preview(
    category: TaskCategory,
    original_minutes: Annotated[int, Query(gt=0, le=2_147_483_647)],
    principal: Annotated[SessionPrincipal, Depends(require_session)],
    estimator: Annotated[AdaptiveEstimator, Depends(get_adaptive_estimator)],
) -> AdaptiveEstimatePreviewResponse:
    preview = await estimator.preview(principal.account_id, category, original_minutes)
    return preview_response(
        preview.category,
        preview.original_minutes,
        preview.adaptive_minutes,
        preview.correction_factor,
        preview.history_scope,
        preview.history_count,
        preview.available,
        preview.planned_source,
        preview.acknowledgment_required,
    )


@router.post(
    "/acknowledgments",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={
        status.HTTP_401_UNAUTHORIZED: {"model": AccountError},
        status.HTTP_403_FORBIDDEN: {"model": AccountError},
        status.HTTP_422_UNPROCESSABLE_CONTENT: {"model": AdaptiveEstimateError},
    },
)
async def acknowledge_estimate(
    payload: AcknowledgmentRequest,
    principal: Annotated[SessionPrincipal, Depends(require_csrf_session)],
    estimator: Annotated[AdaptiveEstimator, Depends(get_adaptive_estimator)],
) -> None:
    try:
        acknowledged = await estimator.acknowledge(principal.account_id, payload.category)
    except AdaptiveEstimateUnavailableError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Adaptive estimate is unavailable",
        ) from error
    if not acknowledged:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
