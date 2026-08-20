"""SQLAlchemy authentication repositories."""

import hmac
from contextlib import AbstractAsyncContextManager
from datetime import UTC, datetime, timedelta
from typing import Protocol
from uuid import UUID

from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from studyflow.auth.login import LoginAccount
from studyflow.auth.oidc import (
    GoogleClaims,
    LinkedIdentity,
    OIDCAccount,
    OIDCLinkChallenge,
    OIDCStateRecord,
)
from studyflow.auth.registration import PendingRegistration, RegistrationCompletion
from studyflow.auth.session_authentication import PersistedSessionPrincipal
from studyflow.auth.sessions import PendingSession
from studyflow.database.models import (
    AuthenticationEmailToken,
    AuthenticationIdentity,
    AuthenticationOIDCLinkChallenge,
    AuthenticationOIDCState,
    AuthenticationRegistration,
    AuthenticationSession,
    StudentAccount,
)


class SessionTransactions(Protocol):
    def transaction(self) -> AbstractAsyncContextManager[AsyncSession]: ...


class SqlAlchemyRegistrationRepository:
    def __init__(self, database: SessionTransactions) -> None:
        self._database = database

    async def begin(self, pending: PendingRegistration) -> bool:
        try:
            async with self._database.transaction() as session:
                existing_account = await session.scalar(
                    select(StudentAccount)
                    .where(StudentAccount.email == pending.email)
                    .with_for_update()
                )
                if existing_account is not None and existing_account.email_verified_at is not None:
                    return False
                registration = await session.scalar(
                    select(AuthenticationRegistration)
                    .where(AuthenticationRegistration.email == pending.email)
                    .with_for_update()
                )
                existing_account = await session.scalar(
                    select(StudentAccount)
                    .where(StudentAccount.email == pending.email)
                    .with_for_update()
                )
                if existing_account is not None and existing_account.email_verified_at is not None:
                    return False
                if registration is None:
                    session.add(
                        AuthenticationRegistration(
                            email=pending.email,
                            verification_token_hash=pending.verification_token_hash,
                            verification_expires_at=pending.verification_expires_at,
                        )
                    )
                elif not self._rotate_pending(registration, pending):
                    return False
        except IntegrityError:
            async with self._database.transaction() as session:
                existing_account = await session.scalar(
                    select(StudentAccount)
                    .where(StudentAccount.email == pending.email)
                    .with_for_update()
                )
                if existing_account is not None and existing_account.email_verified_at is not None:
                    return False
                registration = await session.scalar(
                    select(AuthenticationRegistration)
                    .where(AuthenticationRegistration.email == pending.email)
                    .with_for_update()
                )
                existing_account = await session.scalar(
                    select(StudentAccount)
                    .where(StudentAccount.email == pending.email)
                    .with_for_update()
                )
                if existing_account is not None and existing_account.email_verified_at is not None:
                    return False
                if registration is None:
                    raise
                if not self._rotate_pending(registration, pending):
                    return False
        return True

    @staticmethod
    def _rotate_pending(
        registration: AuthenticationRegistration,
        pending: PendingRegistration,
    ) -> bool:
        signup_expires_at = registration.signup_expires_at
        if signup_expires_at is not None and signup_expires_at.tzinfo is None:
            signup_expires_at = signup_expires_at.replace(tzinfo=UTC)
        if (
            registration.verified_at is not None
            and signup_expires_at is not None
            and signup_expires_at > pending.requested_at
        ):
            return False
        registration.verification_token_hash = pending.verification_token_hash
        registration.verification_expires_at = pending.verification_expires_at
        registration.signup_token_hash = None
        registration.signup_expires_at = None
        registration.verified_at = None
        return True

    async def signup_is_valid(self, signup_token_hash: str, now: datetime) -> bool:
        async with self._database.transaction() as session:
            registration_id = await session.scalar(
                select(AuthenticationRegistration.id).where(
                    AuthenticationRegistration.signup_token_hash == signup_token_hash,
                    AuthenticationRegistration.signup_expires_at > now,
                    AuthenticationRegistration.verified_at.is_not(None),
                )
            )
        return registration_id is not None

    async def complete(self, completion: RegistrationCompletion, now: datetime) -> bool:
        async with self._database.transaction() as session:
            candidate = (
                await session.execute(
                    select(AuthenticationRegistration.id, AuthenticationRegistration.email).where(
                        AuthenticationRegistration.signup_token_hash
                        == completion.signup_token_hash,
                        AuthenticationRegistration.signup_expires_at > now,
                        AuthenticationRegistration.verified_at.is_not(None),
                    )
                )
            ).one_or_none()
            if candidate is None:
                return False
            registration_id, email = candidate
            account = await session.scalar(
                select(StudentAccount).where(StudentAccount.email == email).with_for_update()
            )
            registration = await session.scalar(
                select(AuthenticationRegistration)
                .where(
                    AuthenticationRegistration.id == registration_id,
                    AuthenticationRegistration.signup_token_hash == completion.signup_token_hash,
                    AuthenticationRegistration.signup_expires_at > now,
                    AuthenticationRegistration.verified_at.is_not(None),
                )
                .with_for_update()
            )
            if registration is None:
                return False
            account = await session.scalar(
                select(StudentAccount)
                .where(StudentAccount.email == registration.email)
                .with_for_update()
            )
            if account is not None and account.email_verified_at is not None:
                await session.delete(registration)
                return False
            if account is None:
                try:
                    async with session.begin_nested():
                        session.add(
                            StudentAccount(
                                email=registration.email,
                                name=completion.name,
                                password_hash=completion.password_hash,
                                timezone=completion.timezone,
                                email_verified_at=now,
                            )
                        )
                        await session.flush()
                except IntegrityError:
                    account = await session.scalar(
                        select(StudentAccount)
                        .where(StudentAccount.email == registration.email)
                        .with_for_update()
                    )
                    if account is None:
                        raise
                    if account.email_verified_at is not None:
                        await session.delete(registration)
                        return False
            if account is not None:
                account.name = completion.name
                account.password_hash = completion.password_hash
                account.timezone = completion.timezone
                account.email_verified_at = now
            await session.delete(registration)
        return True


class SqlAlchemyEmailVerificationRepository:
    def __init__(self, database: SessionTransactions) -> None:
        self._database = database

    async def grant_signup(
        self,
        token_hash: str,
        signup_token_hash: str,
        now: datetime,
        signup_expires_at: datetime,
    ) -> bool:
        async with self._database.transaction() as session:
            registration = await session.scalar(
                select(AuthenticationRegistration)
                .where(
                    AuthenticationRegistration.verification_token_hash == token_hash,
                    AuthenticationRegistration.verification_expires_at > now,
                    AuthenticationRegistration.verified_at.is_(None),
                )
                .with_for_update()
            )
            if registration is None:
                return False
            registration.verified_at = now
            registration.signup_token_hash = signup_token_hash
            registration.signup_expires_at = signup_expires_at
        return True


class SqlAlchemySessionRepository:
    def __init__(self, database: SessionTransactions) -> None:
        self._database = database

    async def create(
        self,
        pending: PendingSession,
        expected_password_hash: str | None = None,
        *,
        now: datetime,
    ) -> bool:
        async with self._database.transaction() as session:
            account = await session.get(StudentAccount, pending.account_id, with_for_update=True)
            if account is None:
                return False
            if expected_password_hash is not None and (
                account.password_hash is None
                or not hmac.compare_digest(account.password_hash, expected_password_hash)
            ):
                return False
            await session.execute(
                delete(AuthenticationSession).where(
                    (AuthenticationSession.idle_expires_at <= now)
                    | (AuthenticationSession.absolute_expires_at <= now)
                )
            )
            session.add(
                AuthenticationSession(
                    account_id=pending.account_id,
                    token_hash=pending.token_hash,
                    csrf_token_hash=pending.csrf_token_hash,
                    idle_expires_at=pending.idle_expires_at,
                    absolute_expires_at=pending.absolute_expires_at,
                )
            )
        return True


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
        self,
        token_hash: str,
        now: datetime,
        refreshed_idle_expiry: datetime,
        csrf_hash: str | None = None,
    ) -> PersistedSessionPrincipal | None:
        async with self._database.transaction() as session:
            conditions = [
                AuthenticationSession.token_hash == token_hash,
                AuthenticationSession.revoked_at.is_(None),
                AuthenticationSession.idle_expires_at > now,
                AuthenticationSession.absolute_expires_at > now,
            ]
            if csrf_hash is not None:
                conditions.append(AuthenticationSession.csrf_token_hash == csrf_hash)
            row = (
                await session.execute(
                    select(AuthenticationSession, StudentAccount)
                    .join(StudentAccount, StudentAccount.id == AuthenticationSession.account_id)
                    .where(*conditions)
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


class SqlAlchemyVerificationResendRepository:
    def __init__(self, database: SessionTransactions) -> None:
        self._database = database

    async def rotate(self, email: str, token_hash: str, expires_at: datetime) -> bool:
        async with self._database.transaction() as session:
            registration = await session.scalar(
                select(AuthenticationRegistration)
                .where(AuthenticationRegistration.email == email)
                .with_for_update()
            )
            if registration is None or registration.verified_at is not None:
                return False
            registration.verification_token_hash = token_hash
            registration.verification_expires_at = expires_at
        return True


class SqlAlchemyPasswordRecoveryRepository:
    def __init__(self, database: SessionTransactions) -> None:
        self._database = database

    async def create_reset_token(self, email: str, token_hash: str, expires_at: datetime) -> bool:
        async with self._database.transaction() as session:
            account = await session.scalar(
                select(StudentAccount).where(StudentAccount.email == email).with_for_update()
            )
            if (
                account is None
                or account.email_verified_at is None
                or account.password_hash is None
            ):
                return False
            await session.execute(
                delete(AuthenticationEmailToken).where(
                    AuthenticationEmailToken.account_id == account.id,
                    AuthenticationEmailToken.purpose == "password_reset",
                    AuthenticationEmailToken.consumed_at.is_(None),
                )
            )
            session.add(
                AuthenticationEmailToken(
                    account_id=account.id,
                    purpose="password_reset",
                    token_hash=token_hash,
                    expires_at=expires_at,
                )
            )
        return True

    async def reset_password(self, token_hash: str, password_hash: str, now: datetime) -> bool:
        async with self._database.transaction() as session:
            account_id = await session.scalar(
                select(AuthenticationEmailToken.account_id).where(
                    AuthenticationEmailToken.purpose == "password_reset",
                    AuthenticationEmailToken.token_hash == token_hash,
                    AuthenticationEmailToken.consumed_at.is_(None),
                    AuthenticationEmailToken.expires_at > now,
                )
            )
            if account_id is None:
                return False
            account = await session.get(StudentAccount, account_id, with_for_update=True)
            if account is None:
                return False
            token = await session.scalar(
                select(AuthenticationEmailToken)
                .where(
                    AuthenticationEmailToken.account_id == account_id,
                    AuthenticationEmailToken.purpose == "password_reset",
                    AuthenticationEmailToken.token_hash == token_hash,
                    AuthenticationEmailToken.consumed_at.is_(None),
                    AuthenticationEmailToken.expires_at > now,
                )
                .with_for_update()
            )
            if token is None:
                return False
            account.password_hash = password_hash
            token.consumed_at = now
            await session.execute(
                update(AuthenticationSession)
                .where(
                    AuthenticationSession.account_id == account_id,
                    AuthenticationSession.revoked_at.is_(None),
                )
                .values(revoked_at=now)
            )
        return True


class SqlAlchemyOIDCRepository:
    def __init__(self, database: SessionTransactions) -> None:
        self._database = database

    async def store_state(
        self, state_hash: str, nonce_hash: str, timezone: str, expires_at: datetime
    ) -> None:
        async with self._database.transaction() as session:
            await session.execute(
                delete(AuthenticationOIDCState).where(
                    AuthenticationOIDCState.expires_at <= expires_at - timedelta(minutes=10)
                )
            )
            session.add(
                AuthenticationOIDCState(
                    state_hash=state_hash,
                    nonce_hash=nonce_hash,
                    timezone=timezone,
                    expires_at=expires_at,
                )
            )

    async def consume_state(self, state_hash: str, now: datetime) -> OIDCStateRecord | None:
        async with self._database.transaction() as session:
            row = await session.scalar(
                select(AuthenticationOIDCState)
                .where(
                    AuthenticationOIDCState.state_hash == state_hash,
                    AuthenticationOIDCState.consumed_at.is_(None),
                    AuthenticationOIDCState.expires_at > now,
                )
                .with_for_update()
            )
            if row is None:
                return None
            row.consumed_at = now
            return OIDCStateRecord(row.nonce_hash, row.timezone)

    async def resolve_identity(self, claims: GoogleClaims, timezone: str) -> OIDCAccount | None:
        try:
            async with self._database.transaction() as session:
                identity = await session.scalar(
                    select(AuthenticationIdentity).where(
                        AuthenticationIdentity.provider == "google",
                        AuthenticationIdentity.subject == claims.subject,
                    )
                )
                if identity is not None:
                    account = await session.get(StudentAccount, identity.account_id)
                    return self._to_account(account) if account is not None else None
                account = await session.scalar(
                    select(StudentAccount)
                    .where(StudentAccount.email == claims.email)
                    .with_for_update()
                )
                if account is not None:
                    return None
                account = StudentAccount(
                    email=claims.email,
                    name=claims.name,
                    password_hash=None,
                    email_verified_at=datetime.now(UTC),
                    timezone=timezone,
                )
                session.add(account)
                await session.flush()
                session.add(
                    AuthenticationIdentity(
                        account_id=account.id,
                        provider="google",
                        subject=claims.subject,
                        email=claims.email,
                    )
                )
                await session.flush()
                return self._to_account(account)
        except IntegrityError:
            async with self._database.transaction() as session:
                identity = await session.scalar(
                    select(AuthenticationIdentity).where(
                        AuthenticationIdentity.provider == "google",
                        AuthenticationIdentity.subject == claims.subject,
                    )
                )
                if identity is None:
                    return None
                account = await session.get(StudentAccount, identity.account_id)
                return self._to_account(account) if account is not None else None

    async def create_link_challenge(
        self, claims: GoogleClaims, token_hash: str, expires_at: datetime
    ) -> bool:
        async with self._database.transaction() as session:
            account = await session.scalar(
                select(StudentAccount).where(StudentAccount.email == claims.email).with_for_update()
            )
            if account is None or account.password_hash is None:
                return False
            await session.execute(
                delete(AuthenticationOIDCLinkChallenge).where(
                    AuthenticationOIDCLinkChallenge.account_id == account.id,
                    AuthenticationOIDCLinkChallenge.consumed_at.is_(None),
                )
            )
            session.add(
                AuthenticationOIDCLinkChallenge(
                    account_id=account.id,
                    subject=claims.subject,
                    email=claims.email,
                    token_hash=token_hash,
                    expires_at=expires_at,
                )
            )
        return True

    async def get_link_challenge(self, token_hash: str, now: datetime) -> OIDCLinkChallenge | None:
        async with self._database.transaction() as session:
            row = await session.scalar(
                select(AuthenticationOIDCLinkChallenge).where(
                    AuthenticationOIDCLinkChallenge.token_hash == token_hash,
                    AuthenticationOIDCLinkChallenge.consumed_at.is_(None),
                    AuthenticationOIDCLinkChallenge.expires_at > now,
                )
            )
            if row is None:
                return None
            account = await session.get(StudentAccount, row.account_id)
            if account is None or account.password_hash is None:
                return None
            return OIDCLinkChallenge(
                row.id,
                row.account_id,
                row.subject,
                row.email,
                account.password_hash,
            )

    async def link_identity_and_create_session(
        self,
        challenge_id: UUID,
        expected_password_hash: str,
        pending_session: PendingSession,
        now: datetime,
    ) -> OIDCAccount | None:
        try:
            async with self._database.transaction() as session:
                row = await session.scalar(
                    select(AuthenticationOIDCLinkChallenge)
                    .where(
                        AuthenticationOIDCLinkChallenge.id == challenge_id,
                        AuthenticationOIDCLinkChallenge.consumed_at.is_(None),
                        AuthenticationOIDCLinkChallenge.expires_at > now,
                    )
                    .with_for_update()
                )
                if row is None:
                    return None
                account = await session.get(StudentAccount, row.account_id, with_for_update=True)
                if (
                    account is None
                    or pending_session.account_id != row.account_id
                    or not hmac.compare_digest(account.password_hash or "", expected_password_hash)
                ):
                    return None
                existing = await session.scalar(
                    select(AuthenticationIdentity).where(
                        (AuthenticationIdentity.provider == "google")
                        & (
                            (AuthenticationIdentity.subject == row.subject)
                            | (AuthenticationIdentity.account_id == account.id)
                        )
                    )
                )
                if existing is not None:
                    return None
                await session.execute(
                    delete(AuthenticationSession).where(
                        (AuthenticationSession.idle_expires_at <= now)
                        | (AuthenticationSession.absolute_expires_at <= now)
                    )
                )
                session.add(
                    AuthenticationIdentity(
                        account_id=account.id,
                        provider="google",
                        subject=row.subject,
                        email=row.email,
                    )
                )
                session.add(
                    AuthenticationSession(
                        account_id=account.id,
                        token_hash=pending_session.token_hash,
                        csrf_token_hash=pending_session.csrf_token_hash,
                        idle_expires_at=pending_session.idle_expires_at,
                        absolute_expires_at=pending_session.absolute_expires_at,
                    )
                )
                row.consumed_at = now
                account.email_verified_at = account.email_verified_at or now
                await session.flush()
                return self._to_account(account)
        except IntegrityError:
            return None

    async def list_identities(self, account_id: UUID) -> list[LinkedIdentity]:
        async with self._database.transaction() as session:
            rows = await session.scalars(
                select(AuthenticationIdentity)
                .where(AuthenticationIdentity.account_id == account_id)
                .order_by(AuthenticationIdentity.provider)
            )
            return [
                LinkedIdentity(
                    row.provider,
                    row.email,
                    row.created_at
                    if row.created_at.tzinfo is not None
                    else row.created_at.replace(tzinfo=UTC),
                )
                for row in rows
            ]

    @staticmethod
    def _to_account(account: StudentAccount) -> OIDCAccount:
        return OIDCAccount(account.id, account.email, account.name)
