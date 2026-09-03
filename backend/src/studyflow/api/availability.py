"""Authenticated availability endpoints."""

from datetime import datetime, time
from typing import Annotated, Literal, cast
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field, field_validator, model_validator

from studyflow.api.account import (
    AccountError,
    StudyPreferencesResponse,
    StudyPreferencesUpdate,
    require_csrf_session,
    require_session,
)
from studyflow.auth.session_authentication import SessionPrincipal
from studyflow.availability.study_time import (
    StudyTimeBlockedPeriodChanges,
    StudyTimeBlockedPeriodUpdate,
    StudyTimeChanges,
    StudyTimePeriodNotFoundError,
    StudyTimeUpdateResult,
    StudyTimeUpdates,
)
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


class StudyTimeAvailabilityReplacement(AvailabilityReplacement):
    replace_all: Literal[True]


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


def get_study_time_updates(request: Request) -> StudyTimeUpdates:
    return cast(StudyTimeUpdates, request.app.state.study_time_updates)


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


class StudyTimeBlockedPeriodUpdateRequest(UnavailablePeriodRequest):
    period_id: UUID


class StudyTimeBlockedPeriodRemovalRequest(BaseModel):
    period_id: UUID
    confirmed: Literal[True]


class StudyTimeBlockedPeriodsRequest(BaseModel):
    add: list[UnavailablePeriodRequest] = Field(default_factory=list, max_length=64)
    update: list[StudyTimeBlockedPeriodUpdateRequest] = Field(default_factory=list, max_length=64)
    remove: list[StudyTimeBlockedPeriodRemovalRequest] = Field(default_factory=list, max_length=64)


class StudyTimeUpdateRequest(BaseModel):
    confirm_timezone: Literal[True] | None = None
    planning_preferences: StudyPreferencesUpdate | None = None
    recurring_availability: StudyTimeAvailabilityReplacement | None = None
    blocked_periods: StudyTimeBlockedPeriodsRequest | None = None

    @model_validator(mode="after")
    def require_change(self) -> "StudyTimeUpdateRequest":
        if not (
            self.confirm_timezone is not None
            or self.planning_preferences is not None
            or self.recurring_availability is not None
            or self.blocked_periods is not None
        ):
            raise ValueError("Provide at least one study-time change")
        return self


class UnavailablePeriodResponse(BaseModel):
    id: UUID
    starts_at: datetime
    ends_at: datetime
    reason: str | None


class UnavailablePeriodChangeResponse(BaseModel):
    period: UnavailablePeriodResponse
    invalidated_future_session_ids: list[UUID]


class StudyTimeUpdateResponse(BaseModel):
    timezone_confirmed: bool
    planning_preferences: StudyPreferencesResponse | None
    recurring_windows: list[AvailabilityWindowResponse] | None
    added_blocked_periods: list[UnavailablePeriodResponse]
    updated_blocked_periods: list[UnavailablePeriodResponse]
    removed_blocked_period_ids: list[UUID]
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


def _study_time_response(update: StudyTimeUpdateResult) -> StudyTimeUpdateResponse:
    return StudyTimeUpdateResponse(
        timezone_confirmed=update.timezone_confirmed,
        planning_preferences=(
            StudyPreferencesResponse(
                timezone=update.planning_preferences.timezone,
                preferred_session_length_minutes=(
                    update.planning_preferences.preferred_session_length_minutes
                ),
                minimum_break_minutes=update.planning_preferences.minimum_break_minutes,
                availability_confirmation_required=(
                    update.planning_preferences.availability_confirmation_required
                ),
            )
            if update.planning_preferences is not None
            else None
        ),
        recurring_windows=(
            [_response(window) for window in update.recurring_windows]
            if update.recurring_windows is not None
            else None
        ),
        added_blocked_periods=[_period_response(period) for period in update.added_blocked_periods],
        updated_blocked_periods=[
            _period_response(period) for period in update.updated_blocked_periods
        ],
        removed_blocked_period_ids=update.removed_blocked_period_ids,
        invalidated_future_session_ids=update.invalidated_future_session_ids,
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


def _study_time_changes(payload: StudyTimeUpdateRequest) -> StudyTimeChanges:
    preferences = payload.planning_preferences
    blocked = payload.blocked_periods
    return StudyTimeChanges(
        confirm_timezone=payload.confirm_timezone is not None,
        planning_preferences=(
            (
                preferences.timezone,
                preferences.preferred_session_length_minutes,
                preferences.minimum_break_minutes,
            )
            if preferences is not None
            else None
        ),
        recurring_windows=(
            tuple(
                AvailabilityWindowDraft(item.weekday, item.start_time, item.end_time)
                for item in payload.recurring_availability.windows
            )
            if payload.recurring_availability is not None
            else None
        ),
        blocked_periods=(
            StudyTimeBlockedPeriodChanges(
                add=tuple(_draft(item) for item in blocked.add),
                update=tuple(
                    StudyTimeBlockedPeriodUpdate(
                        item.period_id,
                        _draft(item),
                    )
                    for item in blocked.update
                ),
                remove=tuple(item.period_id for item in blocked.remove),
            )
            if blocked is not None
            else None
        ),
    )


@router.put(
    "/study-time",
    response_model=StudyTimeUpdateResponse,
    responses={
        status.HTTP_401_UNAUTHORIZED: {"model": AccountError},
        status.HTTP_403_FORBIDDEN: {"model": AccountError},
        status.HTTP_404_NOT_FOUND: {"model": AccountError},
    },
)
async def update_study_time(
    payload: StudyTimeUpdateRequest,
    principal: Annotated[SessionPrincipal, Depends(require_csrf_session)],
    updates: Annotated[StudyTimeUpdates, Depends(get_study_time_updates)],
) -> StudyTimeUpdateResponse:
    try:
        result = await updates.apply(principal.account_id, _study_time_changes(payload))
    except StudyTimePeriodNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    if result is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return _study_time_response(result)
