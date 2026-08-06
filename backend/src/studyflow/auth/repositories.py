"""SQLAlchemy authentication repositories."""

from contextlib import AbstractAsyncContextManager
from datetime import UTC, datetime
from typing import Protocol

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from studyflow.auth.login import LoginAccount
from studyflow.auth.registration import PendingAccount
from studyflow.auth.session_authentication import PersistedSessionPrincipal
from studyflow.auth.sessions import PendingSession
from studyflow.database.models import (
    AuthenticationEmailToken,
    AuthenticationSession,
    StudentAccount,
)


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
                existing_account.name = pending.name
                existing_account.password_hash = pending.password_hash
                existing_account.timezone = pending.timezone
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


class SqlAlchemySessionRepository:
    def __init__(self, database: SessionTransactions) -> None:
        self._database = database

    async def create(self, pending: PendingSession) -> None:
        async with self._database.transaction() as session:
            session.add(
                AuthenticationSession(
                    account_id=pending.account_id,
                    token_hash=pending.token_hash,
                    csrf_token_hash=pending.csrf_token_hash,
                    idle_expires_at=pending.idle_expires_at,
                    absolute_expires_at=pending.absolute_expires_at,
                )
            )


class SqlAlchemyLoginRepository:
    def __init__(self, database: SessionTransactions) -> None:
        self._database = database

    async def find_by_email(self, email: str) -> LoginAccount | None:
        async with self._database.transaction() as session:
            account = await session.scalar(
                select(StudentAccount).where(StudentAccount.email == email)
            )
        if account is None:
            return None
        return LoginAccount(
            id=account.id,
            email=account.email,
            name=account.name,
            password_hash=account.password_hash,
            email_verified=account.email_verified_at is not None,
        )


class SqlAlchemySessionAuthenticationRepository:
    def __init__(self, database: SessionTransactions) -> None:
        self._database = database

    async def authenticate(
        self, token_hash: str, now: datetime, refreshed_idle_expiry: datetime
    ) -> PersistedSessionPrincipal | None:
        async with self._database.transaction() as session:
            row = (
                await session.execute(
                    select(AuthenticationSession, StudentAccount)
                    .join(StudentAccount, StudentAccount.id == AuthenticationSession.account_id)
                    .where(
                        AuthenticationSession.token_hash == token_hash,
                        AuthenticationSession.revoked_at.is_(None),
                        AuthenticationSession.idle_expires_at > now,
                        AuthenticationSession.absolute_expires_at > now,
                    )
                    .with_for_update()
                )
            ).one_or_none()
            if row is None:
                return None
            authentication_session, account = row
            absolute_expiry = authentication_session.absolute_expires_at
            if absolute_expiry.tzinfo is None:
                absolute_expiry = absolute_expiry.replace(tzinfo=UTC)
            authentication_session.idle_expires_at = min(refreshed_idle_expiry, absolute_expiry)
            return PersistedSessionPrincipal(account.id, account.email, account.name)

    async def revoke(self, token_hash: str, csrf_hash: str, now: datetime) -> bool:
        async with self._database.transaction() as session:
            authentication_session = await session.scalar(
                select(AuthenticationSession)
                .where(
                    AuthenticationSession.token_hash == token_hash,
                    AuthenticationSession.csrf_token_hash == csrf_hash,
                    AuthenticationSession.revoked_at.is_(None),
                    AuthenticationSession.idle_expires_at > now,
                    AuthenticationSession.absolute_expires_at > now,
                )
                .with_for_update()
            )
            if authentication_session is None:
                return False
            authentication_session.revoked_at = now
        return True
