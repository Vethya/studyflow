from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest

from studyflow.tasks.service import (
    AcademicTaskRecord,
    AcademicTaskService,
    InvalidTaskDeadlineError,
    NewAcademicTask,
    TaskCategory,
    TaskFilters,
    TaskMustBeStartedError,
    TaskPriority,
)


@dataclass
class RepositoryStub:
    created: list[tuple[UUID, NewAcademicTask]] = field(default_factory=list)
    finish_requires_start: bool = False

    async def create(self, account_id: UUID, task: NewAcademicTask) -> AcademicTaskRecord:
        self.created.append((account_id, task))
        now = datetime.now(UTC)
        return AcademicTaskRecord(
            uuid4(),
            account_id,
            task.title,
            task.category,
            task.priority,
            task.course,
            task.notes,
            task.deadline_at,
            task.original_estimate_minutes,
            task.original_estimate_minutes,
            now,
            now,
        )

    async def list(
        self, account_id: UUID, filters: TaskFilters | None = None
    ) -> list[AcademicTaskRecord]:
        return []

    async def get(self, account_id: UUID, task_id: UUID) -> AcademicTaskRecord | None:
        return None

    async def update(
        self, account_id: UUID, task_id: UUID, task: NewAcademicTask, now: datetime
    ) -> AcademicTaskRecord | None:
        return None

    async def delete(self, account_id: UUID, task_id: UUID) -> bool:
        return False

    async def finish_early(self, account_id: UUID, task_id: UUID, now: datetime) -> bool:
        if self.finish_requires_start:
            raise TaskMustBeStartedError
        return False

    async def mark_started(self, account_id: UUID, task_id: UUID, now: datetime) -> bool:
        return False


@pytest.mark.anyio
async def test_task_creation_requires_future_absolute_deadline() -> None:
    now = datetime(2026, 7, 29, 12, tzinfo=UTC)
    account_id = uuid4()
    repository = RepositoryStub()
    service = AcademicTaskService(repository, clock=lambda: now)
    draft = NewAcademicTask(
        title="Read chapter 4",
        category=TaskCategory.READING,
        priority=TaskPriority.MEDIUM,
        course=None,
        notes=None,
        deadline_at=now + timedelta(days=1),
        original_estimate_minutes=90,
    )

    created = await service.create(account_id, draft)

    assert created.planned_duration_minutes == 90
    with pytest.raises(InvalidTaskDeadlineError):
        await service.create(account_id, replace(draft, deadline_at=now))
    with pytest.raises(InvalidTaskDeadlineError):
        await service.create(account_id, replace(draft, deadline_at=now.replace(tzinfo=None)))


@pytest.mark.anyio
async def test_task_service_preserves_the_must_start_lifecycle_error() -> None:
    now = datetime(2026, 7, 29, 12, tzinfo=UTC)
    service = AcademicTaskService(RepositoryStub(finish_requires_start=True), clock=lambda: now)

    with pytest.raises(TaskMustBeStartedError):
        await service.finish_early(uuid4(), uuid4())
