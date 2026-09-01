"""SQLAlchemy persistence for immutable study-session outcomes."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from studyflow.auth.repositories import SessionTransactions
from studyflow.database.models import AcademicTask, StudentAccount
from studyflow.database.models import StudySession as SessionRow
from studyflow.database.models import StudySessionOutcome as OutcomeRow
from studyflow.scheduling.outcomes import (
    DuplicateSessionOutcomeError,
    FutureSessionOutcomeError,
    ProposedSessionOutcomeError,
    SessionOutcomeKind,
    StudySessionDetails,
    StudySessionFilters,
    StudySessionOutcomeRecord,
    normalize_outcome_minutes,
)
from studyflow.scheduling.proposals import StudySessionRecord


class SqlAlchemyStudySessionOutcomeRepository:
    def __init__(self, database: SessionTransactions) -> None:
        self._database = database

    async def list(
        self, account_id: UUID, filters: StudySessionFilters
    ) -> list[StudySessionDetails]:
        async with self._database.transaction() as session:
            statement = (
                select(SessionRow, OutcomeRow)
                .outerjoin(OutcomeRow, OutcomeRow.session_id == SessionRow.id)
                .where(
                    SessionRow.account_id == account_id,
                    SessionRow.proposal_id.is_(None),
                    SessionRow.invalidated_at.is_(None),
                )
            )
            if filters.starts_from is not None:
                statement = statement.where(SessionRow.ends_at > filters.starts_from)
            if filters.starts_to is not None:
                statement = statement.where(SessionRow.starts_at < filters.starts_to)
            if filters.task_id is not None:
                statement = statement.where(SessionRow.task_id == filters.task_id)
            rows = await session.execute(statement.order_by(SessionRow.starts_at, SessionRow.id))
            return [
                StudySessionDetails(
                    self._session_record(session_row),
                    self._outcome_record(outcome_row) if outcome_row is not None else None,
                )
                for session_row, outcome_row in rows
            ]

    async def get(self, account_id: UUID, session_id: UUID) -> StudySessionDetails | None:
        async with self._database.transaction() as session:
            row = await session.scalar(
                select(SessionRow).where(
                    SessionRow.id == session_id,
                    SessionRow.account_id == account_id,
                    SessionRow.proposal_id.is_(None),
                    SessionRow.invalidated_at.is_(None),
                )
            )
            if row is None:
                return None
            outcome = await session.get(OutcomeRow, session_id)
            return StudySessionDetails(
                self._session_record(row),
                self._outcome_record(outcome) if outcome is not None else None,
            )

    async def record(
        self,
        account_id: UUID,
        session_id: UUID,
        kind: SessionOutcomeKind,
        actual_minutes: int | None,
        remaining_minutes: int | None,
        large_actual_confirmed: bool,
        now: datetime,
    ) -> StudySessionOutcomeRecord | None:
        async with self._database.transaction() as session:
            account = await session.get(StudentAccount, account_id, with_for_update=True)
            if account is None:
                return None
            row = await session.scalar(
                select(SessionRow)
                .where(
                    SessionRow.id == session_id,
                    SessionRow.account_id == account_id,
                    SessionRow.invalidated_at.is_(None),
                )
                .with_for_update()
            )
            if row is None:
                return None
            if row.proposal_id is not None:
                raise ProposedSessionOutcomeError("Proposed sessions cannot have outcomes")
            now_utc = self._aware(now).astimezone(UTC)
            if self._aware(row.ends_at) > now_utc:
                raise FutureSessionOutcomeError("The study session has not ended")
            existing = await session.get(OutcomeRow, session_id)
            if existing is not None:
                raise DuplicateSessionOutcomeError("The study session already has an outcome")
            resolved_actual, resolved_remaining = normalize_outcome_minutes(
                kind,
                row.planned_duration_minutes,
                actual_minutes,
                remaining_minutes,
                large_actual_confirmed=large_actual_confirmed,
            )
            task = await session.scalar(
                select(AcademicTask)
                .where(
                    AcademicTask.id == row.task_id,
                    AcademicTask.account_id == account_id,
                )
                .with_for_update()
            )
            if task is None:
                return None
            outcome = OutcomeRow(
                session_id=session_id,
                kind=kind.value,
                actual_minutes=resolved_actual,
                remaining_minutes=resolved_remaining,
                recorded_at=now_utc,
                rescheduled_at=None,
            )
            session.add(outcome)
            await session.flush()
            if kind in (SessionOutcomeKind.COMPLETED, SessionOutcomeKind.DELAYED):
                task.estimate_frozen_at = task.estimate_frozen_at or self._aware(row.starts_at)
            if kind is SessionOutcomeKind.COMPLETED and not await self._has_unfinished_work(
                session, account_id, row.task_id
            ):
                task.completed_at = task.completed_at or now_utc
            return self._outcome_record(outcome)

    async def task_actual_minutes(self, account_id: UUID, task_id: UUID) -> int:
        async with self._database.transaction() as session:
            total = await session.scalar(
                select(func.coalesce(func.sum(OutcomeRow.actual_minutes), 0))
                .join(SessionRow, SessionRow.id == OutcomeRow.session_id)
                .where(
                    SessionRow.account_id == account_id,
                    SessionRow.task_id == task_id,
                    OutcomeRow.kind.in_(
                        [SessionOutcomeKind.COMPLETED.value, SessionOutcomeKind.DELAYED.value]
                    ),
                )
            )
            return int(total or 0)

    @staticmethod
    async def _has_unfinished_work(session: AsyncSession, account_id: UUID, task_id: UUID) -> bool:
        rows = await session.execute(
            select(SessionRow, OutcomeRow)
            .outerjoin(OutcomeRow, OutcomeRow.session_id == SessionRow.id)
            .where(
                SessionRow.account_id == account_id,
                SessionRow.task_id == task_id,
                SessionRow.proposal_id.is_(None),
            )
        )
        for session_row, outcome_row in rows:
            if session_row.invalidated_at is not None:
                if (
                    outcome_row is not None
                    and outcome_row.remaining_minutes > 0
                    and outcome_row.rescheduled_at is None
                ):
                    return True
                continue
            if outcome_row is None:
                return True
            if outcome_row.remaining_minutes > 0 and outcome_row.rescheduled_at is None:
                return True
        return False

    @staticmethod
    def _aware(value: datetime) -> datetime:
        return value if value.tzinfo is not None else value.replace(tzinfo=UTC)

    @classmethod
    def _session_record(cls, row: SessionRow) -> StudySessionRecord:
        return StudySessionRecord(
            row.id,
            row.account_id,
            row.task_id,
            row.proposal_id,
            cls._aware(row.starts_at),
            cls._aware(row.ends_at),
            row.planned_duration_minutes,
        )

    @classmethod
    def _outcome_record(cls, row: OutcomeRow) -> StudySessionOutcomeRecord:
        return StudySessionOutcomeRecord(
            row.session_id,
            SessionOutcomeKind(row.kind),
            row.actual_minutes,
            row.remaining_minutes,
            cls._aware(row.recorded_at),
            cls._aware(row.rescheduled_at) if row.rescheduled_at is not None else None,
        )
