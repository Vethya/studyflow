from dataclasses import dataclass, field
from uuid import UUID

import pytest

from studyflow.auth.login import (
    EmailVerificationRequiredError,
    InvalidCredentialsError,
    LoginAccount,
    LoginCommand,
    LoginService,
)
from studyflow.auth.sessions import SessionCredentials


@dataclass
class LoginRepositoryStub:
    account: LoginAccount | None

    async def find_by_email(self, email: str) -> LoginAccount | None:
        return self.account


@dataclass
class PasswordVerifierStub:
    valid: bool
    calls: list[tuple[str, str]]

    async def verify_password(self, password: str, password_hash: str) -> bool:
        self.calls.append((password, password_hash))
        return self.valid


@dataclass
class SessionIssuerStub:
    account_ids: list[UUID]
    created: bool = True
    expected_password_hashes: list[str | None] = field(default_factory=list)

    async def create(
        self, account_id: UUID, expected_password_hash: str | None = None
    ) -> SessionCredentials | None:
        self.account_ids.append(account_id)
        self.expected_password_hashes.append(expected_password_hash)
        return SessionCredentials("opaque-session", "csrf-token") if self.created else None


@pytest.mark.anyio
async def test_verified_password_account_can_create_a_normal_session() -> None:
    account_id = UUID("5b15bfef-8c44-45d5-a70e-574beb999fb3")
    passwords = PasswordVerifierStub(valid=True, calls=[])
    sessions = SessionIssuerStub(account_ids=[])
    service = LoginService(
        repository=LoginRepositoryStub(
            LoginAccount(
                id=account_id,
                email="student@example.com",
                name="Student Name",
                password_hash="$argon2id$stored-hash",
                email_verified=True,
            )
        ),
        passwords=passwords,
        sessions=sessions,
    )

    result = await service.login(
        LoginCommand(email=" STUDENT@example.com ", password="correct password")
    )

    assert result.account_id == account_id
    assert result.session_token == "opaque-session"
    assert result.csrf_token == "csrf-token"
    assert passwords.calls == [("correct password", "$argon2id$stored-hash")]
    assert sessions.account_ids == [account_id]
    assert sessions.expected_password_hashes == ["$argon2id$stored-hash"]


@pytest.mark.anyio
async def test_login_fails_if_password_changes_before_session_issuance() -> None:
    account_id = UUID("5b15bfef-8c44-45d5-a70e-574beb999fb3")
    sessions = SessionIssuerStub(account_ids=[], created=False)
    service = LoginService(
        repository=LoginRepositoryStub(
            LoginAccount(
                id=account_id,
                email="student@example.com",
                name="Student Name",
                password_hash="$argon2id$stale-hash",
                email_verified=True,
            )
        ),
        passwords=PasswordVerifierStub(valid=True, calls=[]),
        sessions=sessions,
    )

    with pytest.raises(InvalidCredentialsError):
        await service.login(LoginCommand("student@example.com", "old password"))
    assert sessions.expected_password_hashes == ["$argon2id$stale-hash"]


@pytest.mark.anyio
async def test_unknown_email_still_performs_password_verification() -> None:
    passwords = PasswordVerifierStub(valid=False, calls=[])
    sessions = SessionIssuerStub(account_ids=[])
    service = LoginService(
        repository=LoginRepositoryStub(None),
        passwords=passwords,
        sessions=sessions,
    )

    with pytest.raises(InvalidCredentialsError):
        await service.login(LoginCommand(email="unknown@example.com", password="guess"))

    assert len(passwords.calls) == 1
    assert passwords.calls[0][0] == "guess"
    assert passwords.calls[0][1].startswith("$argon2id$")
    assert sessions.account_ids == []


@pytest.mark.anyio
async def test_unverified_account_cannot_create_a_session() -> None:
    account_id = UUID("5b15bfef-8c44-45d5-a70e-574beb999fb3")
    sessions = SessionIssuerStub(account_ids=[])
    service = LoginService(
        repository=LoginRepositoryStub(
            LoginAccount(
                id=account_id,
                email="student@example.com",
                name="Student Name",
                password_hash="$argon2id$stored-hash",
                email_verified=False,
            )
        ),
        passwords=PasswordVerifierStub(valid=True, calls=[]),
        sessions=sessions,
    )

    with pytest.raises(EmailVerificationRequiredError):
        await service.login(LoginCommand("student@example.com", "correct password"))

    assert sessions.account_ids == []
