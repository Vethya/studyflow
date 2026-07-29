from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest

from studyflow.auth.oidc import (
    InvalidLinkChallengeError,
    LinkedIdentity,
    OIDCAccount,
    OIDCAccountLinkService,
    OIDCLinkChallenge,
)
from studyflow.auth.sessions import PendingSession

ACCOUNT_ID = UUID("5b15bfef-8c44-45d5-a70e-574beb999fb3")


class RepositoryStub:
    def __init__(self) -> None:
        self.challenge = OIDCLinkChallenge(
            uuid4(), ACCOUNT_ID, "google-subject", "student@example.com", "$argon2id$hash"
        )

    async def get_link_challenge(self, token_hash: str, now: datetime) -> OIDCLinkChallenge | None:
        return self.challenge if token_hash else None

    async def link_identity_and_create_session(
        self,
        challenge_id: UUID,
        expected_password_hash: str,
        pending_session: PendingSession,
        now: datetime,
    ) -> OIDCAccount | None:
        return OIDCAccount(ACCOUNT_ID, "student@example.com", "Student")

    async def list_identities(self, account_id: UUID) -> list[LinkedIdentity]:
        return [LinkedIdentity("google", "student@example.com", datetime.now(UTC))]


class PasswordsStub:
    async def verify_password(self, password: str, password_hash: str) -> bool:
        return password == "correct password"


@pytest.mark.anyio
async def test_google_link_challenge_requires_password_then_issues_normal_session() -> None:
    service = OIDCAccountLinkService(
        RepositoryStub(),
        PasswordsStub(),
        token_factory=iter(["session-token", "csrf-token"]).__next__,
    )

    result = await service.link("challenge-token", "correct password")

    assert result.account_id == ACCOUNT_ID
    assert result.session_token == "session-token"


@pytest.mark.anyio
async def test_google_link_challenge_rejects_wrong_password_generically() -> None:
    service = OIDCAccountLinkService(RepositoryStub(), PasswordsStub())
    with pytest.raises(InvalidLinkChallengeError):
        await service.link("challenge-token", "wrong password")
