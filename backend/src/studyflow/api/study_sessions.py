"""Accepted study-session and immutable outcome endpoints."""

from datetime import datetime
from typing import Annotated, Literal, cast
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel

from studyflow.api.account import AccountError, require_csrf_session, require_session
from studyflow.auth.session_authentication import SessionPrincipal
from studyflow.scheduling.outcomes import (
    DuplicateSessionOutcomeError,
    FutureSessionOutcomeError,
    ProposedSessionOutcomeError,
    SessionOutcomeKind,
    StudySessionDetails,
    StudySessionOutcomeRecord,
    StudySessions,
)

router = APIRouter(prefix="/study-sessions", tags=["Study Sessions"])


class SessionOutcomeResponse(BaseModel):
    session_id: UUID
    kind: SessionOutcomeKind
    actual_minutes: int
    remaining_minutes: int
    recorded_at: datetime
    rescheduled_at: datetime | None


class StudySessionResponse(BaseModel):
    id: UUID
    task_id: UUID
    starts_at: datetime
    ends_at: datetime
    planned_duration_minutes: int
    outcome: SessionOutcomeResponse | None


class RecordSessionOutcomeRequest(BaseModel):
    outcome: Literal["missed"]


class StudySessionError(BaseModel):
    detail: str


def get_study_sessions(request: Request) -> StudySessions:
    return cast(StudySessions, request.app.state.study_sessions)


def _outcome_response(outcome: StudySessionOutcomeRecord) -> SessionOutcomeResponse:
    return SessionOutcomeResponse(
        session_id=outcome.session_id,
        kind=outcome.kind,
        actual_minutes=outcome.actual_minutes,
        remaining_minutes=outcome.remaining_minutes,
        recorded_at=outcome.recorded_at,
        rescheduled_at=outcome.rescheduled_at,
    )


def _session_response(details: StudySessionDetails) -> StudySessionResponse:
    session = details.session
    return StudySessionResponse(
        id=session.id,
        task_id=session.task_id,
        starts_at=session.starts_at,
        ends_at=session.ends_at,
        planned_duration_minutes=session.planned_duration_minutes,
        outcome=_outcome_response(details.outcome) if details.outcome is not None else None,
    )


@router.get(
    "/{session_id}",
    response_model=StudySessionResponse,
    responses={
        status.HTTP_401_UNAUTHORIZED: {"model": AccountError},
        status.HTTP_404_NOT_FOUND: {"model": StudySessionError},
    },
)
async def get_study_session(
    session_id: UUID,
    principal: Annotated[SessionPrincipal, Depends(require_session)],
    sessions: Annotated[StudySessions, Depends(get_study_sessions)],
) -> StudySessionResponse:
    details = await sessions.get(principal.account_id, session_id)
    if details is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Study session not found")
    return _session_response(details)


@router.post(
    "/{session_id}/outcomes",
    status_code=status.HTTP_201_CREATED,
    response_model=SessionOutcomeResponse,
    responses={
        status.HTTP_401_UNAUTHORIZED: {"model": AccountError},
        status.HTTP_403_FORBIDDEN: {"model": AccountError},
        status.HTTP_404_NOT_FOUND: {"model": StudySessionError},
        status.HTTP_409_CONFLICT: {"model": StudySessionError},
    },
)
async def record_study_session_outcome(
    session_id: UUID,
    body: RecordSessionOutcomeRequest,
    principal: Annotated[SessionPrincipal, Depends(require_csrf_session)],
    sessions: Annotated[StudySessions, Depends(get_study_sessions)],
) -> SessionOutcomeResponse:
    del body  # The request model intentionally permits only the PR9 `missed` outcome.
    try:
        outcome = await sessions.record_missed(principal.account_id, session_id)
    except (
        ProposedSessionOutcomeError,
        FutureSessionOutcomeError,
        DuplicateSessionOutcomeError,
    ) as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error
    if outcome is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Study session not found")
    return _outcome_response(outcome)
