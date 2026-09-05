"""Academic Task create/read application boundary."""

import builtins
from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from enum import StrEnum
from typing import Protocol, runtime_checkable
from uuid import UUID


class TaskCategory(StrEnum):
    ASSIGNMENT = "assignment"
    READING = "reading"
    EXAM_PREPARATION = "exam_preparation"
    PROJECT = "project"
    RESEARCH_WRITING = "research_writing"
    OTHER = "other"


class TaskPriority(StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class InvalidTaskDeadlineError(ValueError):
    """Raised when a task deadline is not a future absolute instant."""


class EstimateFrozenError(ValueError):
    """Raised when an update changes an estimate after work starts."""


class TaskMustBeStartedError(ValueError):
    """Raised when an unstarted task is finished early."""


class TaskStatus(StrEnum):
    NOT_STARTED = "not_started"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    OVERDUE = "overdue"


@dataclass(frozen=True, slots=True)
class NewAcademicTask:
    title: str
    category: TaskCategory
    priority: TaskPriority
    course: str | None
    notes: str | None
    deadline_at: datetime
    original_estimate_minutes: int


@dataclass(frozen=True, slots=True)
class TaskFilters:
    course: str | None = None
    category: TaskCategory | None = None
    priority: TaskPriority | None = None
    deadline_from: datetime | None = None
    deadline_to: datetime | None = None
    status: TaskStatus | None = None


@dataclass(frozen=True, slots=True)
class AcademicTaskRecord:
    id: UUID
    account_id: UUID
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
    status: TaskStatus = TaskStatus.NOT_STARTED


class AcademicTaskRepository(Protocol):
    async def create(self, account_id: UUID, task: NewAcademicTask) -> AcademicTaskRecord: ...
    async def list(
        self, account_id: UUID, filters: TaskFilters | None = None
    ) -> list[AcademicTaskRecord]: ...
    async def get(self, account_id: UUID, task_id: UUID) -> AcademicTaskRecord | None: ...
    async def update(
        self, account_id: UUID, task_id: UUID, task: NewAcademicTask, now: datetime
    ) -> AcademicTaskRecord | None: ...
    async def delete(self, account_id: UUID, task_id: UUID) -> bool: ...
    async def finish_early(self, account_id: UUID, task_id: UUID, now: datetime) -> bool: ...
    async def mark_started(self, account_id: UUID, task_id: UUID, now: datetime) -> bool: ...


class AcademicTasks(Protocol):
    async def create(self, account_id: UUID, task: NewAcademicTask) -> AcademicTaskRecord: ...
    async def list(
        self, account_id: UUID, filters: TaskFilters | None = None
    ) -> list[AcademicTaskRecord]: ...
    async def get(self, account_id: UUID, task_id: UUID) -> AcademicTaskRecord | None: ...
    async def update(
        self, account_id: UUID, task_id: UUID, task: NewAcademicTask
    ) -> AcademicTaskRecord | None: ...
    async def delete(self, account_id: UUID, task_id: UUID) -> bool: ...
    async def finish_early(self, account_id: UUID, task_id: UUID) -> bool: ...
    async def mark_started(self, account_id: UUID, task_id: UUID) -> bool: ...


@runtime_checkable
class AcademicTaskRepositorySnapshots(Protocol):
    async def list_snapshot(
        self, account_id: UUID, filters: TaskFilters | None = None
    ) -> builtins.list[AcademicTaskRecord]: ...


@runtime_checkable
class AcademicTaskSnapshots(Protocol):
    async def list_snapshot(
        self, account_id: UUID, filters: TaskFilters | None = None
    ) -> list[AcademicTaskRecord]: ...


async def list_task_snapshot(
    tasks: AcademicTasks,
    account_id: UUID,
    filters: TaskFilters | None = None,
) -> list[AcademicTaskRecord]:
    if isinstance(tasks, AcademicTaskSnapshots):
        return await tasks.list_snapshot(account_id, filters)
    return await tasks.list(account_id, filters)


class AcademicTaskService:
    def __init__(
        self,
        repository: AcademicTaskRepository,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self._repository = repository
        self._clock = clock

    async def create(self, account_id: UUID, task: NewAcademicTask) -> AcademicTaskRecord:
        if task.deadline_at.tzinfo is None or task.deadline_at <= self._clock():
            raise InvalidTaskDeadlineError
        return await self._repository.create(
            account_id, replace(task, deadline_at=task.deadline_at.astimezone(UTC))
        )

    async def list(
        self, account_id: UUID, filters: TaskFilters | None = None
    ) -> list[AcademicTaskRecord]:
        return await self._repository.list(account_id, filters or TaskFilters())

    async def list_snapshot(
        self, account_id: UUID, filters: TaskFilters | None = None
    ) -> builtins.list[AcademicTaskRecord]:
        resolved_filters = filters or TaskFilters()
        if isinstance(self._repository, AcademicTaskRepositorySnapshots):
            return await self._repository.list_snapshot(account_id, resolved_filters)
        return await self._repository.list(account_id, resolved_filters)

    async def get(self, account_id: UUID, task_id: UUID) -> AcademicTaskRecord | None:
        return await self._repository.get(account_id, task_id)

    async def update(
        self, account_id: UUID, task_id: UUID, task: NewAcademicTask
    ) -> AcademicTaskRecord | None:
        now = self._clock()
        if task.deadline_at.tzinfo is None:
            raise InvalidTaskDeadlineError
        return await self._repository.update(
            account_id,
            task_id,
            replace(task, deadline_at=task.deadline_at.astimezone(UTC)),
            now,
        )

    async def delete(self, account_id: UUID, task_id: UUID) -> bool:
        return await self._repository.delete(account_id, task_id)

    async def finish_early(self, account_id: UUID, task_id: UUID) -> bool:
        return await self._repository.finish_early(account_id, task_id, self._clock())

    async def mark_started(self, account_id: UUID, task_id: UUID) -> bool:
        return await self._repository.mark_started(account_id, task_id, self._clock())
