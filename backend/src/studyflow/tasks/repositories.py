"""SQLAlchemy Academic Task repositories."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select

from studyflow.auth.repositories import SessionTransactions
from studyflow.database.models import AcademicTask
from studyflow.tasks.service import (
    AcademicTaskRecord,
    NewAcademicTask,
    TaskCategory,
    TaskFilters,
    TaskPriority,
)


class SqlAlchemyAcademicTaskRepository:
    def __init__(self, database: SessionTransactions) -> None:
        self._database = database

    async def create(self, account_id: UUID, task: NewAcademicTask) -> AcademicTaskRecord:
        async with self._database.transaction() as session:
            row = AcademicTask(
                account_id=account_id,
                title=task.title,
                category=task.category.value,
                priority=task.priority.value,
                course=task.course,
                notes=task.notes,
                deadline_at=task.deadline_at,
                original_estimate_minutes=task.original_estimate_minutes,
                adaptive_estimate_minutes=None,
                planned_source="original",
                planned_duration_minutes=task.original_estimate_minutes,
            )
            session.add(row)
            await session.flush()
            await session.refresh(row)
            return self._to_record(row)

    async def list(
        self, account_id: UUID, filters: TaskFilters | None = None
    ) -> list[AcademicTaskRecord]:
        async with self._database.transaction() as session:
            filters = filters or TaskFilters()
            conditions = [AcademicTask.account_id == account_id]
            if filters.course is not None:
                conditions.append(AcademicTask.course == filters.course)
            if filters.category is not None:
                conditions.append(AcademicTask.category == filters.category.value)
            if filters.priority is not None:
                conditions.append(AcademicTask.priority == filters.priority.value)
            if filters.deadline_from is not None:
                conditions.append(AcademicTask.deadline_at >= filters.deadline_from)
            if filters.deadline_to is not None:
                conditions.append(AcademicTask.deadline_at <= filters.deadline_to)
            rows = await session.scalars(
                select(AcademicTask)
                .where(*conditions)
                .order_by(AcademicTask.deadline_at, AcademicTask.id)
            )
            return [self._to_record(row) for row in rows]

    async def get(self, account_id: UUID, task_id: UUID) -> AcademicTaskRecord | None:
        async with self._database.transaction() as session:
            row = await session.scalar(
                select(AcademicTask).where(
                    AcademicTask.id == task_id, AcademicTask.account_id == account_id
                )
            )
            return self._to_record(row) if row is not None else None

    @staticmethod
    def _aware(value: datetime) -> datetime:
        return value if value.tzinfo is not None else value.replace(tzinfo=UTC)

    @classmethod
    def _to_record(cls, row: AcademicTask) -> AcademicTaskRecord:
        return AcademicTaskRecord(
            id=row.id,
            account_id=row.account_id,
            title=row.title,
            category=TaskCategory(row.category),
            priority=TaskPriority(row.priority),
            course=row.course,
            notes=row.notes,
            deadline_at=cls._aware(row.deadline_at),
            original_estimate_minutes=row.original_estimate_minutes,
            planned_duration_minutes=row.planned_duration_minutes,
            created_at=cls._aware(row.created_at),
            updated_at=cls._aware(row.updated_at),
        )
