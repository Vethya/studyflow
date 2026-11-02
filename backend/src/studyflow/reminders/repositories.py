"""SQLAlchemy persistence for study reminder preferences and deliveries."""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import ColumnElement, Integer, Row, Select, and_, delete, func, literal, select
from sqlalchemy.exc import IntegrityError

from studyflow.auth.repositories import SessionTransactions
from studyflow.database.models import (
    AcademicTask,
    ReminderDelivery,
    ReminderPreference,
    StudentAccount,
    StudySession,
    StudySessionOutcome,
)
from studyflow.reminders.preferences import (
    ReminderPreferences,
    ReminderPreferencesState,
)
from studyflow.reminders.service import (
    AFTER_SESSION_LOOKBACK,
    AFTER_SESSION_MINIMUM_DELAY,
    ReminderCandidate,
    ReminderKind,
)


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def _starts_within_lead(dialect: str, now: datetime) -> ColumnElement[bool]:
    """Session starts inside this account's lead time. Applied before LIMIT."""

    lead_seconds = ReminderPreference.before_session_minutes * 60
    if dialect == "postgresql":
        elapsed = func.extract("epoch", StudySession.starts_at) - func.extract(
            "epoch", literal(now)
        )
    else:
        elapsed = func.cast(func.strftime("%s", StudySession.starts_at), Integer) - func.cast(
            func.strftime("%s", literal(now)), Integer
        )
    return elapsed <= lead_seconds


def _within_batch(
    before: list[ReminderCandidate],
    after: list[ReminderCandidate],
    limit: int,
) -> list[ReminderCandidate]:
    """Keep both kinds represented when the batch cannot hold every candidate."""

    chosen: list[ReminderCandidate] = []
    before_index = 0
    after_index = 0
    while len(chosen) < limit and (before_index < len(before) or after_index < len(after)):
        if before_index < len(before):
            chosen.append(before[before_index])
            before_index += 1
        if len(chosen) == limit:
            break
        if after_index < len(after):
            chosen.append(after[after_index])
            after_index += 1
    return chosen


class SqlAlchemyReminderPreferencesRepository:
    def __init__(self, database: SessionTransactions) -> None:
        self._database = database

    async def get(self, account_id: UUID) -> ReminderPreferencesState | None:
        async with self._database.transaction() as session:
            account = await session.get(StudentAccount, account_id)
            if account is None:
                return None
            row = await session.get(ReminderPreference, account_id)
            return self._state(account, row)

    async def update(
        self, account_id: UUID, preferences: ReminderPreferences
    ) -> ReminderPreferencesState | None:
        async with self._database.transaction() as session:
            account = await session.get(StudentAccount, account_id, with_for_update=True)
            if account is None:
                return None
            row = await session.get(ReminderPreference, account_id, with_for_update=True)
            if row is None:
                row = ReminderPreference(account_id=account_id)
                session.add(row)
            row.email_enabled = preferences.email_enabled
            row.before_session_minutes = preferences.before_session_minutes
            row.after_session = preferences.after_session
            await session.flush()
            return self._state(account, row)

    @staticmethod
    def _state(account: StudentAccount, row: ReminderPreference | None) -> ReminderPreferencesState:
        preferences = (
            ReminderPreferences(
                email_enabled=row.email_enabled,
                before_session_minutes=row.before_session_minutes,
                after_session=row.after_session,
            )
            if row is not None
            else ReminderPreferences()
        )
        return ReminderPreferencesState(
            preferences=preferences,
            email_verified=account.email_verified_at is not None,
        )


class SqlAlchemyReminderDispatchRepository:
    def __init__(self, database: SessionTransactions) -> None:
        self._database = database

    async def due_candidates(self, now: datetime, limit: int) -> list[ReminderCandidate]:
        now = _aware(now).astimezone(UTC)
        async with self._database.transaction() as session:
            connection = await session.connection()
            before_rows = await session.execute(
                self._candidate_query(ReminderKind.BEFORE)
                .where(
                    ReminderPreference.before_session_minutes > 0,
                    StudySession.starts_at > now,
                    _starts_within_lead(connection.dialect.name, now),
                )
                .order_by(StudySession.starts_at, StudySession.id)
                .limit(limit)
            )
            before = [self._candidate(ReminderKind.BEFORE, row) for row in before_rows]
            after_rows = await session.execute(
                self._candidate_query(ReminderKind.AFTER)
                .outerjoin(StudySessionOutcome, StudySessionOutcome.session_id == StudySession.id)
                .where(
                    ReminderPreference.after_session.is_(True),
                    StudySessionOutcome.session_id.is_(None),
                    StudySession.ends_at <= now - AFTER_SESSION_MINIMUM_DELAY,
                    StudySession.ends_at > now - AFTER_SESSION_LOOKBACK,
                )
                .order_by(StudySession.ends_at, StudySession.id)
                .limit(limit)
            )
            after = [self._candidate(ReminderKind.AFTER, row) for row in after_rows]
        return _within_batch(before, after, limit)

    async def claim(self, candidate: ReminderCandidate, sent_at: datetime) -> bool:
        try:
            async with self._database.transaction() as session:
                session.add(
                    ReminderDelivery(
                        account_id=candidate.account_id,
                        session_id=candidate.session_id,
                        kind=candidate.kind.value,
                        sent_at=_aware(sent_at).astimezone(UTC),
                    )
                )
        except IntegrityError:
            return False
        return True

    async def release(self, candidate: ReminderCandidate) -> None:
        async with self._database.transaction() as session:
            await session.execute(
                delete(ReminderDelivery).where(
                    ReminderDelivery.session_id == candidate.session_id,
                    ReminderDelivery.kind == candidate.kind.value,
                )
            )

    @staticmethod
    def _candidate_query(kind: ReminderKind) -> Select[Any]:
        return (
            select(
                StudySession.id.label("session_id"),
                StudySession.account_id,
                StudySession.starts_at,
                StudySession.ends_at,
                AcademicTask.title,
                StudentAccount.email,
                StudentAccount.name,
                StudentAccount.timezone,
                ReminderPreference.before_session_minutes,
            )
            .join(
                AcademicTask,
                and_(
                    AcademicTask.id == StudySession.task_id,
                    AcademicTask.account_id == StudySession.account_id,
                ),
            )
            .join(StudentAccount, StudentAccount.id == StudySession.account_id)
            .join(ReminderPreference, ReminderPreference.account_id == StudySession.account_id)
            .outerjoin(
                ReminderDelivery,
                and_(
                    ReminderDelivery.session_id == StudySession.id,
                    ReminderDelivery.kind == kind.value,
                ),
            )
            .where(
                ReminderPreference.email_enabled.is_(True),
                StudentAccount.email_verified_at.is_not(None),
                StudySession.proposal_id.is_(None),
                StudySession.invalidated_at.is_(None),
                AcademicTask.completed_at.is_(None),
                ReminderDelivery.id.is_(None),
            )
        )

    @staticmethod
    def _candidate(kind: ReminderKind, row: Row[Any]) -> ReminderCandidate:
        return ReminderCandidate(
            kind=kind,
            account_id=row.account_id,
            session_id=row.session_id,
            email=row.email,
            name=row.name,
            timezone=row.timezone,
            task_title=row.title,
            starts_at=_aware(row.starts_at),
            ends_at=_aware(row.ends_at),
        )
