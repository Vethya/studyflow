"""Student-owned Effort Progress endpoint."""

from datetime import UTC, datetime
from typing import Annotated, cast
from uuid import UUID

from fastapi import APIRouter, Depends, Request, status
from pydantic import BaseModel, Field

from studyflow.api.account import AccountError, require_session
from studyflow.auth.session_authentication import SessionPrincipal
from studyflow.progress import EffortProgressRecord, calculate_effort_progress
from studyflow.scheduling.outcomes import StudySessionFilters, StudySessions
from studyflow.tasks.service import AcademicTasks, TaskStatus

router = APIRouter(prefix="/progress", tags=["Progress"])


class EffortProgressResponse(BaseModel):
    task_id: UUID
    task_title: str
    actual_duration_minutes: int = Field(ge=0)
    estimated_remaining_minutes: int = Field(ge=0)
    effort_percent: int = Field(ge=0, le=100)
    sessions_completed: int = Field(ge=0)
    sessions_upcoming: int = Field(ge=0)
    status: TaskStatus


def get_academic_tasks(request: Request) -> AcademicTasks:
    return cast(AcademicTasks, request.app.state.academic_tasks)


def get_study_sessions(request: Request) -> StudySessions:
    return cast(StudySessions, request.app.state.study_sessions)


def _response(progress: EffortProgressRecord) -> EffortProgressResponse:
    return EffortProgressResponse(
        task_id=progress.task_id,
        task_title=progress.task_title,
        actual_duration_minutes=progress.actual_duration_minutes,
        estimated_remaining_minutes=progress.estimated_remaining_minutes,
        effort_percent=progress.effort_percent,
        sessions_completed=progress.sessions_completed,
        sessions_upcoming=progress.sessions_upcoming,
        status=progress.status,
    )


@router.get(
    "",
    response_model=list[EffortProgressResponse],
    responses={status.HTTP_401_UNAUTHORIZED: {"model": AccountError}},
    summary="List task effort progress",
    description=(
        "Returns Effort Progress for every Academic Task owned by the authenticated student. "
        "Effort Progress measures expected effort consumed, not content completion, quality, "
        "or grade."
    ),
)
async def list_effort_progress(
    principal: Annotated[SessionPrincipal, Depends(require_session)],
    tasks: Annotated[AcademicTasks, Depends(get_academic_tasks)],
    sessions: Annotated[StudySessions, Depends(get_study_sessions)],
) -> list[EffortProgressResponse]:
    task_records = await tasks.list(principal.account_id)
    session_details = await sessions.list(principal.account_id, StudySessionFilters())
    schedule_adjustments = await sessions.task_schedule_adjustments(principal.account_id)
    progress = calculate_effort_progress(
        task_records,
        session_details,
        schedule_adjustments,
        now=datetime.now(UTC),
    )
    return [_response(item) for item in progress]
