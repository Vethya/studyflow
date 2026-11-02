"""Study reminder preferences and the internal reminder dispatch trigger."""

import hmac
from typing import Annotated, cast

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel, field_validator

from studyflow.api.account import AccountError, require_csrf_session, require_session
from studyflow.auth.session_authentication import SessionPrincipal
from studyflow.reminders.preferences import (
    ReminderPreferences,
    ReminderPreferencesState,
    ReminderSettings,
    is_valid_before_session_minutes,
)
from studyflow.reminders.service import ReminderDispatch
from studyflow.settings import Settings

router = APIRouter(tags=["Reminders"])


class ReminderPreferencesResponse(BaseModel):
    email_enabled: bool
    before_session_minutes: int
    after_session: bool
    email_verified: bool
    delivery_available: bool


class ReminderPreferencesUpdate(BaseModel):
    email_enabled: bool
    before_session_minutes: int
    after_session: bool

    @field_validator("before_session_minutes")
    @classmethod
    def require_supported_lead_time(cls, value: int) -> int:
        if not is_valid_before_session_minutes(value):
            raise ValueError("Use 0 to turn off, or a value from 30 to 120 minutes")
        return value


class ReminderDispatchResponse(BaseModel):
    sent_before: int
    sent_after: int
    skipped: int
    failed: int


class ReminderError(BaseModel):
    detail: str


def get_reminder_settings(request: Request) -> ReminderSettings:
    return cast(ReminderSettings, request.app.state.reminder_settings)


def get_reminder_dispatch(request: Request) -> ReminderDispatch:
    return cast(ReminderDispatch, request.app.state.reminder_dispatch)


def get_settings(request: Request) -> Settings:
    return cast(Settings, request.app.state.settings)


def require_dispatch_token(
    settings: Annotated[Settings, Depends(get_settings)],
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    expected = settings.reminder_dispatch_token
    if expected is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")
    scheme, _, presented = (authorization or "").partition(" ")
    token_matches = hmac.compare_digest(presented.encode(), expected.get_secret_value().encode())
    if scheme.lower() != "bearer" or not token_matches:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid reminder dispatch token",
            headers={"WWW-Authenticate": "Bearer"},
        )


def _response(state: ReminderPreferencesState, settings: Settings) -> ReminderPreferencesResponse:
    return ReminderPreferencesResponse(
        email_enabled=state.preferences.email_enabled,
        before_session_minutes=state.preferences.before_session_minutes,
        after_session=state.preferences.after_session,
        email_verified=state.email_verified,
        delivery_available=settings.reminder_dispatch_token is not None,
    )


@router.get(
    "/reminders/preferences",
    response_model=ReminderPreferencesResponse,
    responses={status.HTTP_401_UNAUTHORIZED: {"model": AccountError}},
)
async def get_reminder_preferences(
    principal: Annotated[SessionPrincipal, Depends(require_session)],
    reminders: Annotated[ReminderSettings, Depends(get_reminder_settings)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> ReminderPreferencesResponse:
    state = await reminders.get(principal.account_id)
    if state is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return _response(state, settings)


@router.put(
    "/reminders/preferences",
    response_model=ReminderPreferencesResponse,
    responses={
        status.HTTP_401_UNAUTHORIZED: {"model": AccountError},
        status.HTTP_403_FORBIDDEN: {"model": AccountError},
    },
)
async def update_reminder_preferences(
    payload: ReminderPreferencesUpdate,
    principal: Annotated[SessionPrincipal, Depends(require_csrf_session)],
    reminders: Annotated[ReminderSettings, Depends(get_reminder_settings)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> ReminderPreferencesResponse:
    state = await reminders.update(
        principal.account_id,
        ReminderPreferences(
            email_enabled=payload.email_enabled,
            before_session_minutes=payload.before_session_minutes,
            after_session=payload.after_session,
        ),
    )
    if state is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return _response(state, settings)


@router.post(
    "/internal/reminders/dispatch",
    response_model=ReminderDispatchResponse,
    dependencies=[Depends(require_dispatch_token)],
    responses={
        status.HTTP_401_UNAUTHORIZED: {"model": ReminderError},
        status.HTTP_404_NOT_FOUND: {"model": ReminderError},
    },
    description=(
        "Sends due study reminder emails. Called by a scheduler with "
        "`Authorization: Bearer <STUDYFLOW_REMINDER_DISPATCH_TOKEN>`; responds 404 when the "
        "token is not configured. Safe to call repeatedly: each reminder is sent at most once."
    ),
)
async def dispatch_reminders(
    dispatch: Annotated[ReminderDispatch, Depends(get_reminder_dispatch)],
) -> ReminderDispatchResponse:
    summary = await dispatch.dispatch()
    return ReminderDispatchResponse(
        sent_before=summary.sent_before,
        sent_after=summary.sent_after,
        skipped=summary.skipped,
        failed=summary.failed,
    )
