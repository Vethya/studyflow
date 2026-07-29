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
    TaskPriority,
)


@dataclass
class RepositoryStub:
    created: list[tuple[UUID, NewAcademicTask]] = field(default_factory=list)

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
