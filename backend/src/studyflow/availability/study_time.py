"""Atomic updates for all persisted study-time settings."""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Protocol
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from studyflow.accounts.preferences import StudyPreferences
from studyflow.auth.repositories import SessionTransactions
from studyflow.availability.repositories import FutureSessionInvalidator
from studyflow.availability.unavailable import (
    PastUnavailablePeriodError,
    UnavailablePeriod,
    UnavailablePeriodDraft,
    normalize_draft,
)
from studyflow.availability.windows import (
    AvailabilityWindow,
    AvailabilityWindowDraft,
    merge_windows,
)
from studyflow.database.models import AvailabilityWindow as AvailabilityWindowRow
from studyflow.database.models import StudentAccount
from studyflow.database.models import UnavailablePeriod as UnavailablePeriodRow
from studyflow.timezones import is_iana_timezone


@dataclass(frozen=True, slots=True)
class StudyTimeBlockedPeriodUpdate:
    period_id: UUID
    draft: UnavailablePeriodDraft


@dataclass(frozen=True, slots=True)
class StudyTimeBlockedPeriodChanges:
    add: tuple[UnavailablePeriodDraft, ...] = ()
    update: tuple[StudyTimeBlockedPeriodUpdate, ...] = ()
    remove: tuple[UUID, ...] = ()


@dataclass(frozen=True, slots=True)
class StudyTimeChanges:
    confirm_timezone: bool = False
    planning_preferences: tuple[str, int, int] | None = None
    recurring_windows: tuple[AvailabilityWindowDraft, ...] | None = None
    blocked_periods: StudyTimeBlockedPeriodChanges | None = None


@dataclass(frozen=True, slots=True)
class StudyTimeUpdateResult:
    timezone_confirmed: bool
    planning_preferences: StudyPreferences | None
    recurring_windows: list[AvailabilityWindow] | None
    added_blocked_periods: list[UnavailablePeriod]
    updated_blocked_periods: list[UnavailablePeriod]
    removed_blocked_period_ids: list[UUID]
    invalidated_future_session_ids: list[UUID]


class StudyTimePeriodNotFoundError(ValueError):
    """Raised when a grouped update references a period outside the account."""


class StudyTimeUpdates(Protocol):
    async def apply(
        self, account_id: UUID, changes: StudyTimeChanges
    ) -> StudyTimeUpdateResult | None: ...


class StudyTimeUpdateService:
    def __init__(
        self,
        database: SessionTransactions,
        invalidator: FutureSessionInvalidator,
        *,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self._database = database
        self._invalidator = invalidator
        self._clock = clock

    async def apply(
        self, account_id: UUID, changes: StudyTimeChanges
    ) -> StudyTimeUpdateResult | None:
        changes = self._validated_changes(changes)
        async with self._database.transaction() as session:
            account = await session.scalar(
                select(StudentAccount).where(StudentAccount.id == account_id).with_for_update()
            )
            if account is None:
                return None

            period_rows = await self._period_rows(session, account_id, changes)
            preferences = self._apply_preferences(account, changes)
            recurring_windows = await self._apply_recurring_windows(
                session, account_id, changes.recurring_windows
            )

            added_periods: list[UnavailablePeriod] = []
            updated_periods: list[UnavailablePeriod] = []
            removed_period_ids: list[UUID] = []
            invalidated_ids: list[UUID] = []
            blocked_periods = changes.blocked_periods
            if blocked_periods is not None:
                for draft in blocked_periods.add:
                    row = UnavailablePeriodRow(
                        account_id=account_id,
                        starts_at=draft.starts_at,
                        ends_at=draft.ends_at,
                        reason=draft.reason,
                    )
                    session.add(row)
                    await session.flush()
                    await session.refresh(row)
                    invalidated_ids.extend(
                        await self._invalidator.remove_conflicting_future_sessions(
                            session, account_id, draft.starts_at, draft.ends_at
                        )
                    )
                    added_periods.append(self._to_period(row))

                for change in blocked_periods.update:
                    row = period_rows[change.period_id]
                    row.starts_at = change.draft.starts_at
                    row.ends_at = change.draft.ends_at
                    row.reason = change.draft.reason
                    await session.flush()
                    await session.refresh(row)
                    invalidated_ids.extend(
                        await self._invalidator.remove_conflicting_future_sessions(
                            session,
                            account_id,
                            change.draft.starts_at,
                            change.draft.ends_at,
                        )
                    )
                    updated_periods.append(self._to_period(row))

                for period_id in blocked_periods.remove:
                    await session.delete(period_rows[period_id])
                    removed_period_ids.append(period_id)

            return StudyTimeUpdateResult(
                timezone_confirmed=changes.confirm_timezone,
                planning_preferences=preferences,
                recurring_windows=recurring_windows,
                added_blocked_periods=added_periods,
                updated_blocked_periods=updated_periods,
                removed_blocked_period_ids=removed_period_ids,
                invalidated_future_session_ids=list(dict.fromkeys(invalidated_ids)),
            )

    def _validated_changes(self, changes: StudyTimeChanges) -> StudyTimeChanges:
        if not (
            changes.confirm_timezone
            or changes.planning_preferences is not None
            or changes.recurring_windows is not None
            or changes.blocked_periods is not None
        ):
            raise ValueError("Provide at least one study-time change")

        preferences = changes.planning_preferences
        if preferences is not None:
            timezone, session_length, minimum_break = preferences
            if not is_iana_timezone(timezone):
                raise ValueError("Timezone must be a valid IANA timezone")
            if not 10 <= session_length <= 240:
                raise ValueError("preferred_session_length_minutes must be between 10 and 240")
            if not 0 <= minimum_break <= 120:
                raise ValueError("minimum_break_minutes must be between 0 and 120")

        recurring_windows = changes.recurring_windows
        if recurring_windows is not None:
            recurring_windows = tuple(merge_windows(list(recurring_windows)))

        blocked_periods = changes.blocked_periods
        if blocked_periods is not None:
            if not (blocked_periods.add or blocked_periods.update or blocked_periods.remove):
                raise ValueError("blocked_periods must include at least one add, update, or remove")
            period_ids = [change.period_id for change in blocked_periods.update] + list(
                blocked_periods.remove
            )
            if len(period_ids) != len(set(period_ids)):
                raise ValueError("A blocked period can only be updated or removed once")
            blocked_periods = StudyTimeBlockedPeriodChanges(
                add=tuple(self._validated_draft(draft) for draft in blocked_periods.add),
                update=tuple(
                    StudyTimeBlockedPeriodUpdate(
                        change.period_id, self._validated_draft(change.draft)
                    )
                    for change in blocked_periods.update
                ),
                remove=blocked_periods.remove,
            )

        return StudyTimeChanges(
            confirm_timezone=changes.confirm_timezone,
            planning_preferences=preferences,
            recurring_windows=recurring_windows,
            blocked_periods=blocked_periods,
        )

    def _validated_draft(self, draft: UnavailablePeriodDraft) -> UnavailablePeriodDraft:
        normalized = normalize_draft(draft)
        if normalized.ends_at <= self._clock():
            raise PastUnavailablePeriodError("Unavailable period ends_at must be in the future")
        return normalized

    async def _period_rows(
        self,
        session: AsyncSession,
        account_id: UUID,
        changes: StudyTimeChanges,
    ) -> dict[UUID, UnavailablePeriodRow]:
        blocked_periods = changes.blocked_periods
        if blocked_periods is None:
            return {}
        ids = [change.period_id for change in blocked_periods.update] + list(blocked_periods.remove)
        if not ids:
            return {}
        rows = list(
            await session.scalars(
                select(UnavailablePeriodRow)
                .where(
                    UnavailablePeriodRow.account_id == account_id,
                    UnavailablePeriodRow.id.in_(ids),
                )
                .with_for_update()
            )
        )
        by_id = {row.id: row for row in rows}
        missing = next((period_id for period_id in ids if period_id not in by_id), None)
        if missing is not None:
            raise StudyTimePeriodNotFoundError(f"Unavailable period {missing} not found")
        return by_id

    @staticmethod
    def _apply_preferences(
        account: StudentAccount, changes: StudyTimeChanges
    ) -> StudyPreferences | None:
        if changes.planning_preferences is None:
            if changes.confirm_timezone:
                account.availability_timezone_confirmed = True
            return None

        timezone, session_length, minimum_break = changes.planning_preferences
        if account.timezone != timezone:
            account.availability_timezone_confirmed = False
        account.timezone = timezone
        account.preferred_session_length_minutes = session_length
        account.minimum_break_minutes = minimum_break
        if changes.confirm_timezone:
            account.availability_timezone_confirmed = True
        return StudyPreferences(
            timezone=account.timezone,
            preferred_session_length_minutes=account.preferred_session_length_minutes,
            minimum_break_minutes=account.minimum_break_minutes,
            availability_confirmation_required=not account.availability_timezone_confirmed,
        )

    @staticmethod
    async def _apply_recurring_windows(
        session: AsyncSession,
        account_id: UUID,
        windows: tuple[AvailabilityWindowDraft, ...] | None,
    ) -> list[AvailabilityWindow] | None:
        if windows is None:
            return None
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
        return [
            AvailabilityWindow(
                row.id,
                row.weekday,
                row.local_start_time,
                row.local_end_time,
                row.crosses_midnight,
            )
            for row in rows
        ]

    @staticmethod
    def _to_period(row: UnavailablePeriodRow) -> UnavailablePeriod:
        starts_at = (
            row.starts_at if row.starts_at.tzinfo is not None else row.starts_at.replace(tzinfo=UTC)
        )
        ends_at = row.ends_at if row.ends_at.tzinfo is not None else row.ends_at.replace(tzinfo=UTC)
        return UnavailablePeriod(row.id, starts_at, ends_at, row.reason)
