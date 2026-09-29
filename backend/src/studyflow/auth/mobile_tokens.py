"""Opaque mobile access and rotating refresh tokens."""

import hashlib
import secrets
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Protocol
from uuid import UUID

ACCESS_TOKEN_LIFETIME = timedelta(minutes=15)
REFRESH_TOKEN_LIFETIME = timedelta(days=30)
MOBILE_ACCESS_TOKEN_TYPE = "access"  # noqa: S105
MOBILE_REFRESH_TOKEN_TYPE = "refresh"  # noqa: S105
MOBILE_BEARER_SCHEME = "Bearer"


@dataclass(frozen=True, slots=True)
class MobileTokenCredentials:
    access_token: str
    refresh_token: str
    access_expires_at: datetime
    refresh_expires_at: datetime


@dataclass(frozen=True, slots=True)
class MobileTokenPrincipal:
    account_id: UUID
    email: str
    name: str
    avatar_url: str | None = None


@dataclass(frozen=True, slots=True)
class MobileTokenResult:
    principal: MobileTokenPrincipal
    credentials: MobileTokenCredentials


class InvalidMobileRefreshToken(ValueError):
    """The refresh token is expired, revoked, or otherwise invalid."""


class MobileTokenRepository(Protocol):
    async def issue(
        self,
        account_id: UUID,
        access_token_hash: str,
        refresh_token_hash: str,
        now: datetime,
        access_expires_at: datetime,
        refresh_expires_at: datetime,
    ) -> MobileTokenPrincipal | None: ...

    async def rotate(
        self,
        refresh_token_hash: str,
        access_token_hash: str,
        new_refresh_token_hash: str,
        now: datetime,
        access_expires_at: datetime,
        refresh_expires_at: datetime,
    ) -> MobileTokenPrincipal | None: ...

    async def authenticate_access(
        self, access_token_hash: str, now: datetime
    ) -> MobileTokenPrincipal | None: ...

    async def create_oauth_code(
        self, account_id: UUID, code_hash: str, now: datetime, expires_at: datetime
    ) -> bool: ...

    async def consume_oauth_code(self, code_hash: str, now: datetime) -> UUID | None: ...

    async def revoke(
        self,
        now: datetime,
        access_token_hash: str | None = None,
        refresh_token_hash: str | None = None,
    ) -> bool: ...


def hash_mobile_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class MobileTokenService:
    def __init__(
        self,
        repository: MobileTokenRepository,
        token_factory: Callable[[], str] = lambda: secrets.token_urlsafe(48),
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self._repository = repository
        self._token_factory = token_factory
        self._clock = clock

    async def issue(self, account_id: UUID) -> MobileTokenResult:
        now = self._clock()
        access_token = self._token_factory()
        refresh_token = self._token_factory()
        access_expires_at = now + ACCESS_TOKEN_LIFETIME
        refresh_expires_at = now + REFRESH_TOKEN_LIFETIME
        principal = await self._repository.issue(
            account_id,
            hash_mobile_token(access_token),
            hash_mobile_token(refresh_token),
            now,
            access_expires_at,
            refresh_expires_at,
        )
        if principal is None:
            raise InvalidMobileRefreshToken
        return MobileTokenResult(
            principal,
            MobileTokenCredentials(
                access_token,
                refresh_token,
                access_expires_at,
                refresh_expires_at,
            ),
        )

    async def rotate(self, refresh_token: str) -> MobileTokenResult:
        now = self._clock()
        access_token = self._token_factory()
        new_refresh_token = self._token_factory()
        access_expires_at = now + ACCESS_TOKEN_LIFETIME
        refresh_expires_at = now + REFRESH_TOKEN_LIFETIME
        principal = await self._repository.rotate(
            hash_mobile_token(refresh_token),
            hash_mobile_token(access_token),
            hash_mobile_token(new_refresh_token),
            now,
            access_expires_at,
            refresh_expires_at,
        )
        if principal is None:
            raise InvalidMobileRefreshToken
        return MobileTokenResult(
            principal,
            MobileTokenCredentials(
                access_token,
                new_refresh_token,
                access_expires_at,
                refresh_expires_at,
            ),
        )

    async def authenticate_access(self, access_token: str) -> MobileTokenPrincipal | None:
        return await self._repository.authenticate_access(
            hash_mobile_token(access_token), self._clock()
        )

    async def create_oauth_code(self, account_id: UUID) -> str:
        code = self._token_factory()
        now = self._clock()
        created = await self._repository.create_oauth_code(
            account_id,
            hash_mobile_token(code),
            now,
            now + timedelta(minutes=5),
        )
        if not created:
            raise InvalidMobileRefreshToken
        return code

    async def exchange_oauth_code(self, code: str) -> MobileTokenResult:
        account_id = await self._repository.consume_oauth_code(
            hash_mobile_token(code), self._clock()
        )
        if account_id is None:
            raise InvalidMobileRefreshToken
        return await self.issue(account_id)

    async def revoke(
        self, access_token: str | None = None, refresh_token: str | None = None
    ) -> bool:
        return await self._repository.revoke(
            self._clock(),
            hash_mobile_token(access_token) if access_token is not None else None,
            hash_mobile_token(refresh_token) if refresh_token is not None else None,
        )
