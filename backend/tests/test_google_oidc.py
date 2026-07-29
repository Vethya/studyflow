from datetime import datetime
from urllib.parse import parse_qs, urlsplit
from uuid import UUID

import pytest

from studyflow.auth.oidc import (
    AccountLinkRequiredError,
    GoogleClaims,
    InvalidOIDCResponseError,
    OIDCAccount,
    OIDCLoginService,
    OIDCStateRecord,
)
from studyflow.auth.sessions import SessionCredentials

ACCOUNT_ID = UUID("5b15bfef-8c44-45d5-a70e-574beb999fb3")


class RepositoryStub:
    def __init__(self, *, link_required: bool = False) -> None:
        self.state_hash = ""
        self.nonce_hash = ""
        self.link_required = link_required

    async def store_state(
        self, state_hash: str, nonce_hash: str, timezone: str, expires_at: datetime
    ) -> None:
        self.state_hash, self.nonce_hash = state_hash, nonce_hash
        self.timezone = timezone

    async def consume_state(self, state_hash: str, now: datetime) -> OIDCStateRecord | None:
        return (
            OIDCStateRecord(self.nonce_hash, self.timezone)
            if state_hash == self.state_hash
            else None
        )

    async def resolve_identity(self, claims: GoogleClaims, timezone: str) -> OIDCAccount | None:
        if self.link_required:
            return None
        return OIDCAccount(ACCOUNT_ID, claims.email, claims.name)


class ProviderStub:
    async def exchange(self, code: str, expected_nonce_hash: str) -> GoogleClaims:
        assert code == "authorization-code"
        assert expected_nonce_hash
        return GoogleClaims("google-subject", "student@example.com", "Student")


class SessionsStub:
    async def create(
        self, account_id: UUID, expected_password_hash: str | None = None
    ) -> SessionCredentials | None:
        return SessionCredentials("session-token", "csrf-token")


@pytest.mark.anyio
async def test_google_oidc_uses_exact_scopes_and_one_time_state_nonce() -> None:
    repository = RepositoryStub()
    service = OIDCLoginService(
        repository,
        ProviderStub(),
        SessionsStub(),
        client_id="client-id",
        redirect_uri="https://studyflow.example/api/v1/auth/google/callback",
        token_factory=iter(["state-secret", "nonce-secret"]).__next__,
    )

    started = await service.start("Asia/Phnom_Penh")
    query = parse_qs(urlsplit(started.authorization_url).query)
    result = await service.complete("authorization-code", started.state, started.state)

    assert query["scope"] == ["openid email profile"]
    assert query["response_type"] == ["code"]
    assert query["nonce"] == ["nonce-secret"]
    assert repository.state_hash != started.state
    assert repository.timezone == "Asia/Phnom_Penh"
    assert result.account_id == ACCOUNT_ID
    assert result.session_token == "session-token"


@pytest.mark.anyio
async def test_google_oidc_rejects_browser_state_mismatch_and_requires_confirmed_linking() -> None:
    repository = RepositoryStub(link_required=True)
    service = OIDCLoginService(
        repository,
        ProviderStub(),
        SessionsStub(),
        client_id="client-id",
        redirect_uri="https://studyflow.example/api/v1/auth/google/callback",
        token_factory=iter(["state-secret", "nonce-secret"]).__next__,
    )
    started = await service.start("Asia/Phnom_Penh")

    with pytest.raises(InvalidOIDCResponseError):
        await service.complete("authorization-code", started.state, "different-cookie")
    with pytest.raises(AccountLinkRequiredError):
        await service.complete("authorization-code", started.state, started.state)
