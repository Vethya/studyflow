"""SQLAlchemy persistence for chronological adaptive-estimation evidence."""

from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from typing import Protocol
from uuid import UUID

from sqlalchemy import Select, case, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from studyflow.auth.repositories import SessionTransactions
from studyflow.database.models import AcademicTask, StudentAccount
from studyflow.database.models import AdaptiveEstimationAcknowledgment as AcknowledgmentRow
from studyflow.database.models import AdaptiveEstimationPrediction as PredictionRow
from studyflow.database.models import StudySession as SessionRow
from studyflow.database.models import StudySessionOutcome as OutcomeRow
from studyflow.estimation.model import CorrectionPrediction, HistoryRecord, PredictionEvaluation
from studyflow.tasks.service import TaskCategory


def _evaluation_statement(
    account_id: UUID,
) -> Select[tuple[PredictionRow, datetime | None, int]]:
    """Select prediction evaluations with PostgreSQL-valid deterministic ordering."""
    confirmed_minutes = func.coalesce(
        func.sum(
            case(
                (OutcomeRow.kind.in_(("completed", "delayed")), OutcomeRow.actual_minutes),
                else_=0,
            )
        ),
        0,
    ).label("actual_duration")
    return (
        select(PredictionRow, AcademicTask.completed_at, confirmed_minutes)
        .join(AcademicTask, AcademicTask.id == PredictionRow.task_id)
        .outerjoin(
            SessionRow,
            (SessionRow.task_id == AcademicTask.id) & (SessionRow.account_id == account_id),
        )
        .outerjoin(OutcomeRow, OutcomeRow.session_id == SessionRow.id)
        .where(
            PredictionRow.account_id == account_id,
            AcademicTask.account_id == account_id,
        )
        .group_by(PredictionRow.task_id, AcademicTask.completed_at, AcademicTask.id)
        .order_by(AcademicTask.completed_at, AcademicTask.id)
    )


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


async def _load_history(session: AsyncSession, account_id: UUID) -> list[HistoryRecord]:
    """Load completed-task history followed by provisional in-progress records.

    A provisional record is an open task with at least one Delayed outcome. Its projected
    duration is the confirmed work so far plus the task's remaining planned work, where the
    remaining work subtracts each outcome's resolved share (session planned minutes minus the
    outcome's revised remaining minutes), mirroring the Effort Progress calculation.
    """
    actual_duration = func.sum(OutcomeRow.actual_minutes).label("actual_duration")
    completed_rows = await session.execute(
        select(
            AcademicTask.id,
            AcademicTask.category,
            AcademicTask.original_estimate_minutes,
            actual_duration,
            AcademicTask.completed_at,
        )
        .join(SessionRow, SessionRow.task_id == AcademicTask.id)
        .join(OutcomeRow, OutcomeRow.session_id == SessionRow.id)
        .where(
            AcademicTask.account_id == account_id,
            SessionRow.account_id == account_id,
            AcademicTask.completed_at.is_not(None),
            OutcomeRow.kind.in_(("completed", "delayed")),
        )
        .group_by(
            AcademicTask.id,
            AcademicTask.category,
            AcademicTask.original_estimate_minutes,
            AcademicTask.completed_at,
        )
        .having(func.sum(OutcomeRow.actual_minutes) > 0)
        .order_by(AcademicTask.completed_at, AcademicTask.id)
    )
    history = [
        HistoryRecord(
            task_id=row.id,
            category=TaskCategory(row.category),
            original_minutes=row.original_estimate_minutes,
            actual_minutes=int(row.actual_duration),
            completed_at=_aware(row.completed_at),
        )
        for row in completed_rows
    ]

    open_rows = await session.execute(
        select(
            AcademicTask.id,
            AcademicTask.category,
            AcademicTask.original_estimate_minutes,
            AcademicTask.planned_duration_minutes,
            SessionRow.planned_duration_minutes.label("session_minutes"),
            OutcomeRow.kind,
            OutcomeRow.actual_minutes,
            OutcomeRow.remaining_minutes,
            OutcomeRow.recorded_at,
        )
        .join(SessionRow, SessionRow.task_id == AcademicTask.id)
        .join(OutcomeRow, OutcomeRow.session_id == SessionRow.id)
        .where(
            AcademicTask.account_id == account_id,
            SessionRow.account_id == account_id,
            SessionRow.proposal_id.is_(None),
            AcademicTask.completed_at.is_(None),
            AcademicTask.finished_early_at.is_(None),
        )
        .order_by(AcademicTask.id, OutcomeRow.recorded_at, OutcomeRow.session_id)
    )
    progress: dict[UUID, _OpenTaskProgress] = {}
    for row in open_rows:
        item = progress.setdefault(
            row.id,
            _OpenTaskProgress(
                category=TaskCategory(row.category),
                original_minutes=row.original_estimate_minutes,
                planned_minutes=row.planned_duration_minutes,
            ),
        )
        if row.kind in ("completed", "delayed"):
            item.actual_minutes += row.actual_minutes
        item.resolved_minutes += row.session_minutes - row.remaining_minutes
        if row.kind == "delayed":
            recorded_at = _aware(row.recorded_at)
            if item.last_delayed_at is None or recorded_at > item.last_delayed_at:
                item.last_delayed_at = recorded_at

    provisional = [
        HistoryRecord(
            task_id=task_id,
            category=item.category,
            original_minutes=item.original_minutes,
            actual_minutes=item.actual_minutes
            + max(item.planned_minutes - item.resolved_minutes, 0),
            completed_at=item.last_delayed_at,
            provisional=True,
        )
        for task_id, item in progress.items()
        if item.last_delayed_at is not None and item.actual_minutes > 0
    ]
    provisional.sort(key=lambda record: (record.completed_at, record.task_id))
    return history + provisional


@dataclass(slots=True)
class _OpenTaskProgress:
    category: TaskCategory
    original_minutes: int
    planned_minutes: int
    actual_minutes: int = 0
    resolved_minutes: int = 0
    last_delayed_at: datetime | None = None


class AdaptivePredictionRepository(Protocol):
    async def history(self, account_id: UUID) -> list[HistoryRecord]: ...

    async def evaluations(self, account_id: UUID) -> list[PredictionEvaluation]: ...

    async def save_prediction(
        self,
        account_id: UUID,
        task_id: UUID,
        prediction: CorrectionPrediction,
        *,
        exposed: bool,
    ) -> bool: ...

    async def replace_prediction(
        self,
        account_id: UUID,
        task_id: UUID,
        prediction: CorrectionPrediction,
        *,
        exposed: bool,
    ) -> bool: ...

    async def remove_prediction(self, account_id: UUID, task_id: UUID) -> bool: ...

    async def acknowledgment(self, account_id: UUID, category: TaskCategory) -> Decimal | None: ...

    async def acknowledge(
        self,
        account_id: UUID,
        category: TaskCategory,
        correction_factor: Decimal,
        acknowledged_at: datetime,
    ) -> bool: ...

    async def remove_acknowledgment(self, account_id: UUID, category: TaskCategory) -> bool: ...

    async def clear_acknowledgments(self, account_id: UUID) -> None: ...


class SqlAlchemyAdaptivePredictionRepository:
    def __init__(self, database: SessionTransactions) -> None:
        self._database = database

    def with_session(self, session: AsyncSession) -> "SessionAdaptivePredictionRepository":
        """Bind prediction operations to a caller-owned transaction."""
        return SessionAdaptivePredictionRepository(session)

    async def history(self, account_id: UUID) -> list[HistoryRecord]:
        async with self._database.transaction() as session:
            return await _load_history(session, account_id)

    async def evaluations(self, account_id: UUID) -> list[PredictionEvaluation]:
        async with self._database.transaction() as session:
            rows = await session.execute(_evaluation_statement(account_id))
            evaluations: list[PredictionEvaluation] = []
            for prediction, completed_at, actual_duration in rows:
                actual_minutes = int(actual_duration)
                evaluations.append(
                    PredictionEvaluation(
                        task_id=prediction.task_id,
                        original_minutes=prediction.original_minutes,
                        adaptive_minutes=prediction.predicted_minutes,
                        actual_minutes=(
                            actual_minutes
                            if completed_at is not None and actual_minutes > 0
                            else None
                        ),
                        completed_at=(
                            self._aware(completed_at) if completed_at is not None else None
                        ),
                    )
                )
            return evaluations

    async def save_prediction(
        self,
        account_id: UUID,
        task_id: UUID,
        prediction: CorrectionPrediction,
        *,
        exposed: bool,
    ) -> bool:
        async with self._database.transaction() as session:
            account = await session.get(StudentAccount, account_id, with_for_update=True)
            if account is None:
                return False
            task = await session.scalar(
                select(AcademicTask)
                .where(AcademicTask.id == task_id, AcademicTask.account_id == account_id)
                .with_for_update()
            )
            if (
                task is None
                or task.estimate_frozen_at is not None
                or task.completed_at is not None
                or await session.get(PredictionRow, task_id) is not None
            ):
                return False
            session.add(self._prediction_row(task, prediction, exposed))
            return True

    async def replace_prediction(
        self,
        account_id: UUID,
        task_id: UUID,
        prediction: CorrectionPrediction,
        *,
        exposed: bool,
    ) -> bool:
        async with self._database.transaction() as session:
            account = await session.get(StudentAccount, account_id, with_for_update=True)
            if account is None:
                return False
            task = await session.scalar(
                select(AcademicTask)
                .where(AcademicTask.id == task_id, AcademicTask.account_id == account_id)
                .with_for_update()
            )
            if task is None or task.estimate_frozen_at is not None or task.completed_at is not None:
                return False
            existing = await session.get(PredictionRow, task_id, with_for_update=True)
            if existing is not None and existing.account_id != account_id:
                return False
            if existing is not None:
                await session.delete(existing)
                await session.flush()
            session.add(self._prediction_row(task, prediction, exposed))
            return True

    async def remove_prediction(self, account_id: UUID, task_id: UUID) -> bool:
        async with self._database.transaction() as session:
            account = await session.get(StudentAccount, account_id, with_for_update=True)
            if account is None:
                return False
            task = await session.scalar(
                select(AcademicTask)
                .where(AcademicTask.id == task_id, AcademicTask.account_id == account_id)
                .with_for_update()
            )
            if task is None or task.estimate_frozen_at is not None or task.completed_at is not None:
                return False
            existing = await session.get(PredictionRow, task_id, with_for_update=True)
            if existing is not None:
                if existing.account_id != account_id:
                    return False
                await session.delete(existing)
            return True

    async def acknowledgment(self, account_id: UUID, category: TaskCategory) -> Decimal | None:
        async with self._database.transaction() as session:
            row = await session.get(AcknowledgmentRow, (account_id, category.value))
            return row.correction_factor if row is not None else None

    async def acknowledge(
        self,
        account_id: UUID,
        category: TaskCategory,
        correction_factor: Decimal,
        acknowledged_at: datetime,
    ) -> bool:
        async with self._database.transaction() as session:
            account = await session.get(StudentAccount, account_id, with_for_update=True)
            if account is None:
                return False
            row = await session.get(
                AcknowledgmentRow,
                (account_id, category.value),
                with_for_update=True,
            )
            if row is None:
                session.add(
                    AcknowledgmentRow(
                        account_id=account_id,
                        category=category.value,
                        correction_factor=correction_factor,
                        acknowledged_at=acknowledged_at,
                    )
                )
            else:
                row.correction_factor = correction_factor
                row.acknowledged_at = acknowledged_at
            return True

    async def remove_acknowledgment(self, account_id: UUID, category: TaskCategory) -> bool:
        async with self._database.transaction() as session:
            row = await session.get(
                AcknowledgmentRow, (account_id, category.value), with_for_update=True
            )
            if row is None:
                return False
            await session.delete(row)
            return True

    async def clear_acknowledgments(self, account_id: UUID) -> None:
        async with self._database.transaction() as session:
            await session.execute(
                delete(AcknowledgmentRow).where(AcknowledgmentRow.account_id == account_id)
            )

    @staticmethod
    def _prediction_row(
        task: AcademicTask, prediction: CorrectionPrediction, exposed: bool
    ) -> PredictionRow:
        return PredictionRow(
            task_id=task.id,
            account_id=task.account_id,
            category=task.category,
            original_minutes=task.original_estimate_minutes,
            predicted_minutes=prediction.predicted_minutes,
            correction_factor=prediction.correction_factor,
            history_scope=prediction.history_scope,
            history_count=prediction.history_count,
            exposed=exposed,
        )

    @staticmethod
    def _aware(value: datetime) -> datetime:
        return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


class SessionAdaptivePredictionRepository:
    """Adaptive prediction operations that share an existing transaction."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def history(self, account_id: UUID) -> list[HistoryRecord]:
        return await _load_history(self._session, account_id)

    async def evaluations(self, account_id: UUID) -> list[PredictionEvaluation]:
        rows = await self._session.execute(_evaluation_statement(account_id))
        evaluations: list[PredictionEvaluation] = []
        for prediction, completed_at, actual_duration in rows:
            actual_minutes = int(actual_duration)
            evaluations.append(
                PredictionEvaluation(
                    task_id=prediction.task_id,
                    original_minutes=prediction.original_minutes,
                    adaptive_minutes=prediction.predicted_minutes,
                    actual_minutes=(
                        actual_minutes if completed_at is not None and actual_minutes > 0 else None
                    ),
                    completed_at=(
                        SqlAlchemyAdaptivePredictionRepository._aware(completed_at)
                        if completed_at is not None
                        else None
                    ),
                )
            )
        return evaluations

    async def save_prediction(
        self,
        account_id: UUID,
        task_id: UUID,
        prediction: CorrectionPrediction,
        *,
        exposed: bool,
    ) -> bool:
        return await self._store_prediction(account_id, task_id, prediction, exposed, replace=False)

    async def replace_prediction(
        self,
        account_id: UUID,
        task_id: UUID,
        prediction: CorrectionPrediction,
        *,
        exposed: bool,
    ) -> bool:
        return await self._store_prediction(account_id, task_id, prediction, exposed, replace=True)

    async def remove_prediction(self, account_id: UUID, task_id: UUID) -> bool:
        account = await self._session.get(StudentAccount, account_id)
        if account is None:
            return False
        task = await self._session.scalar(
            select(AcademicTask)
            .where(AcademicTask.id == task_id, AcademicTask.account_id == account_id)
            .with_for_update()
        )
        if task is None or task.estimate_frozen_at is not None or task.completed_at is not None:
            return False
        existing = await self._session.get(PredictionRow, task_id, with_for_update=True)
        if existing is not None:
            if existing.account_id != account_id:
                return False
            await self._session.delete(existing)
        return True

    async def _store_prediction(
        self,
        account_id: UUID,
        task_id: UUID,
        prediction: CorrectionPrediction,
        exposed: bool,
        *,
        replace: bool,
    ) -> bool:
        account = await self._session.get(StudentAccount, account_id)
        if account is None:
            return False
        task = await self._session.scalar(
            select(AcademicTask)
            .where(AcademicTask.id == task_id, AcademicTask.account_id == account_id)
            .with_for_update()
        )
        if task is None or task.estimate_frozen_at is not None or task.completed_at is not None:
            return False
        existing = await self._session.get(PredictionRow, task_id, with_for_update=True)
        if existing is not None and (existing.account_id != account_id or not replace):
            return False
        if existing is not None:
            await self._session.delete(existing)
            await self._session.flush()
        self._session.add(
            SqlAlchemyAdaptivePredictionRepository._prediction_row(task, prediction, exposed)
        )
        return True

    async def acknowledgment(self, account_id: UUID, category: TaskCategory) -> Decimal | None:
        row = await self._session.get(AcknowledgmentRow, (account_id, category.value))
        return row.correction_factor if row is not None else None

    async def acknowledge(
        self,
        account_id: UUID,
        category: TaskCategory,
        correction_factor: Decimal,
        acknowledged_at: datetime,
    ) -> bool:
        account = await self._session.get(StudentAccount, account_id, with_for_update=True)
        if account is None:
            return False
        row = await self._session.get(
            AcknowledgmentRow,
            (account_id, category.value),
            with_for_update=True,
        )
        if row is None:
            self._session.add(
                AcknowledgmentRow(
                    account_id=account_id,
                    category=category.value,
                    correction_factor=correction_factor,
                    acknowledged_at=acknowledged_at,
                )
            )
        else:
            row.correction_factor = correction_factor
            row.acknowledged_at = acknowledged_at
        return True

    async def remove_acknowledgment(self, account_id: UUID, category: TaskCategory) -> bool:
        row = await self._session.get(
            AcknowledgmentRow,
            (account_id, category.value),
            with_for_update=True,
        )
        if row is None:
            return False
        await self._session.delete(row)
        return True

    async def clear_acknowledgments(self, account_id: UUID) -> None:
        await self._session.execute(
            delete(AcknowledgmentRow).where(AcknowledgmentRow.account_id == account_id)
        )
