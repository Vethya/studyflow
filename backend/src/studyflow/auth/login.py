"""Email/password login boundary."""

from dataclasses import dataclass
from typing import Protocol
from uuid import UUID

from studyflow.auth.email import canonicalize_email
from studyflow.auth.sessions import SessionCredentials

DUMMY_PASSWORD_HASH = (
    "$argon2id$v=19$m=19456,t=2,p=1$kr9yet9qmcCQe8ifl5uCaQ$"  # noqa: S105
    "KAkOAkgQdidCQ1REruEs9XXdR7E1QL1qw1PaAJ9cZhk"
)


class InvalidCredentialsError(ValueError):
    """Raised without revealing whether an email account exists."""


class EmailVerificationRequiredError(ValueError):
    """Raised when valid credentials belong to an unverified account."""


@dataclass(frozen=True, slots=True)
class LoginCommand:
    email: str
    password: str


@dataclass(frozen=True, slots=True)
class LoginResult:
    account_id: UUID
    email: str
    name: str
    session_token: str
    csrf_token: str


class Login(Protocol):
    async def login(self, command: LoginCommand) -> LoginResult: ...


@dataclass(frozen=True, slots=True)
class LoginAccount:
    id: UUID
    email: str
    name: str
    password_hash: str | None
    email_verified: bool


class LoginRepository(Protocol):
    async def find_by_email(self, email: str) -> LoginAccount | None: ...


class PasswordVerifier(Protocol):
    async def verify_password(self, password: str, password_hash: str) -> bool: ...


class SessionIssuer(Protocol):
    async def create(
        self, account_id: UUID, expected_password_hash: str | None = None
    ) -> SessionCredentials | None: ...


class LoginService:
    def __init__(
        self,
        repository: LoginRepository,
        passwords: PasswordVerifier,
        sessions: SessionIssuer,
    ) -> None:
        self._repository = repository
        self._passwords = passwords
        self._sessions = sessions

    async def login(self, command: LoginCommand) -> LoginResult:
        account = await self._repository.find_by_email(canonicalize_email(command.email))
        password_hash = (
            account.password_hash
            if account is not None and account.password_hash is not None
            else DUMMY_PASSWORD_HASH
        )
        password_is_valid = await self._passwords.verify_password(command.password, password_hash)
        if account is None or account.password_hash is None or not password_is_valid:
            raise InvalidCredentialsError
        if not account.email_verified:
            raise EmailVerificationRequiredError
        credentials = await self._sessions.create(account.id, account.password_hash)
        if credentials is None:
            raise InvalidCredentialsError
        return LoginResult(
            account_id=account.id,
            email=account.email,
            name=account.name,
            session_token=credentials.session_token,
            csrf_token=credentials.csrf_token,
        )
