from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

from studyflow.auth.sessions import PendingSession, SessionService


@dataclass
class SessionRepositoryStub:
    sessions: list[PendingSession] = field(default_factory=list)

    async def create(self, session: PendingSession) -> None:
        self.sessions.append(session)


@pytest.mark.anyio
async def test_session_service_issues_opaque_credentials_and_persists_only_hashes() -> None:
    repository = SessionRepositoryStub()
    account_id = uuid4()
    now = datetime(2026, 7, 29, 12, tzinfo=UTC)
    tokens = iter(("opaque-session-token", "csrf-request-token"))
    service = SessionService(
        repository,
        token_factory=lambda: next(tokens),
        clock=lambda: now,
    )

    credentials = await service.create(account_id)

    assert credentials.session_token == "opaque-session-token"
    assert credentials.csrf_token == "csrf-request-token"
    assert repository.sessions == [
        PendingSession(
            account_id=account_id,
            token_hash="00f5c39025967a24e513257fc3a8572166ddddaa08809f00fd260414df28ba9f",
            csrf_token_hash="97f1186e1e484a9b3933f67218fd2052a1ec92535434ddbc53e474b66ed3ef5b",
            idle_expires_at=now + timedelta(hours=24),
            absolute_expires_at=now + timedelta(days=7),
        )
    ]
