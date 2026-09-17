"""SQLAlchemy persistence for Google imports."""

from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Any, cast
from uuid import UUID

from sqlalchemy import delete, or_, select

from studyflow.auth.repositories import SessionTransactions
from studyflow.availability.repositories import FutureSessionInvalidator
from studyflow.database.models import (
    AcademicTask,
    GoogleImportSnapshot,
    GoogleImportState,
    StudentAccount,
    UnavailablePeriod,
)
from studyflow.integrations.google_import import (
    CalendarImportItem,
    CalendarImportResult,
    ExistingCalendarPeriod,
    GoogleImportAccount,
    GoogleImportSource,
    PendingGoogleImport,
    StoredImportSnapshot,
    UnknownGoogleImportItemError,
)


class SqlAlchemyGoogleImportRepository:
    def __init__(
        self,
        database: SessionTransactions,
        invalidator: FutureSessionInvalidator,
    ) -> None:
        self._database = database
        self._invalidator = invalidator

    async def account(self, account_id: UUID) -> GoogleImportAccount | None:
        async with self._database.transaction() as session:
            account = await session.get(StudentAccount, account_id)
            if account is None:
                return None
            return GoogleImportAccount(account.email, account.timezone)

    async def store_state(
        self,
        account_id: UUID,
        state_hash: str,
        source: GoogleImportSource,
        code_verifier: str,
        horizon_days: int,
        now: datetime,
        expires_at: datetime,
    ) -> None:
        async with self._database.transaction() as session:
            await session.execute(
                delete(GoogleImportState).where(
                    or_(
                        GoogleImportState.expires_at <= now,
                        GoogleImportState.consumed_at.is_not(None),
                        GoogleImportState.account_id == account_id,
                    )
                )
            )
            session.add(
                GoogleImportState(
                    account_id=account_id,
                    state_hash=state_hash,
                    source=source.value,
                    code_verifier=code_verifier,
                    horizon_days=horizon_days,
                    created_at=now,
                    expires_at=expires_at,
                )
            )

    async def consume_state(self, state_hash: str, now: datetime) -> PendingGoogleImport | None:
        async with self._database.transaction() as session:
            row = await session.scalar(
                select(GoogleImportState)
                .where(
                    GoogleImportState.state_hash == state_hash,
                    GoogleImportState.consumed_at.is_(None),
                    GoogleImportState.expires_at > now,
                )
                .with_for_update()
            )
            if row is None:
                return None
            row.consumed_at = now
            return PendingGoogleImport(
                account_id=row.account_id,
                source=GoogleImportSource(row.source),
                code_verifier=row.code_verifier,
                horizon_days=row.horizon_days,
            )

    async def store_snapshot(
        self,
        account_id: UUID,
        source: GoogleImportSource,
        items: list[dict[str, object]],
        now: datetime,
        expires_at: datetime,
    ) -> UUID:
        async with self._database.transaction() as session:
            # Keep only the newest import per student and source, and nothing expired.
            await session.execute(
                delete(GoogleImportSnapshot).where(
                    or_(
                        GoogleImportSnapshot.expires_at <= now,
                        GoogleImportSnapshot.consumed_at.is_not(None),
                        (GoogleImportSnapshot.account_id == account_id)
                        & (GoogleImportSnapshot.source == source.value),
                    )
                )
            )
            row = GoogleImportSnapshot(
                account_id=account_id,
                source=source.value,
                items=items,
                created_at=now,
                expires_at=expires_at,
            )
            session.add(row)
            await session.flush()
            return row.id

    async def open_snapshot(
        self, account_id: UUID, snapshot_id: UUID, now: datetime
    ) -> StoredImportSnapshot | None:
        async with self._database.transaction() as session:
            row = await session.scalar(self._open_snapshot_query(account_id, snapshot_id, now))
            return self._to_snapshot(row) if row is not None else None

    async def claim_snapshot(
        self,
        account_id: UUID,
        snapshot_id: UUID,
        source: GoogleImportSource,
        now: datetime,
    ) -> StoredImportSnapshot | None:
        async with self._database.transaction() as session:
            row = await session.scalar(
                self._open_snapshot_query(account_id, snapshot_id, now)
                .where(GoogleImportSnapshot.source == source.value)
                .with_for_update()
            )
            if row is None:
                return None
            row.consumed_at = now
            return self._to_snapshot(row)

    async def discard_snapshot(self, account_id: UUID, snapshot_id: UUID, now: datetime) -> bool:
        async with self._database.transaction() as session:
            result = await session.execute(
                delete(GoogleImportSnapshot).where(
                    GoogleImportSnapshot.id == snapshot_id,
                    GoogleImportSnapshot.account_id == account_id,
                )
            )
            return bool(cast(Any, result).rowcount)

    async def calendar_periods(
        self, account_id: UUID, external_ids: Sequence[str]
    ) -> dict[str, ExistingCalendarPeriod]:
        if not external_ids:
            return {}
        async with self._database.transaction() as session:
            rows = await session.scalars(self._calendar_period_query(account_id, external_ids))
            return {
                cast(str, row.external_id): ExistingCalendarPeriod(
                    _aware(row.starts_at), _aware(row.ends_at), row.reason
                )
                for row in rows
            }

    async def classroom_task_ids(self, account_id: UUID, external_ids: Sequence[str]) -> set[str]:
        if not external_ids:
            return set()
        async with self._database.transaction() as session:
            rows = await session.scalars(
                select(AcademicTask.external_id).where(
                    AcademicTask.account_id == account_id,
                    AcademicTask.external_source == GoogleImportSource.CLASSROOM.value,
                    AcademicTask.external_id.in_(list(external_ids)),
                )
            )
            return {external_id for external_id in rows if external_id is not None}

    async def import_calendar(
        self,
        account_id: UUID,
        snapshot_id: UUID,
        item_ids: Sequence[str],
        now: datetime,
    ) -> CalendarImportResult | None:
        async with self._database.transaction() as session:
            account = await session.get(StudentAccount, account_id, with_for_update=True)
            if account is None:
                return None
            snapshot = await session.scalar(
                self._open_snapshot_query(account_id, snapshot_id, now)
                .where(GoogleImportSnapshot.source == GoogleImportSource.CALENDAR.value)
                .with_for_update()
            )
            if snapshot is None:
                return None
            items = {
                item.id: item
                for item in (CalendarImportItem.from_json(raw) for raw in snapshot.items)
            }
            if any(item_id not in items for item_id in item_ids):
                raise UnknownGoogleImportItemError("A selected item is not part of this import")
            existing = {
                cast(str, row.external_id): row
                for row in await session.scalars(
                    self._calendar_period_query(account_id, item_ids).with_for_update()
                )
            }

            created = updated = unchanged = skipped_past = 0
            invalidated: list[UUID] = []
            for item_id in item_ids:
                item = items[item_id]
                if item.ends_at <= now:
                    skipped_past += 1
                    continue
                row = existing.get(item_id)
                if row is None:
                    session.add(
                        UnavailablePeriod(
                            account_id=account_id,
                            starts_at=item.starts_at,
                            ends_at=item.ends_at,
                            reason=item.title,
                            external_source=GoogleImportSource.CALENDAR.value,
                            external_id=item.id,
                        )
                    )
                    created += 1
                elif (
                    _aware(row.starts_at) == item.starts_at
                    and _aware(row.ends_at) == item.ends_at
                    and row.reason == item.title
                ):
                    unchanged += 1
                    continue
                else:
                    row.starts_at = item.starts_at
                    row.ends_at = item.ends_at
                    row.reason = item.title
                    updated += 1
                await session.flush()
                invalidated.extend(
                    await self._invalidator.remove_conflicting_future_sessions(
                        session, account_id, item.starts_at, item.ends_at
                    )
                )
            snapshot.consumed_at = now
            return CalendarImportResult(
                created=created,
                updated=updated,
                unchanged=unchanged,
                skipped_past=skipped_past,
                invalidated_future_session_ids=list(dict.fromkeys(invalidated)),
            )

    @staticmethod
    def _open_snapshot_query(account_id: UUID, snapshot_id: UUID, now: datetime) -> Any:
        return select(GoogleImportSnapshot).where(
            GoogleImportSnapshot.id == snapshot_id,
            GoogleImportSnapshot.account_id == account_id,
            GoogleImportSnapshot.consumed_at.is_(None),
            GoogleImportSnapshot.expires_at > now,
        )

    @staticmethod
    def _calendar_period_query(account_id: UUID, external_ids: Sequence[str]) -> Any:
        return select(UnavailablePeriod).where(
            UnavailablePeriod.account_id == account_id,
            UnavailablePeriod.external_source == GoogleImportSource.CALENDAR.value,
            UnavailablePeriod.external_id.in_(list(external_ids)),
        )

    @staticmethod
    def _to_snapshot(row: GoogleImportSnapshot) -> StoredImportSnapshot:
        return StoredImportSnapshot(
            id=row.id,
            source=GoogleImportSource(row.source),
            items=[dict(item) for item in row.items],
            expires_at=_aware(row.expires_at),
        )


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)
