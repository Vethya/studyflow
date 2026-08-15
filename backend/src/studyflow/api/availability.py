"""Authenticated availability endpoints."""

from datetime import datetime, time
from typing import Annotated, Literal, cast
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field, field_validator

from studyflow.api.account import AccountError, require_csrf_session, require_session
from studyflow.auth.session_authentication import SessionPrincipal
from studyflow.availability.unavailable import (
    UnavailablePeriod,
    UnavailablePeriodChange,
    UnavailablePeriodDraft,
    UnavailablePeriods,
)
from studyflow.availability.windows import (
    AvailabilityWindow,
    AvailabilityWindowDraft,
    AvailabilityWindows,
)

router = APIRouter(prefix="/availability", tags=["Availability"])


class AvailabilityWindowRequest(BaseModel):
    weekday: Annotated[int, Field(ge=0, le=6)]
    start_time: time
    end_time: time

    @field_validator("start_time", "end_time")
    @classmethod
    def require_minute_precision(cls, value: time) -> time:
        if value.second or value.microsecond or value.tzinfo is not None:
            raise ValueError("Availability times must be local minute values")
        return value


class AvailabilityReplacement(BaseModel):
    windows: Annotated[list[AvailabilityWindowRequest], Field(max_length=100)]


class AvailabilityConfirmation(BaseModel):
    confirmed: Literal[True]


class AvailabilityWindowResponse(BaseModel):
    id: UUID
    weekday: int
    start_time: time
    end_time: time
    crosses_midnight: bool


def get_availability_windows(request: Request) -> AvailabilityWindows:
    return cast(AvailabilityWindows, request.app.state.availability_windows)


def get_unavailable_periods(request: Request) -> UnavailablePeriods:
    return cast(UnavailablePeriods, request.app.state.unavailable_periods)


def _response(window: AvailabilityWindow) -> AvailabilityWindowResponse:
    return AvailabilityWindowResponse(
        id=window.id,
        weekday=window.weekday,
        start_time=window.start_time,
        end_time=window.end_time,
        crosses_midnight=window.crosses_midnight,
    )


@router.get(
    "/windows",
    response_model=list[AvailabilityWindowResponse],
    responses={status.HTTP_401_UNAUTHORIZED: {"model": AccountError}},
)
async def list_availability_windows(
    principal: Annotated[SessionPrincipal, Depends(require_session)],
    availability: Annotated[AvailabilityWindows, Depends(get_availability_windows)],
) -> list[AvailabilityWindowResponse]:
    return [_response(window) for window in await availability.list_windows(principal.account_id)]


@router.put(
    "/windows",
    response_model=list[AvailabilityWindowResponse],
    responses={
        status.HTTP_401_UNAUTHORIZED: {"model": AccountError},
        status.HTTP_403_FORBIDDEN: {"model": AccountError},
    },
)
async def replace_availability_windows(
    payload: AvailabilityReplacement,
    principal: Annotated[SessionPrincipal, Depends(require_csrf_session)],
    availability: Annotated[AvailabilityWindows, Depends(get_availability_windows)],
) -> list[AvailabilityWindowResponse]:
    try:
        windows = await availability.replace(
            principal.account_id,
            [
                AvailabilityWindowDraft(item.weekday, item.start_time, item.end_time)
                for item in payload.windows
            ],
        )
    except ValueError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error)
        ) from error
    return [_response(window) for window in windows]


@router.post(
    "/confirm-timezone",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={
        status.HTTP_401_UNAUTHORIZED: {"model": AccountError},
        status.HTTP_403_FORBIDDEN: {"model": AccountError},
    },
)
async def confirm_availability_timezone(
    payload: AvailabilityConfirmation,
    principal: Annotated[SessionPrincipal, Depends(require_csrf_session)],
    availability: Annotated[AvailabilityWindows, Depends(get_availability_windows)],
) -> None:
    if not await availability.confirm_timezone(principal.account_id):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")


class UnavailablePeriodRequest(BaseModel):
    starts_at: datetime
    ends_at: datetime
    reason: Annotated[str | None, Field(max_length=200)] = None


class UnavailablePeriodResponse(BaseModel):
    id: UUID
    starts_at: datetime
    ends_at: datetime
    reason: str | None


class UnavailablePeriodChangeResponse(BaseModel):
    period: UnavailablePeriodResponse
    invalidated_future_session_ids: list[UUID]


def _period_response(period: UnavailablePeriod) -> UnavailablePeriodResponse:
    return UnavailablePeriodResponse(
        id=period.id,
        starts_at=period.starts_at,
        ends_at=period.ends_at,
        reason=period.reason,
    )


def _change_response(change: UnavailablePeriodChange) -> UnavailablePeriodChangeResponse:
    return UnavailablePeriodChangeResponse(
        period=_period_response(change.period),
        invalidated_future_session_ids=change.invalidated_future_session_ids,
    )


@router.get(
    "/unavailable-periods",
    response_model=list[UnavailablePeriodResponse],
    responses={status.HTTP_401_UNAUTHORIZED: {"model": AccountError}},
)
async def list_unavailable_periods(
    principal: Annotated[SessionPrincipal, Depends(require_session)],
    unavailable: Annotated[UnavailablePeriods, Depends(get_unavailable_periods)],
) -> list[UnavailablePeriodResponse]:
    return [
        _period_response(period) for period in await unavailable.list_periods(principal.account_id)
    ]


def _draft(payload: UnavailablePeriodRequest) -> UnavailablePeriodDraft:
    return UnavailablePeriodDraft(payload.starts_at, payload.ends_at, payload.reason)


@router.post(
    "/unavailable-periods",
    status_code=status.HTTP_201_CREATED,
    response_model=UnavailablePeriodChangeResponse,
    responses={
        status.HTTP_401_UNAUTHORIZED: {"model": AccountError},
        status.HTTP_403_FORBIDDEN: {"model": AccountError},
    },
)
async def create_unavailable_period(
    payload: UnavailablePeriodRequest,
    principal: Annotated[SessionPrincipal, Depends(require_csrf_session)],
    unavailable: Annotated[UnavailablePeriods, Depends(get_unavailable_periods)],
) -> UnavailablePeriodChangeResponse:
    try:
        return _change_response(await unavailable.create(principal.account_id, _draft(payload)))
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.put(
    "/unavailable-periods/{period_id}",
    response_model=UnavailablePeriodChangeResponse,
    responses={
        status.HTTP_401_UNAUTHORIZED: {"model": AccountError},
        status.HTTP_403_FORBIDDEN: {"model": AccountError},
        status.HTTP_404_NOT_FOUND: {"model": AccountError},
    },
)
async def update_unavailable_period(
    period_id: UUID,
    payload: UnavailablePeriodRequest,
    principal: Annotated[SessionPrincipal, Depends(require_csrf_session)],
    unavailable: Annotated[UnavailablePeriods, Depends(get_unavailable_periods)],
) -> UnavailablePeriodChangeResponse:
    try:
        change = await unavailable.update(principal.account_id, period_id, _draft(payload))
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    if change is None:
        raise HTTPException(status_code=404, detail="Unavailable period not found")
    return _change_response(change)


@router.delete(
    "/unavailable-periods/{period_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={
        status.HTTP_401_UNAUTHORIZED: {"model": AccountError},
        status.HTTP_403_FORBIDDEN: {"model": AccountError},
        status.HTTP_404_NOT_FOUND: {"model": AccountError},
    },
)
async def delete_unavailable_period(
    period_id: UUID,
    confirmed: Annotated[bool, Query()],
    principal: Annotated[SessionPrincipal, Depends(require_csrf_session)],
    unavailable: Annotated[UnavailablePeriods, Depends(get_unavailable_periods)],
) -> None:
    if not confirmed:
        raise HTTPException(status_code=422, detail="Deletion requires confirmation")
    if not await unavailable.delete(principal.account_id, period_id):
        raise HTTPException(status_code=404, detail="Unavailable period not found")
