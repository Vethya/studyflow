"""Google OpenID Connect server authorization-code flow."""

import hashlib
import hmac
import json
import secrets
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol
from urllib.parse import urlencode
from uuid import UUID

import httpx
import jwt
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPublicKey
from jwt.algorithms import RSAAlgorithm
from pydantic import EmailStr, TypeAdapter, ValidationError

from studyflow.auth.sessions import SessionCredentials

GOOGLE_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"  # noqa: S105
GOOGLE_JWKS_ENDPOINT = "https://www.googleapis.com/oauth2/v3/certs"
GOOGLE_ISSUERS = {"accounts.google.com", "https://accounts.google.com"}
OIDC_SCOPES = "openid email profile"


class InvalidOIDCResponseError(ValueError):
    """The authorization response or ID token did not validate."""


class AccountLinkRequiredError(ValueError):
    """A matching account requires password-confirmed linking."""


class OIDCNotConfiguredError(RuntimeError):
    """Google OIDC credentials have not been configured."""


@dataclass(frozen=True, slots=True)
class GoogleClaims:
    subject: str
    email: str
    name: str


@dataclass(frozen=True, slots=True)
class OIDCAccount:
    id: UUID
    email: str
    name: str


@dataclass(frozen=True, slots=True)
class OIDCStart:
    authorization_url: str
    state: str


@dataclass(frozen=True, slots=True)
class OIDCLoginResult:
    account_id: UUID
    email: str
    name: str
    session_token: str
    csrf_token: str


@dataclass(frozen=True, slots=True)
class OIDCStateRecord:
    nonce_hash: str
    timezone: str


class OIDCRepository(Protocol):
    async def store_state(
        self, state_hash: str, nonce_hash: str, timezone: str, expires_at: datetime
    ) -> None: ...
    async def consume_state(self, state_hash: str, now: datetime) -> OIDCStateRecord | None: ...
    async def resolve_identity(self, claims: GoogleClaims, timezone: str) -> OIDCAccount | None: ...


class GoogleProvider(Protocol):
    async def exchange(self, code: str, expected_nonce_hash: str) -> GoogleClaims: ...


class SessionIssuer(Protocol):
    async def create(
        self, account_id: UUID, expected_password_hash: str | None = None
    ) -> SessionCredentials | None: ...


class OIDCLogin(Protocol):
    async def start(self, timezone: str) -> OIDCStart: ...
    async def complete(self, code: str, state: str, state_cookie: str) -> OIDCLoginResult: ...


def hash_oidc_secret(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


class OIDCLoginService:
    def __init__(
        self,
        repository: OIDCRepository,
        provider: GoogleProvider,
        sessions: SessionIssuer,
        client_id: str,
        redirect_uri: str,
        token_factory: Callable[[], str] = lambda: secrets.token_urlsafe(32),
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self._repository = repository
        self._provider = provider
        self._sessions = sessions
        self._client_id = client_id
        self._redirect_uri = redirect_uri
        self._token_factory = token_factory
        self._clock = clock

    async def start(self, timezone: str) -> OIDCStart:
        state = self._token_factory()
        nonce = self._token_factory()
        await self._repository.store_state(
            hash_oidc_secret(state),
            hash_oidc_secret(nonce),
            timezone,
            self._clock() + timedelta(minutes=10),
        )
        query = urlencode(
            {
                "client_id": self._client_id,
                "redirect_uri": self._redirect_uri,
                "response_type": "code",
                "scope": OIDC_SCOPES,
                "state": state,
                "nonce": nonce,
            }
        )
        return OIDCStart(f"{GOOGLE_AUTHORIZATION_ENDPOINT}?{query}", state)

    async def complete(self, code: str, state: str, state_cookie: str) -> OIDCLoginResult:
        if not hmac.compare_digest(state, state_cookie):
            raise InvalidOIDCResponseError
        state_record = await self._repository.consume_state(hash_oidc_secret(state), self._clock())
        if state_record is None:
            raise InvalidOIDCResponseError
        claims = await self._provider.exchange(code, state_record.nonce_hash)
        account = await self._repository.resolve_identity(claims, state_record.timezone)
        if account is None:
            raise AccountLinkRequiredError
        credentials = await self._sessions.create(account.id)
        if credentials is None:
            raise InvalidOIDCResponseError
        return OIDCLoginResult(
            account.id,
            account.email,
            account.name,
            credentials.session_token,
            credentials.csrf_token,
        )


class GoogleOIDCProvider:
    def __init__(
        self,
        http_client: httpx.AsyncClient,
        client_id: str,
        client_secret: str,
        redirect_uri: str,
    ) -> None:
        self._http_client = http_client
        self._client_id = client_id
        self._client_secret = client_secret
        self._redirect_uri = redirect_uri

    async def exchange(self, code: str, expected_nonce_hash: str) -> GoogleClaims:
        try:
            token_response = await self._http_client.post(
                GOOGLE_TOKEN_ENDPOINT,
                data={
                    "code": code,
                    "client_id": self._client_id,
                    "client_secret": self._client_secret,
                    "redirect_uri": self._redirect_uri,
                    "grant_type": "authorization_code",
                },
            )
            token_response.raise_for_status()
            id_token = token_response.json()["id_token"]
            if not isinstance(id_token, str):
                raise InvalidOIDCResponseError
            claims = await self._decode_id_token(id_token)
            return self._validated_claims(claims, expected_nonce_hash)
        except (httpx.HTTPError, KeyError, TypeError, ValueError, jwt.PyJWTError) as error:
            if isinstance(error, InvalidOIDCResponseError):
                raise
            raise InvalidOIDCResponseError from error

    async def _decode_id_token(self, id_token: str) -> dict[str, Any]:
        header = jwt.get_unverified_header(id_token)
        if header.get("alg") != "RS256" or not isinstance(header.get("kid"), str):
            raise InvalidOIDCResponseError
        response = await self._http_client.get(GOOGLE_JWKS_ENDPOINT)
        response.raise_for_status()
        keys = response.json().get("keys")
        if not isinstance(keys, list):
            raise InvalidOIDCResponseError
        jwk = next(
            (key for key in keys if isinstance(key, dict) and key.get("kid") == header["kid"]),
            None,
        )
        if jwk is None:
            raise InvalidOIDCResponseError
        public_key = RSAAlgorithm.from_jwk(json.dumps(jwk))
        if not isinstance(public_key, RSAPublicKey):
            raise InvalidOIDCResponseError
        decoded = jwt.decode(
            id_token,
            public_key,
            algorithms=["RS256"],
            audience=self._client_id,
            options={
                "verify_iss": False,
                "require": [
                    "iss",
                    "aud",
                    "sub",
                    "email",
                    "email_verified",
                    "nonce",
                    "iat",
                    "exp",
                ],
            },
            leeway=60,
        )
        return decoded

    def _validated_claims(self, claims: dict[str, Any], expected_nonce_hash: str) -> GoogleClaims:
        issuer = claims.get("iss")
        subject = claims.get("sub")
        nonce = claims.get("nonce")
        if issuer not in GOOGLE_ISSUERS:
            raise InvalidOIDCResponseError
        audience = claims.get("aud")
        authorized_party = claims.get("azp")
        if (
            (isinstance(audience, list) and len(audience) > 1) or authorized_party is not None
        ) and authorized_party != self._client_id:
            raise InvalidOIDCResponseError
        if not isinstance(subject, str) or not subject or len(subject) > 255:
            raise InvalidOIDCResponseError
        if not isinstance(nonce, str) or not hmac.compare_digest(
            hash_oidc_secret(nonce), expected_nonce_hash
        ):
            raise InvalidOIDCResponseError
        if claims.get("email_verified") is not True:
            raise InvalidOIDCResponseError
        try:
            email = str(TypeAdapter(EmailStr).validate_python(claims.get("email"))).lower()
        except ValidationError as error:
            raise InvalidOIDCResponseError from error
        raw_name = claims.get("name")
        name = raw_name.strip()[:200] if isinstance(raw_name, str) else ""
        return GoogleClaims(subject, email, name or email.partition("@")[0])


class UnconfiguredOIDCLogin:
    async def start(self, timezone: str) -> OIDCStart:
        raise OIDCNotConfiguredError

    async def complete(self, code: str, state: str, state_cookie: str) -> OIDCLoginResult:
        raise OIDCNotConfiguredError
