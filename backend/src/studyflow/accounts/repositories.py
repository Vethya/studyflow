"""SQLAlchemy account-settings repositories."""

import hmac
from datetime import datetime
from uuid import UUID

from sqlalchemy import select, update

from studyflow.accounts.preferences import StudyPreferences
from studyflow.accounts.profile import AccountProfile
from studyflow.auth.repositories import SessionTransactions
from studyflow.database.models import AuthenticationSession, StudentAccount


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


class SqlAlchemyStudyPreferencesRepository:
    def __init__(self, database: SessionTransactions) -> None:
        self._database = database

    async def get(self, account_id: UUID) -> StudyPreferences | None:
        async with self._database.transaction() as session:
            account = await session.get(StudentAccount, account_id)
            return self._to_preferences(account) if account is not None else None

    async def update(
        self,
        account_id: UUID,
        timezone: str,
        preferred_session_length_minutes: int,
        minimum_break_minutes: int,
    ) -> StudyPreferences | None:
        async with self._database.transaction() as session:
            account = await session.scalar(
                select(StudentAccount).where(StudentAccount.id == account_id).with_for_update()
            )
            if account is None:
                return None
            if account.timezone != timezone:
                account.availability_timezone_confirmed = False
            account.timezone = timezone
            account.preferred_session_length_minutes = preferred_session_length_minutes
            account.minimum_break_minutes = minimum_break_minutes
            await session.flush()
            return self._to_preferences(account)

    @staticmethod
    def _to_preferences(account: StudentAccount) -> StudyPreferences:
        return StudyPreferences(
            timezone=account.timezone,
            preferred_session_length_minutes=account.preferred_session_length_minutes,
            minimum_break_minutes=account.minimum_break_minutes,
            availability_confirmation_required=not account.availability_timezone_confirmed,
        )


class SqlAlchemyPasswordChangeRepository:
    def __init__(self, database: SessionTransactions) -> None:
        self._database = database

    async def get_password_hash(self, account_id: UUID) -> str | None:
        async with self._database.transaction() as session:
            return await session.scalar(
                select(StudentAccount.password_hash).where(StudentAccount.id == account_id)
            )

    async def replace_password(
        self,
        account_id: UUID,
        expected_password_hash: str,
        new_password_hash: str,
        now: datetime,
    ) -> bool:
        async with self._database.transaction() as session:
            account = await session.get(StudentAccount, account_id, with_for_update=True)
            if (
                account is None
                or account.password_hash is None
                or not hmac.compare_digest(account.password_hash, expected_password_hash)
            ):
                return False
            account.password_hash = new_password_hash
            await session.execute(
                update(AuthenticationSession)
                .where(
                    AuthenticationSession.account_id == account_id,
                    AuthenticationSession.revoked_at.is_(None),
                )
                .values(revoked_at=now)
            )
        return True
