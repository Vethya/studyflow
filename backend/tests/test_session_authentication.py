from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest

from studyflow.auth.session_authentication import (
    PersistedSessionPrincipal,
    SessionAuthenticationService,
)


@dataclass
class SessionAuthenticationRepositoryStub:
    principal: PersistedSessionPrincipal | None
    authentication_calls: list[tuple[str, datetime, datetime, str | None]]
    revoke_calls: list[tuple[str, str, datetime]]

    async def authenticate(
        self,
        token_hash: str,
        now: datetime,
        refreshed_idle_expiry: datetime,
        csrf_hash: str | None = None,
    ) -> PersistedSessionPrincipal | None:
        self.authentication_calls.append((token_hash, now, refreshed_idle_expiry, csrf_hash))
        return self.principal

    async def revoke(self, token_hash: str, csrf_hash: str, now: datetime) -> bool:
        self.revoke_calls.append((token_hash, csrf_hash, now))
        return True


@pytest.mark.anyio
async def test_session_authentication_hashes_credentials_and_refreshes_idle_expiry() -> None:
    now = datetime(2026, 7, 29, 12, tzinfo=UTC)
    persisted = PersistedSessionPrincipal(
        account_id=UUID("5b15bfef-8c44-45d5-a70e-574beb999fb3"),
        email="student@example.com",
        name="Student Name",
    )
    repository = SessionAuthenticationRepositoryStub(persisted, [], [])
    service = SessionAuthenticationService(repository, clock=lambda: now)

    principal = await service.authenticate("opaque-session-token")

    assert principal is not None
    token_hash, called_at, idle_expiry, csrf_hash = repository.authentication_calls[0]
    assert token_hash == "00f5c39025967a24e513257fc3a8572166ddddaa08809f00fd260414df28ba9f"
    assert called_at == now
    assert idle_expiry == now + timedelta(hours=24)
    assert csrf_hash is None


@pytest.mark.anyio
async def test_session_authentication_hashes_csrf_for_state_changes() -> None:
    now = datetime(2026, 7, 29, 12, tzinfo=UTC)
    repository = SessionAuthenticationRepositoryStub(None, [], [])
    service = SessionAuthenticationService(repository, clock=lambda: now)

    assert await service.authenticate("opaque-session-token", "csrf-request-token") is None

    assert repository.authentication_calls[0][3] == (
        "97f1186e1e484a9b3933f67218fd2052a1ec92535434ddbc53e474b66ed3ef5b"
    )
