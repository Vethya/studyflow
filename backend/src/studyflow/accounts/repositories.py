"""SQLAlchemy account-settings repositories."""

from uuid import UUID

from sqlalchemy import select

from studyflow.accounts.profile import AccountProfile
from studyflow.auth.repositories import SessionTransactions
from studyflow.database.models import StudentAccount


class SqlAlchemyAccountProfileRepository:
    def __init__(self, database: SessionTransactions) -> None:
        self._database = database

    async def get(self, account_id: UUID) -> AccountProfile | None:
        async with self._database.transaction() as session:
            account = await session.get(StudentAccount, account_id)
            return self._to_profile(account) if account is not None else None

    async def update_name(self, account_id: UUID, name: str) -> AccountProfile | None:
        async with self._database.transaction() as session:
            account = await session.scalar(
                select(StudentAccount).where(StudentAccount.id == account_id).with_for_update()
            )
            if account is None:
                return None
            account.name = name
            await session.flush()
            return self._to_profile(account)

    @staticmethod
    def _to_profile(account: StudentAccount) -> AccountProfile:
        return AccountProfile(account.id, account.email, account.name)
