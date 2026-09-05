"""SQLAlchemy availability repositories."""

from collections.abc import Callable, Sequence
from datetime import UTC, datetime
from typing import Protocol
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from studyflow.auth.repositories import SessionTransactions
from studyflow.availability.unavailable import (
    UnavailablePeriod,
    UnavailablePeriodChange,
    UnavailablePeriodDraft,
)
from studyflow.availability.windows import (
    AvailabilityWindow,
    AvailabilityWindowDraft,
)
from studyflow.database.models import AvailabilityWindow as AvailabilityWindowRow
from studyflow.database.models import StudentAccount
from studyflow.database.models import StudySession as SessionRow
from studyflow.database.models import StudySessionOutcome as OutcomeRow
from studyflow.database.models import UnavailablePeriod as UnavailablePeriodRow
from studyflow.scheduling.calendar import expand_calendar
from studyflow.scheduling.contracts import MinuteWindow

_UTC_EPOCH = datetime(1970, 1, 1, tzinfo=UTC)
_MICROSECONDS_PER_MINUTE = 60_000_000


class FutureSessionInvalidator(Protocol):
    async def remove_conflicting_future_sessions(
        self,
        session: AsyncSession,
        account_id: UUID,
        starts_at: datetime,
        ends_at: datetime,
    ) -> list[UUID]: ...


class AvailabilityCalendarInvalidator(Protocol):
    async def remove_sessions_outside_availability(
        self,
        session: AsyncSession,
        account_id: UUID,
        windows: Sequence[AvailabilityWindow],
    ) -> list[UUID]: ...


class StudyTimeSessionInvalidator(
    FutureSessionInvalidator, AvailabilityCalendarInvalidator, Protocol
):
    pass


class NoFutureSessions:
    """No-op invalidator for contexts that do not manage study-session persistence."""

    async def remove_conflicting_future_sessions(
        self,
        session: AsyncSession,
        account_id: UUID,
        starts_at: datetime,
        ends_at: datetime,
    ) -> list[UUID]:
        return []

    async def remove_sessions_outside_availability(
        self,
        session: AsyncSession,
        account_id: UUID,
        windows: Sequence[AvailabilityWindow],
    ) -> list[UUID]:
        return []


class SqlAlchemyFutureSessionInvalidator:
    def __init__(
        self,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self._clock = clock

    async def remove_conflicting_future_sessions(
        self,
        session: AsyncSession,
        account_id: UUID,
        starts_at: datetime,
        ends_at: datetime,
    ) -> list[UUID]:
        now = self._clock().astimezone(UTC)
        rows = list(
            await session.scalars(
                select(SessionRow)
                .where(
                    SessionRow.account_id == account_id,
                    SessionRow.proposal_id.is_(None),
                    SessionRow.invalidated_at.is_(None),
                    SessionRow.starts_at > now,
                    SessionRow.starts_at < ends_at,
                    SessionRow.ends_at > starts_at,
                )
                .order_by(SessionRow.starts_at, SessionRow.id)
                .with_for_update()
            )
        )
        return self._invalidate(rows, session, now)

    async def remove_sessions_outside_availability(
        self,
        session: AsyncSession,
        account_id: UUID,
        windows: Sequence[AvailabilityWindow],
    ) -> list[UUID]:
        now = self._clock().astimezone(UTC)
        account = await session.scalar(
            select(StudentAccount).where(StudentAccount.id == account_id).with_for_update()
        )
        if account is None:
            return []

        rows = list(
            await session.scalars(
                select(SessionRow)
                .where(
                    SessionRow.account_id == account_id,
                    SessionRow.proposal_id.is_(None),
                    SessionRow.invalidated_at.is_(None),
                    SessionRow.starts_at > now,
                )
                .order_by(SessionRow.starts_at, SessionRow.id)
                .with_for_update()
            )
        )
        if not rows:
            return []

        unavailable_periods = [
            self._to_period(row)
            for row in await session.scalars(
                select(UnavailablePeriodRow)
                .where(UnavailablePeriodRow.account_id == account_id)
                .order_by(UnavailablePeriodRow.starts_at, UnavailablePeriodRow.id)
            )
        ]
        starts_at = min(self._aware(row.starts_at) for row in rows)
        ends_at = max(self._aware(row.ends_at) for row in rows)
        calendar_windows = tuple(
            expand_calendar(
                windows,
                unavailable_periods,
                timezone_name=account.timezone,
                planning_start=starts_at,
                horizon_end=ends_at,
            ).windows
        )
        invalidated = [
            row for row in rows if not self._session_fits_calendar(row, calendar_windows)
        ]
        return self._invalidate(invalidated, session, now)

    @staticmethod
    def _invalidate(rows: Sequence[SessionRow], session: AsyncSession, now: datetime) -> list[UUID]:
        invalidated_ids = [row.id for row in rows]
        for row in rows:
            row.invalidated_at = now
            row.invalidation_reason = "availability"
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

    @classmethod
    def _session_fits_calendar(
        cls, row: SessionRow, calendar_windows: Sequence[MinuteWindow]
    ) -> bool:
        starts_at = cls._aware(row.starts_at)
        ends_at = cls._aware(row.ends_at)
        start_minute, _ = cls._minute_bounds(starts_at)
        _, end_minute = cls._minute_bounds(ends_at)
        return any(
            window.start <= start_minute and end_minute <= window.end for window in calendar_windows
        )

    @staticmethod
    def _minute_bounds(value: datetime) -> tuple[int, int]:
        delta = value - _UTC_EPOCH
        microseconds = (
            delta.days * 86_400 * 1_000_000 + delta.seconds * 1_000_000 + delta.microseconds
        )
        floor, remainder = divmod(microseconds, _MICROSECONDS_PER_MINUTE)
        return floor, floor + bool(remainder)

    @staticmethod
    def _aware(value: datetime) -> datetime:
        return value if value.tzinfo is not None else value.replace(tzinfo=UTC)

    @classmethod
    def _to_period(cls, row: UnavailablePeriodRow) -> UnavailablePeriod:
        return UnavailablePeriod(
            row.id,
            cls._aware(row.starts_at),
            cls._aware(row.ends_at),
            row.reason,
        )


class SqlAlchemyAvailabilityWindowRepository:
    def __init__(
        self,
        database: SessionTransactions,
        invalidator: AvailabilityCalendarInvalidator | None = None,
    ) -> None:
        self._database = database
        self._invalidator = invalidator or NoFutureSessions()

    async def list_windows(self, account_id: UUID) -> list[AvailabilityWindow]:
        async with self._database.transaction() as session:
            rows = await session.scalars(
                select(AvailabilityWindowRow)
                .where(AvailabilityWindowRow.account_id == account_id)
                .order_by(
                    AvailabilityWindowRow.weekday,
                    AvailabilityWindowRow.local_start_time,
                    AvailabilityWindowRow.id,
                )
            )
            return [self._to_window(row) for row in rows]

    async def replace(
        self, account_id: UUID, windows: list[AvailabilityWindowDraft]
    ) -> list[AvailabilityWindow]:
        async with self._database.transaction() as session:
            account = await session.get(StudentAccount, account_id, with_for_update=True)
            if account is None:
                return []
            await session.execute(
                delete(AvailabilityWindowRow).where(AvailabilityWindowRow.account_id == account_id)
            )
            rows = [
                AvailabilityWindowRow(
                    account_id=account_id,
                    weekday=window.weekday,
                    local_start_time=window.start_time,
                    local_end_time=window.end_time,
                    crosses_midnight=window.end_time <= window.start_time,
                )
                for window in windows
            ]
            session.add_all(rows)
            await session.flush()
            stored = [self._to_window(row) for row in rows]
            await self._invalidator.remove_sessions_outside_availability(
                session, account_id, stored
            )
            return stored

    async def confirm_timezone(self, account_id: UUID) -> bool:
        async with self._database.transaction() as session:
            account = await session.get(StudentAccount, account_id, with_for_update=True)
            if account is None:
                return False
            windows = [
                self._to_window(row)
                for row in await session.scalars(
                    select(AvailabilityWindowRow)
                    .where(AvailabilityWindowRow.account_id == account_id)
                    .order_by(
                        AvailabilityWindowRow.weekday,
                        AvailabilityWindowRow.local_start_time,
                        AvailabilityWindowRow.id,
                    )
                )
            ]
            await self._invalidator.remove_sessions_outside_availability(
                session, account_id, windows
            )
            account.availability_timezone_confirmed = True
        return True

    @staticmethod
    def _to_window(row: AvailabilityWindowRow) -> AvailabilityWindow:
        return AvailabilityWindow(
            row.id,
            row.weekday,
            row.local_start_time,
            row.local_end_time,
            row.crosses_midnight,
        )


class SqlAlchemyUnavailablePeriodRepository:
    def __init__(
        self,
        database: SessionTransactions,
        invalidator: FutureSessionInvalidator,
    ) -> None:
        self._database = database
        self._invalidator = invalidator

    async def list_periods(self, account_id: UUID) -> list[UnavailablePeriod]:
        async with self._database.transaction() as session:
            rows = await session.scalars(
                select(UnavailablePeriodRow)
                .where(UnavailablePeriodRow.account_id == account_id)
                .order_by(UnavailablePeriodRow.starts_at, UnavailablePeriodRow.id)
            )
            return [self._to_period(row) for row in rows]

    async def create(
        self, account_id: UUID, draft: UnavailablePeriodDraft
    ) -> UnavailablePeriodChange:
        async with self._database.transaction() as session:
            row = UnavailablePeriodRow(
                account_id=account_id,
                starts_at=draft.starts_at,
                ends_at=draft.ends_at,
                reason=draft.reason,
            )
            session.add(row)
            await session.flush()
            await session.refresh(row)
            invalidated = await self._invalidator.remove_conflicting_future_sessions(
                session, account_id, draft.starts_at, draft.ends_at
            )
            return UnavailablePeriodChange(self._to_period(row), invalidated)

    async def update(
        self, account_id: UUID, period_id: UUID, draft: UnavailablePeriodDraft
    ) -> UnavailablePeriodChange | None:
        async with self._database.transaction() as session:
            row = await session.scalar(
                select(UnavailablePeriodRow)
                .where(
                    UnavailablePeriodRow.id == period_id,
                    UnavailablePeriodRow.account_id == account_id,
                )
                .with_for_update()
            )
            if row is None:
                return None
            row.starts_at = draft.starts_at
            row.ends_at = draft.ends_at
            row.reason = draft.reason
            await session.flush()
            await session.refresh(row)
            invalidated = await self._invalidator.remove_conflicting_future_sessions(
                session, account_id, draft.starts_at, draft.ends_at
            )
            return UnavailablePeriodChange(self._to_period(row), invalidated)

    async def delete(self, account_id: UUID, period_id: UUID) -> bool:
        async with self._database.transaction() as session:
            row = await session.scalar(
                select(UnavailablePeriodRow)
                .where(
                    UnavailablePeriodRow.id == period_id,
                    UnavailablePeriodRow.account_id == account_id,
                )
                .with_for_update()
            )
            if row is None:
                return False
            await session.delete(row)
        return True

    @staticmethod
    def _aware(value: datetime) -> datetime:
        return value if value.tzinfo is not None else value.replace(tzinfo=UTC)

    @classmethod
    def _to_period(cls, row: UnavailablePeriodRow) -> UnavailablePeriod:
        return UnavailablePeriod(
            row.id,
            cls._aware(row.starts_at),
            cls._aware(row.ends_at),
            row.reason,
        )
