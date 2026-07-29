"""SQLAlchemy availability repositories."""

from uuid import UUID

from sqlalchemy import delete, select

from studyflow.auth.repositories import SessionTransactions
from studyflow.availability.windows import (
    AvailabilityWindow,
    AvailabilityWindowDraft,
)
from studyflow.database.models import AvailabilityWindow as AvailabilityWindowRow
from studyflow.database.models import StudentAccount


class SqlAlchemyAvailabilityWindowRepository:
    def __init__(self, database: SessionTransactions) -> None:
        self._database = database

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
            return [self._to_window(row) for row in rows]

    async def confirm_timezone(self, account_id: UUID) -> bool:
        async with self._database.transaction() as session:
            account = await session.get(StudentAccount, account_id, with_for_update=True)
            if account is None:
                return False
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
