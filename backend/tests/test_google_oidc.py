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
    OIDCProviderUnavailableError,
    OIDCStateRecord,
)
from studyflow.auth.sessions import SessionCredentials

ACCOUNT_ID = UUID("5b15bfef-8c44-45d5-a70e-574beb999fb3")


class RepositoryStub:
    def __init__(self, *, link_required: bool = False, can_restore: bool = True) -> None:
        self.state_hash = ""
        self.nonce_hash = ""
        self.link_required = link_required
        self.can_restore = can_restore
        self.consumed = False
        self.restored = 0

    async def store_state(
        self, state_hash: str, nonce_hash: str, timezone: str, expires_at: datetime
    ) -> None:
        self.state_hash, self.nonce_hash = state_hash, nonce_hash
        self.timezone = timezone
        self.consumed = False

    async def consume_state(self, state_hash: str, now: datetime) -> OIDCStateRecord | None:
        if state_hash != self.state_hash or self.consumed:
            return None
        self.consumed = True
        return OIDCStateRecord(self.nonce_hash, self.timezone)

    async def restore_state(self, state_hash: str, consumed_at: datetime, now: datetime) -> bool:
        if state_hash != self.state_hash or not self.consumed or not self.can_restore:
            return False
        self.consumed = False
        self.restored += 1
        return True

    async def resolve_identity(self, claims: GoogleClaims, timezone: str) -> OIDCAccount | None:
        if self.link_required:
            return None
        return OIDCAccount(ACCOUNT_ID, claims.email, claims.name)

    async def create_link_challenge(
        self, claims: GoogleClaims, token_hash: str, expires_at: datetime
    ) -> bool:
        self.link_token_hash = token_hash
        return True


class ProviderStub:
    async def exchange(self, code: str, expected_nonce_hash: str) -> GoogleClaims:
        assert code == "authorization-code"
        assert expected_nonce_hash
        return GoogleClaims("google-subject", "student@example.com", "Student")


class FlakyProviderStub(ProviderStub):
    def __init__(self) -> None:
        self.attempts = 0

    async def exchange(self, code: str, expected_nonce_hash: str) -> GoogleClaims:
        self.attempts += 1
        if self.attempts == 1:
            raise OIDCProviderUnavailableError(retry_same_callback=True)
        return await super().exchange(code, expected_nonce_hash)


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
        token_factory=iter(["state-secret", "nonce-secret", "link-challenge"]).__next__,
    )
    started = await service.start("Asia/Phnom_Penh")

    with pytest.raises(InvalidOIDCResponseError):
        await service.complete("authorization-code", started.state, "different-cookie")
    with pytest.raises(AccountLinkRequiredError) as raised:
        await service.complete("authorization-code", started.state, started.state)
    assert raised.value.challenge == "link-challenge"
    assert repository.link_token_hash != "link-challenge"


@pytest.mark.anyio
async def test_google_oidc_restores_state_for_a_provider_outage_retry() -> None:
    repository = RepositoryStub()
    provider = FlakyProviderStub()
    service = OIDCLoginService(
        repository,
        provider,
        SessionsStub(),
        client_id="client-id",
        redirect_uri="https://studyflow.example/api/v1/auth/google/callback",
        token_factory=iter(["state-secret", "nonce-secret"]).__next__,
    )
    started = await service.start("Asia/Phnom_Penh")

    with pytest.raises(OIDCProviderUnavailableError):
        await service.complete("authorization-code", started.state, started.state)
    result = await service.complete("authorization-code", started.state, started.state)

    assert repository.restored == 1
    assert provider.attempts == 2
    assert result.account_id == ACCOUNT_ID


@pytest.mark.anyio
async def test_google_oidc_marks_outage_nonretryable_when_state_cannot_be_restored() -> None:
    repository = RepositoryStub(can_restore=False)
    service = OIDCLoginService(
        repository,
        FlakyProviderStub(),
        SessionsStub(),
        client_id="client-id",
        redirect_uri="https://studyflow.example/api/v1/auth/google/callback",
        token_factory=iter(["state-secret", "nonce-secret"]).__next__,
    )
    started = await service.start("Asia/Phnom_Penh")

    with pytest.raises(OIDCProviderUnavailableError) as raised:
        await service.complete("authorization-code", started.state, started.state)

    assert raised.value.retry_same_callback is False
    assert repository.restored == 0
