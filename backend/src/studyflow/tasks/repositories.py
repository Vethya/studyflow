"""SQLAlchemy Academic Task repositories."""

from collections.abc import Callable
from datetime import UTC, datetime
from typing import Protocol
from uuid import UUID

from sqlalchemy import delete, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from studyflow.auth.repositories import SessionTransactions
from studyflow.database.models import AcademicTask, StudentAccount, TaskDeadlineHistory
from studyflow.database.models import StudySession as SessionRow
from studyflow.database.models import StudySessionOutcome as OutcomeRow
from studyflow.estimation import (
    AdaptiveEstimatePreview,
    AdaptiveEstimateUnavailableError,
    AdaptiveEstimator,
)
from studyflow.estimation.repositories import SqlAlchemyAdaptivePredictionRepository
from studyflow.tasks.service import (
    AcademicTaskRecord,
    EstimateFrozenError,
    InvalidTaskDeadlineError,
    NewAcademicTask,
    PlannedDurationSource,
    TaskCategory,
    TaskFilters,
    TaskMustBeStartedError,
    TaskPriority,
    TaskStatus,
)


class TaskDeadlineSessionInvalidator(Protocol):
    async def remove_sessions_after_deadline(
        self,
        session: AsyncSession,
        account_id: UUID,
        task_id: UUID,
        deadline_at: datetime,
        now: datetime,
    ) -> list[UUID]: ...


class TaskRecoveryProposalInvalidator(Protocol):
    async def invalidate_for_task(
        self,
        session: AsyncSession,
        account_id: UUID,
        task_id: UUID,
    ) -> None: ...


class NoTaskDeadlineSessions:
    async def remove_sessions_after_deadline(
        self,
        session: AsyncSession,
        account_id: UUID,
        task_id: UUID,
        deadline_at: datetime,
        now: datetime,
    ) -> list[UUID]:
        return []


class NoTaskRecoveryProposals:
    async def invalidate_for_task(
        self,
        session: AsyncSession,
        account_id: UUID,
        task_id: UUID,
    ) -> None:
        return None


class SqlAlchemyTaskDeadlineSessionInvalidator:
    async def remove_sessions_after_deadline(
        self,
        session: AsyncSession,
        account_id: UUID,
        task_id: UUID,
        deadline_at: datetime,
        now: datetime,
    ) -> list[UUID]:
        rows = list(
            await session.scalars(
                select(SessionRow)
                .where(
                    SessionRow.account_id == account_id,
                    SessionRow.task_id == task_id,
                    SessionRow.proposal_id.is_(None),
                    SessionRow.invalidated_at.is_(None),
                    SessionRow.starts_at > now,
                    SessionRow.ends_at > deadline_at,
                )
                .order_by(SessionRow.starts_at, SessionRow.id)
                .with_for_update()
            )
        )
        invalidated_ids = [row.id for row in rows]
        for row in rows:
            row.invalidated_at = now
            row.invalidation_reason = "deadline"
            session.add(
                OutcomeRow(
                    session_id=row.id,
                    kind="delayed",
                    actual_minutes=0,
                    remaining_minutes=row.planned_duration_minutes,
                    recorded_at=now,
                    rescheduled_at=None,
                )
            )
        return invalidated_ids


class SqlAlchemyAcademicTaskRepository:
    def __init__(
        self,
        database: SessionTransactions,
        invalidator: TaskDeadlineSessionInvalidator | None = None,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
        recovery_invalidator: TaskRecoveryProposalInvalidator | None = None,
        estimator: AdaptiveEstimator | None = None,
        prediction_repository: SqlAlchemyAdaptivePredictionRepository | None = None,
    ) -> None:
        self._database = database
        self._invalidator = invalidator or NoTaskDeadlineSessions()
        self._clock = clock
        self._recovery_invalidator = recovery_invalidator or NoTaskRecoveryProposals()
        self._estimator = estimator
        self._prediction_repository = prediction_repository

    async def create(self, account_id: UUID, task: NewAcademicTask) -> AcademicTaskRecord:
        async with self._database.transaction() as session:
            if not await self._lock_account(session, account_id):
                raise ValueError("Account not found")
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
            preview = await self._capture_estimate(
                session,
                account_id,
                row.id,
                task.category,
                task.original_estimate_minutes,
                task.planned_source,
            )
            self._apply_snapshot(row, task.original_estimate_minutes, preview)
            await session.flush()
            await session.refresh(row)
            return self._to_record(row)

    async def list(
        self, account_id: UUID, filters: TaskFilters | None = None
    ) -> list[AcademicTaskRecord]:
        async with self._database.transaction() as session:
            filters = filters or TaskFilters()
            now = self._clock()
            await self._freeze_started_estimates(session, account_id, now)
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
            if filters.status is TaskStatus.COMPLETED:
                conditions.append(
                    or_(
                        AcademicTask.completed_at.is_not(None),
                        AcademicTask.finished_early_at.is_not(None),
                    )
                )
            elif filters.status is TaskStatus.OVERDUE:
                conditions.extend(
                    [
                        AcademicTask.completed_at.is_(None),
                        AcademicTask.finished_early_at.is_(None),
                        AcademicTask.deadline_at < now,
                    ]
                )
            elif filters.status is TaskStatus.IN_PROGRESS:
                conditions.extend(
                    [
                        AcademicTask.completed_at.is_(None),
                        AcademicTask.finished_early_at.is_(None),
                        AcademicTask.deadline_at >= now,
                        AcademicTask.estimate_frozen_at.is_not(None),
                    ]
                )
            elif filters.status is TaskStatus.NOT_STARTED:
                conditions.extend(
                    [
                        AcademicTask.completed_at.is_(None),
                        AcademicTask.finished_early_at.is_(None),
                        AcademicTask.deadline_at >= now,
                        AcademicTask.estimate_frozen_at.is_(None),
                    ]
                )
            rows = await session.scalars(
                select(AcademicTask)
                .where(*conditions)
                .order_by(AcademicTask.deadline_at, AcademicTask.id)
            )
            return [self._to_record(row, now) for row in rows]

    async def get(self, account_id: UUID, task_id: UUID) -> AcademicTaskRecord | None:
        async with self._database.transaction() as session:
            await self._freeze_started_estimates(session, account_id, self._clock())
            row = await session.scalar(
                select(AcademicTask).where(
                    AcademicTask.id == task_id, AcademicTask.account_id == account_id
                )
            )
            return self._to_record(row) if row is not None else None

    async def update(
        self, account_id: UUID, task_id: UUID, task: NewAcademicTask, now: datetime
    ) -> AcademicTaskRecord | None:
        async with self._database.transaction() as session:
            if not await self._lock_account(session, account_id):
                return None
            await self._freeze_started_estimates(session, account_id, now)
            row = await session.scalar(
                select(AcademicTask)
                .where(AcademicTask.id == task_id, AcademicTask.account_id == account_id)
                .with_for_update()
            )
            if row is None:
                return None
            if row.estimate_frozen_at is not None and (
                row.original_estimate_minutes != task.original_estimate_minutes
                or (
                    task.planned_source is not None
                    and task.planned_source.value != row.planned_source
                )
            ):
                raise EstimateFrozenError
            previous_deadline = self._aware(row.deadline_at)
            deadline_changed = previous_deadline != task.deadline_at
            if deadline_changed and task.deadline_at <= now:
                raise InvalidTaskDeadlineError
            if deadline_changed:
                session.add(
                    TaskDeadlineHistory(
                        task_id=row.id,
                        previous_deadline_at=row.deadline_at,
                        new_deadline_at=task.deadline_at,
                        changed_at=now,
                    )
                )
            if task.deadline_at < previous_deadline:
                await self._invalidator.remove_sessions_after_deadline(
                    session,
                    account_id,
                    row.id,
                    task.deadline_at,
                    now,
                )
            row.title = task.title
            row.category = task.category.value
            row.priority = task.priority.value
            row.course = task.course
            row.notes = task.notes
            row.deadline_at = task.deadline_at
            row.original_estimate_minutes = task.original_estimate_minutes
            if row.estimate_frozen_at is None:
                self._apply_snapshot(row, task.original_estimate_minutes, None)
                preview = await self._capture_estimate(
                    session,
                    account_id,
                    row.id,
                    task.category,
                    task.original_estimate_minutes,
                    task.planned_source,
                    replace=True,
                )
                self._apply_snapshot(row, task.original_estimate_minutes, preview)
            await session.flush()
            await session.refresh(row)
            return self._to_record(row)

    async def delete(self, account_id: UUID, task_id: UUID) -> bool:
        async with self._database.transaction() as session:
            row = await session.scalar(
                select(AcademicTask)
                .where(AcademicTask.id == task_id, AcademicTask.account_id == account_id)
                .with_for_update()
            )
            if row is None:
                return False
            await self._recovery_invalidator.invalidate_for_task(
                session,
                account_id,
                row.id,
            )
            await session.execute(
                delete(TaskDeadlineHistory).where(TaskDeadlineHistory.task_id == row.id)
            )
            await session.delete(row)
        return True

    async def mark_started(self, account_id: UUID, task_id: UUID, now: datetime) -> bool:
        async with self._database.transaction() as session:
            row = await session.scalar(
                select(AcademicTask)
                .where(AcademicTask.id == task_id, AcademicTask.account_id == account_id)
                .with_for_update()
            )
            if row is None:
                return False
            row.estimate_frozen_at = row.estimate_frozen_at or now
        return True

    async def finish_early(self, account_id: UUID, task_id: UUID, now: datetime) -> bool:
        async with self._database.transaction() as session:
            await self._freeze_started_estimates(session, account_id, now)
            row = await session.scalar(
                select(AcademicTask)
                .where(AcademicTask.id == task_id, AcademicTask.account_id == account_id)
                .with_for_update()
            )
            if row is None:
                return False
            if row.estimate_frozen_at is None:
                raise TaskMustBeStartedError
            await self._recovery_invalidator.invalidate_for_task(
                session,
                account_id,
                row.id,
            )
            await session.execute(
                delete(SessionRow).where(
                    SessionRow.account_id == account_id,
                    SessionRow.task_id == row.id,
                    SessionRow.proposal_id.is_(None),
                    SessionRow.starts_at > now,
                )
            )
            row.completed_at = row.completed_at or now
            row.finished_early_at = row.finished_early_at or now
        return True

    @staticmethod
    async def _freeze_started_estimates(
        session: AsyncSession, account_id: UUID, now: datetime
    ) -> None:
        started_task_ids = select(SessionRow.task_id).where(
            SessionRow.account_id == account_id,
            SessionRow.proposal_id.is_(None),
            SessionRow.invalidated_at.is_(None),
            SessionRow.starts_at <= now,
        )
        await session.execute(
            update(AcademicTask)
            .where(
                AcademicTask.account_id == account_id,
                AcademicTask.estimate_frozen_at.is_(None),
                AcademicTask.id.in_(started_task_ids),
            )
            .values(estimate_frozen_at=now)
        )

    @staticmethod
    def _aware(value: datetime) -> datetime:
        return value if value.tzinfo is not None else value.replace(tzinfo=UTC)

    @staticmethod
    async def _lock_account(session: AsyncSession, account_id: UUID) -> bool:
        account = await session.get(StudentAccount, account_id, with_for_update=True)
        return account is not None

    async def _capture_estimate(
        self,
        session: AsyncSession,
        account_id: UUID,
        task_id: UUID,
        category: TaskCategory,
        original_minutes: int,
        planned_source: PlannedDurationSource | None,
        *,
        replace: bool = False,
    ) -> AdaptiveEstimatePreview | None:
        if self._estimator is None or self._prediction_repository is None:
            if planned_source is PlannedDurationSource.ADAPTIVE:
                raise AdaptiveEstimateUnavailableError
            return None
        return await self._estimator.capture_for_task(
            account_id,
            task_id,
            category,
            original_minutes,
            planned_source=planned_source.value if planned_source is not None else None,
            repository=self._prediction_repository.with_session(session),
            replace=replace,
        )

    @staticmethod
    def _apply_snapshot(
        row: AcademicTask,
        original_minutes: int,
        preview: AdaptiveEstimatePreview | None,
    ) -> None:
        if preview is None:
            row.adaptive_estimate_minutes = None
            row.planned_source = PlannedDurationSource.ORIGINAL.value
            row.planned_duration_minutes = original_minutes
            return
        row.adaptive_estimate_minutes = preview.adaptive_minutes
        row.planned_source = preview.planned_source
        if preview.planned_source == "adaptive":
            if preview.adaptive_minutes is None:
                raise ValueError("Adaptive source requires an adaptive estimate")
            row.planned_duration_minutes = preview.adaptive_minutes
        else:
            row.planned_duration_minutes = original_minutes

    def _to_record(self, row: AcademicTask, now: datetime | None = None) -> AcademicTaskRecord:
        now = now or self._clock()
        if row.completed_at is not None or row.finished_early_at is not None:
            task_status = TaskStatus.COMPLETED
        elif self._aware(row.deadline_at) < now:
            task_status = TaskStatus.OVERDUE
        elif row.estimate_frozen_at is not None:
            task_status = TaskStatus.IN_PROGRESS
        else:
            task_status = TaskStatus.NOT_STARTED
        return AcademicTaskRecord(
            id=row.id,
            account_id=row.account_id,
            title=row.title,
            category=TaskCategory(row.category),
            priority=TaskPriority(row.priority),
            course=row.course,
            notes=row.notes,
            deadline_at=self._aware(row.deadline_at),
            original_estimate_minutes=row.original_estimate_minutes,
            planned_duration_minutes=row.planned_duration_minutes,
            created_at=self._aware(row.created_at),
            updated_at=self._aware(row.updated_at),
            status=task_status,
            adaptive_estimate_minutes=row.adaptive_estimate_minutes,
            planned_source=PlannedDurationSource(row.planned_source),
            estimate_frozen=row.estimate_frozen_at is not None,
        )
