import builtins
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, timedelta
from typing import cast
from uuid import UUID, uuid4

import pytest

from studyflow.tasks.service import (
    AcademicTaskRecord,
    AcademicTaskRepositorySnapshots,
    AcademicTasks,
    AcademicTaskService,
    AcademicTaskSnapshots,
    InvalidTaskDeadlineError,
    NewAcademicTask,
    PlannedDurationSource,
    TaskCategory,
    TaskFilters,
    TaskMustBeStartedError,
    TaskPriority,
    list_task_snapshot,
)


@dataclass
class RepositoryStub:
    created: list[tuple[UUID, NewAcademicTask]] = field(default_factory=list)
    finish_requires_start: bool = False
    task_records: list[AcademicTaskRecord] = field(default_factory=list)
    deleted: list[tuple[UUID, UUID]] = field(default_factory=list)
    started: list[tuple[UUID, UUID, datetime]] = field(default_factory=list)
    updated: list[tuple[UUID, UUID, NewAcademicTask, datetime]] = field(default_factory=list)

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
        return self.task_records

    async def get(self, account_id: UUID, task_id: UUID) -> AcademicTaskRecord | None:
        return next((t for t in self.task_records if t.id == task_id), None)

    async def update(
        self, account_id: UUID, task_id: UUID, task: NewAcademicTask, now: datetime
    ) -> AcademicTaskRecord | None:
        self.updated.append((account_id, task_id, task, now))
        return next((t for t in self.task_records if t.id == task_id), None)

    async def delete(self, account_id: UUID, task_id: UUID) -> bool:
        self.deleted.append((account_id, task_id))
        return any(t.id == task_id for t in self.task_records)

    async def finish_early(self, account_id: UUID, task_id: UUID, now: datetime) -> bool:
        if self.finish_requires_start:
            raise TaskMustBeStartedError
        return any(t.id == task_id for t in self.task_records)

    async def mark_started(self, account_id: UUID, task_id: UUID, now: datetime) -> bool:
        self.started.append((account_id, task_id, now))
        return any(t.id == task_id for t in self.task_records)


@dataclass
class SnapshotRepositoryStub(RepositoryStub, AcademicTaskRepositorySnapshots):
    snapshot_records: list[AcademicTaskRecord] = field(default_factory=list)

    async def list_snapshot(
        self, account_id: UUID, filters: TaskFilters | None = None
    ) -> list[AcademicTaskRecord]:
        return self.snapshot_records


class SnapshotTasksStub(AcademicTaskSnapshots):
    async def list(
        self, account_id: UUID, filters: TaskFilters | None = None
    ) -> builtins.list[AcademicTaskRecord]:
        return []

    async def list_snapshot(
        self, account_id: UUID, filters: TaskFilters | None = None
    ) -> builtins.list[AcademicTaskRecord]:
        return [
            AcademicTaskRecord(
                uuid4(),
                account_id,
                "Snapshot task",
                TaskCategory.READING,
                TaskPriority.LOW,
                None,
                None,
                datetime(2026, 8, 1, tzinfo=UTC),
                30,
                30,
                datetime(2026, 7, 29, tzinfo=UTC),
                datetime(2026, 7, 29, tzinfo=UTC),
            )
        ]


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


def test_new_task_leaves_source_selection_to_the_server_by_default() -> None:
    task = NewAcademicTask(
        title="Read chapter 4",
        category=TaskCategory.READING,
        priority=TaskPriority.MEDIUM,
        course=None,
        notes=None,
        deadline_at=datetime(2026, 7, 30, 12, tzinfo=UTC),
        original_estimate_minutes=90,
    )

    assert task.planned_source is None
    assert PlannedDurationSource.ORIGINAL.value == "original"


@pytest.mark.anyio
async def test_task_service_delegates_list_get_update_delete_and_lifecycle() -> None:
    now = datetime(2026, 7, 29, 12, tzinfo=UTC)
    account_id = uuid4()
    task_id = uuid4()
    task = AcademicTaskRecord(
        task_id,
        account_id,
        "Read chapter 4",
        TaskCategory.READING,
        TaskPriority.MEDIUM,
        None,
        None,
        now + timedelta(days=2),
        60,
        60,
        now,
        now,
    )
    repo = RepositoryStub(task_records=[task])
    service = AcademicTaskService(repo, clock=lambda: now)

    assert await service.list(account_id) == [task]
    assert await service.get(account_id, task_id) == task
    assert await service.get(account_id, uuid4()) is None

    draft = NewAcademicTask(
        title="Read chapter 5",
        category=TaskCategory.READING,
        priority=TaskPriority.HIGH,
        course=None,
        notes=None,
        deadline_at=now + timedelta(days=3),
        original_estimate_minutes=60,
    )
    updated = await service.update(account_id, task_id, draft)
    assert updated == task
    assert len(repo.updated) == 1

    with pytest.raises(InvalidTaskDeadlineError):
        await service.update(
            account_id, task_id, replace(draft, deadline_at=draft.deadline_at.replace(tzinfo=None))
        )

    assert await service.finish_early(account_id, task_id) is True
    assert await service.mark_started(account_id, task_id) is True
    assert await service.delete(account_id, task_id) is True


@pytest.mark.anyio
async def test_task_service_and_snapshot_dispatch() -> None:
    now = datetime(2026, 7, 29, 12, tzinfo=UTC)
    account_id = uuid4()
    task = AcademicTaskRecord(
        uuid4(),
        account_id,
        "Snapshot task",
        TaskCategory.READING,
        TaskPriority.LOW,
        None,
        None,
        now + timedelta(days=1),
        30,
        30,
        now,
        now,
    )

    # 1. list_task_snapshot with AcademicTaskSnapshots
    snapshot_tasks = SnapshotTasksStub()
    result = await list_task_snapshot(cast(AcademicTasks, snapshot_tasks), account_id)
    assert len(result) == 1
    assert result[0].title == "Snapshot task"

    # 2. list_task_snapshot without AcademicTaskSnapshots
    plain_repo = RepositoryStub(task_records=[task])
    plain_service = AcademicTaskService(plain_repo, clock=lambda: now)
    result_plain = await list_task_snapshot(plain_service, account_id)
    assert result_plain == [task]

    # 3. AcademicTaskService.list_snapshot with AcademicTaskRepositorySnapshots
    snap_repo = SnapshotRepositoryStub(snapshot_records=[task])
    snap_service = AcademicTaskService(snap_repo, clock=lambda: now)
    assert await snap_service.list_snapshot(account_id) == [task]

    # 4. AcademicTaskService.list_snapshot without AcademicTaskRepositorySnapshots
    assert await plain_service.list_snapshot(account_id) == [task]
