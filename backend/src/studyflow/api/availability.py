"""Authenticated availability endpoints."""

from datetime import time
from typing import Annotated, Literal, cast
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field, field_validator

from studyflow.api.account import AccountError, require_csrf_session, require_session
from studyflow.auth.session_authentication import SessionPrincipal
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
