"""SQLAlchemy persistence for immutable study-session outcomes."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select

from studyflow.auth.repositories import SessionTransactions
from studyflow.database.models import StudentAccount
from studyflow.database.models import StudySession as SessionRow
from studyflow.database.models import StudySessionOutcome as OutcomeRow
from studyflow.scheduling.outcomes import (
    DuplicateSessionOutcomeError,
    FutureSessionOutcomeError,
    ProposedSessionOutcomeError,
    SessionOutcomeKind,
    StudySessionDetails,
    StudySessionOutcomeRecord,
)
from studyflow.scheduling.proposals import StudySessionRecord


class SqlAlchemyStudySessionOutcomeRepository:
    def __init__(self, database: SessionTransactions) -> None:
        self._database = database

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
                StudySessionRecord(
                    row.id,
                    row.account_id,
                    row.task_id,
                    row.proposal_id,
                    self._aware(row.starts_at),
                    self._aware(row.ends_at),
                    row.planned_duration_minutes,
                ),
                self._outcome_record(outcome) if outcome is not None else None,
            )

    async def record_missed(
        self, account_id: UUID, session_id: UUID, now: datetime
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
            outcome = OutcomeRow(
                session_id=session_id,
                kind=SessionOutcomeKind.MISSED.value,
                actual_minutes=0,
                remaining_minutes=row.planned_duration_minutes,
                recorded_at=now_utc,
                rescheduled_at=None,
            )
            session.add(outcome)
            await session.flush()
            return self._outcome_record(outcome)

    @staticmethod
    def _aware(value: datetime) -> datetime:
        return value if value.tzinfo is not None else value.replace(tzinfo=UTC)

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
