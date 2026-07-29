"""SQLAlchemy authentication repositories."""

from contextlib import AbstractAsyncContextManager
from datetime import datetime
from typing import Protocol

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from studyflow.auth.registration import PendingAccount
from studyflow.database.models import AuthenticationEmailToken, StudentAccount


class SessionTransactions(Protocol):
    def transaction(self) -> AbstractAsyncContextManager[AsyncSession]: ...


class SqlAlchemyRegistrationRepository:
    def __init__(self, database: SessionTransactions) -> None:
        self._database = database

    async def create_unverified(self, pending: PendingAccount) -> bool:
        try:
            async with self._database.transaction() as session:
                account = StudentAccount(
                    email=pending.email,
                    name=pending.name,
                    password_hash=pending.password_hash,
                    timezone=pending.timezone,
                )
                session.add(account)
                await session.flush()
                session.add(
                    AuthenticationEmailToken(
                        account_id=account.id,
                        purpose="email_verification",
                        token_hash=pending.verification_token_hash,
                        expires_at=pending.verification_expires_at,
                    )
                )
            return True
        except IntegrityError:
            async with self._database.transaction() as session:
                existing_account = await session.scalar(
                    select(StudentAccount)
                    .where(StudentAccount.email == pending.email)
                    .with_for_update()
                )
                if existing_account is None:
                    raise
                if existing_account.email_verified_at is not None:
                    return False
                await session.execute(
                    delete(AuthenticationEmailToken).where(
                        AuthenticationEmailToken.account_id == existing_account.id,
                        AuthenticationEmailToken.purpose == "email_verification",
                        AuthenticationEmailToken.consumed_at.is_(None),
                    )
                )
                session.add(
                    AuthenticationEmailToken(
                        account_id=existing_account.id,
                        purpose="email_verification",
                        token_hash=pending.verification_token_hash,
                        expires_at=pending.verification_expires_at,
                    )
                )
            return True


class SqlAlchemyEmailVerificationRepository:
    def __init__(self, database: SessionTransactions) -> None:
        self._database = database

    async def consume(self, token_hash: str, now: datetime) -> bool:
        async with self._database.transaction() as session:
            account_id = await session.scalar(
                select(AuthenticationEmailToken.account_id).where(
                    AuthenticationEmailToken.purpose == "email_verification",
                    AuthenticationEmailToken.token_hash == token_hash,
                    AuthenticationEmailToken.consumed_at.is_(None),
                    AuthenticationEmailToken.expires_at > now,
                )
            )
            if account_id is None:
                return False
            account = await session.get(StudentAccount, account_id, with_for_update=True)
            if account is None or account.email_verified_at is not None:
                return False
            token = await session.scalar(
                select(AuthenticationEmailToken)
                .where(
                    AuthenticationEmailToken.account_id == account_id,
                    AuthenticationEmailToken.purpose == "email_verification",
                    AuthenticationEmailToken.token_hash == token_hash,
                    AuthenticationEmailToken.consumed_at.is_(None),
                    AuthenticationEmailToken.expires_at > now,
                )
                .with_for_update()
            )
            if token is None:
                return False
            token.consumed_at = now
            account.email_verified_at = now
        return True
