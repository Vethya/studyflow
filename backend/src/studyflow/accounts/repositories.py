"""SQLAlchemy account-settings repositories."""

import hmac
from datetime import datetime
from uuid import UUID

from sqlalchemy import delete, select, update

from studyflow.accounts.preferences import StudyPreferences
from studyflow.accounts.profile import AccountProfile
from studyflow.auth.repositories import SessionTransactions
from studyflow.database.models import (
    AuthenticationAccountDeletionChallenge,
    AuthenticationEmailToken,
    AuthenticationSession,
    StudentAccount,
)


class SqlAlchemyAccountDeletionRepository:
    def __init__(self, database: SessionTransactions) -> None:
        self._database = database

    async def create_challenge(
        self, account_id: UUID, token_hash: str, expires_at: datetime
    ) -> bool:
        async with self._database.transaction() as session:
            account = await session.get(StudentAccount, account_id, with_for_update=True)
            if account is None:
                return False
            await session.execute(
                delete(AuthenticationAccountDeletionChallenge).where(
                    AuthenticationAccountDeletionChallenge.account_id == account_id,
                    AuthenticationAccountDeletionChallenge.consumed_at.is_(None),
                )
            )
            session.add(
                AuthenticationAccountDeletionChallenge(
                    account_id=account_id,
                    token_hash=token_hash,
                    expires_at=expires_at,
                )
            )
        return True

    async def has_active_challenge(self, account_id: UUID, token_hash: str, now: datetime) -> bool:
        async with self._database.transaction() as session:
            challenge = await session.scalar(
                select(AuthenticationAccountDeletionChallenge.id).where(
                    AuthenticationAccountDeletionChallenge.account_id == account_id,
                    AuthenticationAccountDeletionChallenge.token_hash == token_hash,
                    AuthenticationAccountDeletionChallenge.consumed_at.is_(None),
                    AuthenticationAccountDeletionChallenge.expires_at > now,
                )
            )
            return challenge is not None

    async def delete_account(self, account_id: UUID, token_hash: str, now: datetime) -> bool:
        async with self._database.transaction() as session:
            challenge = await session.scalar(
                select(AuthenticationAccountDeletionChallenge)
                .where(
                    AuthenticationAccountDeletionChallenge.account_id == account_id,
                    AuthenticationAccountDeletionChallenge.token_hash == token_hash,
                    AuthenticationAccountDeletionChallenge.consumed_at.is_(None),
                    AuthenticationAccountDeletionChallenge.expires_at > now,
                )
                .with_for_update()
            )
            if challenge is None:
                return False
            deleted_id = await session.scalar(
                delete(StudentAccount)
                .where(StudentAccount.id == account_id)
                .returning(StudentAccount.id)
            )
            return deleted_id is not None


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
        return AccountProfile(
            account.id,
            account.email,
            account.name,
            password_set=account.password_hash is not None,
        )


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
        expected_password_hash: str | None,
        new_password_hash: str,
        now: datetime,
    ) -> bool:
        async with self._database.transaction() as session:
            account = await session.get(StudentAccount, account_id, with_for_update=True)
            if account is None:
                return False
            if expected_password_hash is None:
                if account.password_hash is not None:
                    return False
            elif account.password_hash is None or not hmac.compare_digest(
                account.password_hash, expected_password_hash
            ):
                return False
            account.password_hash = new_password_hash
            await session.execute(
                update(AuthenticationEmailToken)
                .where(
                    AuthenticationEmailToken.account_id == account_id,
                    AuthenticationEmailToken.purpose == "password_reset",
                    AuthenticationEmailToken.consumed_at.is_(None),
                )
                .values(consumed_at=now)
            )
            await session.execute(
                update(AuthenticationSession)
                .where(
                    AuthenticationSession.account_id == account_id,
                    AuthenticationSession.revoked_at.is_(None),
                )
                .values(revoked_at=now)
            )
        return True
