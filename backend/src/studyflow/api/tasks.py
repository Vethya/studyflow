"""Student-owned Academic Task endpoints."""

from datetime import UTC, datetime
from typing import Annotated, Literal, cast
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field, field_validator

from studyflow.api.account import AccountError, require_csrf_session, require_session
from studyflow.auth.session_authentication import SessionPrincipal
from studyflow.tasks.service import (
    AcademicTaskRecord,
    AcademicTasks,
    EstimateFrozenError,
    InvalidTaskDeadlineError,
    NewAcademicTask,
    TaskCategory,
    TaskFilters,
    TaskMustBeStartedError,
    TaskPriority,
    TaskStatus,
)

router = APIRouter(prefix="/tasks", tags=["Academic Tasks"])


def normalize_course(value: str | None) -> str | None:
    if value is None:
        return None
    return value.strip() or None


class AcademicTaskRequest(BaseModel):
    title: Annotated[str, Field(min_length=1, max_length=200)]
    category: TaskCategory
    priority: TaskPriority = TaskPriority.MEDIUM
    course: Annotated[str | None, Field(max_length=100)] = None
    notes: Annotated[str | None, Field(max_length=2000)] = None
    deadline_at: Annotated[
        datetime,
        Field(description="RFC 3339 timestamp with an explicit UTC offset"),
    ]
    original_estimate_minutes: Annotated[int, Field(gt=0, le=2_147_483_647)]

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value: str) -> str:
        title = value.strip()
        if not title:
            raise ValueError("Title is required")
        return title

    @field_validator("course")
    @classmethod
    def normalize_course_field(cls, value: str | None) -> str | None:
        return normalize_course(value)

    @field_validator("deadline_at")
    @classmethod
    def require_absolute_deadline(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("Deadline must include a UTC offset")
        return value


class AcademicTaskResponse(BaseModel):
    id: UUID
    title: str
    category: TaskCategory
    priority: TaskPriority
    course: str | None
    notes: str | None
    deadline_at: datetime
    original_estimate_minutes: int
    planned_duration_minutes: int
    created_at: datetime
    updated_at: datetime
    status: TaskStatus


class FinishEarlyRequest(BaseModel):
    confirmed: Literal[True]


class TaskError(BaseModel):
    detail: str


def get_academic_tasks(request: Request) -> AcademicTasks:
    return cast(AcademicTasks, request.app.state.academic_tasks)


def _response(task: AcademicTaskRecord) -> AcademicTaskResponse:
    return AcademicTaskResponse(
        id=task.id,
        title=task.title,
        category=task.category,
        priority=task.priority,
        course=task.course,
        notes=task.notes,
        deadline_at=task.deadline_at,
        original_estimate_minutes=task.original_estimate_minutes,
        planned_duration_minutes=task.planned_duration_minutes,
        created_at=task.created_at,
        updated_at=task.updated_at,
        status=task.status,
    )


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    response_model=AcademicTaskResponse,
    responses={
        status.HTTP_401_UNAUTHORIZED: {"model": AccountError},
        status.HTTP_403_FORBIDDEN: {"model": AccountError},
        status.HTTP_422_UNPROCESSABLE_CONTENT: {
            "description": "Invalid task fields or deadline",
            "content": {
                "application/json": {
                    "schema": {
                        "oneOf": [
                            {"$ref": "#/components/schemas/TaskError"},
                            {"$ref": "#/components/schemas/HTTPValidationError"},
                        ]
                    }
                }
            },
        },
    },
)
async def create_task(
    payload: AcademicTaskRequest,
    principal: Annotated[SessionPrincipal, Depends(require_csrf_session)],
    tasks: Annotated[AcademicTasks, Depends(get_academic_tasks)],
) -> AcademicTaskResponse:
    try:
        task = await tasks.create(
            principal.account_id,
            NewAcademicTask(
                title=payload.title,
                category=payload.category,
                priority=payload.priority,
                course=payload.course,
                notes=payload.notes,
                deadline_at=payload.deadline_at,
                original_estimate_minutes=payload.original_estimate_minutes,
            ),
        )
    except InvalidTaskDeadlineError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Deadline must be a future absolute date and time",
        ) from error
    return _response(task)


@router.get(
    "",
    response_model=list[AcademicTaskResponse],
    responses={status.HTTP_401_UNAUTHORIZED: {"model": AccountError}},
)
async def list_tasks(
    principal: Annotated[SessionPrincipal, Depends(require_session)],
    tasks: Annotated[AcademicTasks, Depends(get_academic_tasks)],
    course: Annotated[str | None, Query(max_length=100)] = None,
    category: TaskCategory | None = None,
    priority: TaskPriority | None = None,
    deadline_from: datetime | None = None,
    deadline_to: datetime | None = None,
    task_status: Annotated[TaskStatus | None, Query(alias="status")] = None,
) -> list[AcademicTaskResponse]:
    for deadline in (deadline_from, deadline_to):
        if deadline is not None and deadline.tzinfo is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Deadline filters must include a UTC offset",
            )
    if deadline_from is not None and deadline_to is not None and deadline_from > deadline_to:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="deadline_from must not be after deadline_to",
        )
    filters = TaskFilters(
        course=normalize_course(course),
        category=category,
        priority=priority,
        deadline_from=deadline_from.astimezone(UTC) if deadline_from is not None else None,
        deadline_to=deadline_to.astimezone(UTC) if deadline_to is not None else None,
        status=task_status,
    )
    return [_response(task) for task in await tasks.list(principal.account_id, filters)]


@router.get(
    "/{task_id}",
    response_model=AcademicTaskResponse,
    responses={
        status.HTTP_401_UNAUTHORIZED: {"model": AccountError},
        status.HTTP_404_NOT_FOUND: {"model": TaskError},
    },
)
async def get_task(
    task_id: UUID,
    principal: Annotated[SessionPrincipal, Depends(require_session)],
    tasks: Annotated[AcademicTasks, Depends(get_academic_tasks)],
) -> AcademicTaskResponse:
    task = await tasks.get(principal.account_id, task_id)
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    return _response(task)


@router.put(
    "/{task_id}",
    response_model=AcademicTaskResponse,
    responses={
        status.HTTP_401_UNAUTHORIZED: {"model": AccountError},
        status.HTTP_403_FORBIDDEN: {"model": AccountError},
        status.HTTP_404_NOT_FOUND: {"model": TaskError},
        status.HTTP_409_CONFLICT: {"model": TaskError},
    },
)
async def update_task(
    task_id: UUID,
    payload: AcademicTaskRequest,
    principal: Annotated[SessionPrincipal, Depends(require_csrf_session)],
    tasks: Annotated[AcademicTasks, Depends(get_academic_tasks)],
) -> AcademicTaskResponse:
    try:
        task = await tasks.update(
            principal.account_id,
            task_id,
            NewAcademicTask(
                title=payload.title,
                category=payload.category,
                priority=payload.priority,
                course=payload.course,
                notes=payload.notes,
                deadline_at=payload.deadline_at,
                original_estimate_minutes=payload.original_estimate_minutes,
            ),
        )
    except InvalidTaskDeadlineError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Deadline must be a future absolute date and time",
        ) from error
    except EstimateFrozenError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Original estimate is frozen after work starts",
        ) from error
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    return _response(task)


@router.post(
    "/{task_id}/start",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={
        status.HTTP_401_UNAUTHORIZED: {"model": AccountError},
        status.HTTP_403_FORBIDDEN: {"model": AccountError},
        status.HTTP_404_NOT_FOUND: {"model": TaskError},
    },
)
async def start_task(
    task_id: UUID,
    principal: Annotated[SessionPrincipal, Depends(require_csrf_session)],
    tasks: Annotated[AcademicTasks, Depends(get_academic_tasks)],
) -> None:
    if not await tasks.mark_started(principal.account_id, task_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")


@router.post(
    "/{task_id}/finish-early",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={
        status.HTTP_401_UNAUTHORIZED: {"model": AccountError},
        status.HTTP_403_FORBIDDEN: {"model": AccountError},
        status.HTTP_404_NOT_FOUND: {"model": TaskError},
        status.HTTP_409_CONFLICT: {"model": TaskError},
    },
)
async def finish_task_early(
    task_id: UUID,
    payload: FinishEarlyRequest,
    principal: Annotated[SessionPrincipal, Depends(require_csrf_session)],
    tasks: Annotated[AcademicTasks, Depends(get_academic_tasks)],
) -> None:
    try:
        finished = await tasks.finish_early(principal.account_id, task_id)
    except TaskMustBeStartedError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Task must be started before it can be finished",
        ) from error
    if not finished:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")


@router.delete(
    "/{task_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={
        status.HTTP_401_UNAUTHORIZED: {"model": AccountError},
        status.HTTP_403_FORBIDDEN: {"model": AccountError},
        status.HTTP_404_NOT_FOUND: {"model": TaskError},
    },
)
async def delete_task(
    task_id: UUID,
    confirmed: Annotated[bool, Query()],
    principal: Annotated[SessionPrincipal, Depends(require_csrf_session)],
    tasks: Annotated[AcademicTasks, Depends(get_academic_tasks)],
) -> None:
    if not confirmed:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Task deletion requires confirmation",
        )
    if not await tasks.delete(principal.account_id, task_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
