from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock

import httpx
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from studyflow.api import auth as auth_api
from studyflow.app import create_app
from studyflow.auth.login import LoginService
from studyflow.auth.passwords import (
    KNOWN_BREACH_MESSAGE,
    BreachedPasswordError,
    PasswordPolicyError,
)
from studyflow.auth.rate_limits import (
    DatabaseLoginRateLimiter,
    PasswordResetAttemptRateLimitExceeded,
    PasswordResetRequestRateLimitExceeded,
)
from studyflow.auth.recovery import InvalidPasswordResetTokenError, PasswordRecoveryService
from studyflow.auth.registration import DeferredTasks, hash_verification_token
from studyflow.auth.repositories import (
    SqlAlchemyLoginRepository,
    SqlAlchemyPasswordRecoveryRepository,
    SqlAlchemySessionRepository,
)
from studyflow.auth.sessions import SessionService
from studyflow.database import Base, Database
from studyflow.database.models import AuthenticationSession, StudentAccount


@dataclass
class PasswordRecoveryStub:
    requests: list[str] = field(default_factory=list)
    resets: list[tuple[str, str]] = field(default_factory=list)
    invalid: bool = False
    policy_failure: bool = False
    breached_password: bool = False
    unavailable: bool = False

    async def request_reset(self, email: str, deferred_tasks: DeferredTasks) -> None:
        self.requests.append(email)

    async def reset_password(self, token: str, password: str) -> str:
        self.resets.append((token, password))
        if self.invalid:
            raise InvalidPasswordResetTokenError
        if self.policy_failure:
            raise PasswordPolicyError
        if self.breached_password:
            raise BreachedPasswordError("internal")
        if self.unavailable:
            raise httpx.ConnectError("unavailable")
        return "student@example.com"


@dataclass
class RateLimitStub:
    failure: type[RuntimeError] | None = None

    async def check(self, client_ip: str, key: str) -> None:
        if self.failure is not None:
            raise self.failure


@dataclass
class LoginRateLimitStub:
    clears: list[tuple[str, str]] = field(default_factory=list)
    clear_error: Exception | None = None

    async def check(self, client_ip: str, email: str) -> str:
        return "login_inflight:test"

    async def record_failure(self, client_ip: str, email: str, reservation_id: str) -> None:
        return None

    async def reset_failures(self, client_ip: str, email: str, reservation_id: str) -> None:
        return None

    async def release(self, client_ip: str, email: str, reservation_id: str) -> None:
        return None

    async def clear_failures(self, client_ip: str, email: str) -> None:
        self.clears.append((client_ip, email))
        if self.clear_error is not None:
            raise self.clear_error


@pytest.mark.anyio
async def test_password_reset_request_is_non_enumerating() -> None:
    recovery = PasswordRecoveryStub()
    app = create_app(
        password_recovery=recovery,
        login_rate_limiter=LoginRateLimitStub(),
        password_reset_request_rate_limiter=RateLimitStub(),
        password_reset_attempt_rate_limiter=RateLimitStub(),
    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://test") as client:
        response = await client.post(
            "/api/v1/auth/forgot-password", json={"email": "Student@Example.com"}
        )

    assert response.status_code == 202
    assert recovery.requests == ["Student@example.com"]


@pytest.mark.anyio
async def test_password_reset_rejects_invalid_token_and_accepts_valid_token() -> None:
    recovery = PasswordRecoveryStub(invalid=True)
    login_limiter = LoginRateLimitStub()
    app = create_app(
        password_recovery=recovery,
        login_rate_limiter=login_limiter,
        password_reset_request_rate_limiter=RateLimitStub(),
        password_reset_attempt_rate_limiter=RateLimitStub(),
    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://test") as client:
        invalid = await client.post(
            "/api/v1/auth/reset-password",
            json={"token": "single-use-password-reset-token", "password": "a-new-secure-password"},
        )
        assert login_limiter.clears == []
        recovery.invalid = False
        valid = await client.post(
            "/api/v1/auth/reset-password",
            json={"token": "single-use-password-reset-token", "password": "a-new-secure-password"},
        )

    assert invalid.status_code == 400
    assert valid.status_code == 204

    assert login_limiter.clears == [("127.0.0.1", "student@example.com")]


@pytest.mark.anyio
async def test_password_reset_reports_breached_password() -> None:
    recovery = PasswordRecoveryStub(breached_password=True)
    app = create_app(
        password_recovery=recovery,
        login_rate_limiter=LoginRateLimitStub(),
        password_reset_request_rate_limiter=RateLimitStub(),
        password_reset_attempt_rate_limiter=RateLimitStub(),
    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://test") as client:
        response = await client.post(
            "/api/v1/auth/reset-password",
            json={"token": "single-use-password-reset-token", "password": "a-new-secure-password"},
        )

    assert response.status_code == 422
    assert response.json()["detail"] == KNOWN_BREACH_MESSAGE


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("failure", "expected_status"), (("policy_failure", 422), ("unavailable", 503))
)
async def test_password_reset_maps_password_validation_failures(
    failure: str, expected_status: int
) -> None:
    recovery = PasswordRecoveryStub()
    setattr(recovery, failure, True)
    app = create_app(
        password_recovery=recovery,
        login_rate_limiter=LoginRateLimitStub(),
        password_reset_request_rate_limiter=RateLimitStub(),
        password_reset_attempt_rate_limiter=RateLimitStub(),
    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://test") as client:
        response = await client.post(
            "/api/v1/auth/reset-password",
            json={"token": "single-use-password-reset-token", "password": "a-new-secure-password"},
        )

    assert response.status_code == expected_status


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("path", "payload", "failure"),
    (
        (
            "/api/v1/auth/forgot-password",
            {"email": "student@example.com"},
            PasswordResetRequestRateLimitExceeded,
        ),
        (
            "/api/v1/auth/reset-password",
            {"token": "single-use-password-reset-token", "password": "a-new-secure-password"},
            PasswordResetAttemptRateLimitExceeded,
        ),
    ),
)
async def test_password_recovery_rate_limits_return_retry_after(
    path: str, payload: dict[str, str], failure: type[RuntimeError]
) -> None:
    recovery = PasswordRecoveryStub()
    limiter = RateLimitStub(failure)
    app = create_app(
        password_recovery=recovery,
        login_rate_limiter=LoginRateLimitStub(),
        password_reset_request_rate_limiter=limiter,
        password_reset_attempt_rate_limiter=limiter,
    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://test") as client:
        response = await client.post(path, json=payload)

    assert response.status_code == 429
    assert response.headers["retry-after"] == "900"


def test_password_reset_openapi_documents_both_422_response_shapes() -> None:
    schema = create_app().openapi()

    response_schema = schema["paths"]["/api/v1/auth/reset-password"]["post"]["responses"]["422"][
        "content"
    ]["application/json"]["schema"]
    assert response_schema["oneOf"] == [
        {"$ref": "#/components/schemas/AuthenticationError"},
        {"$ref": "#/components/schemas/HTTPValidationError"},
    ]


@dataclass
class RecoveryPasswordsStub:
    async def hash_password(self, password: str) -> str:
        if password == "rejected-password":
            raise PasswordPolicyError
        return f"hashed:{password}"

    async def verify_password(self, password: str, password_hash: str) -> bool:
        return password_hash == f"hashed:{password}"


@dataclass
class RecoveryEmailSenderStub:
    async def send_password_reset(
        self, email: str, token: str, requested_at: datetime, timezone: str
    ) -> None:
        return None


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("reset_case", "expected_status"),
    (
        ("success", 204),
        ("invalid", 400),
        ("policy", 422),
        ("validation", 422),
        ("clear_failure", 204),
    ),
)
async def test_password_reset_recovers_shared_login_lockout_only_after_success(
    reset_case: str, expected_status: int, monkeypatch: pytest.MonkeyPatch
) -> None:
    logger = MagicMock()
    monkeypatch.setattr(auth_api, "logger", logger)
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    email = "student@example.com"
    token = "single-use-password-reset-token"
    now = datetime.now(UTC)
    passwords = RecoveryPasswordsStub()

    class LoginLimiter(DatabaseLoginRateLimiter):
        async def clear_failures(self, client_ip: str, email: str) -> None:
            if reset_case == "clear_failure":
                raise RuntimeError("limiter unavailable")
            await super().clear_failures(client_ip, email)

    try:
        async with database.transaction() as session:
            await session.run_sync(
                lambda sync_session: Base.metadata.create_all(sync_session.connection())
            )
            session.add(
                StudentAccount(
                    email=email,
                    name="Student",
                    password_hash=await passwords.hash_password("old-secure-password"),
                    email_verified_at=now,
                    timezone="UTC",
                )
            )
        repository = SqlAlchemyPasswordRecoveryRepository(database)
        assert (
            await repository.create_reset_token(
                email, hash_verification_token(token), now + timedelta(hours=1)
            )
            == "UTC"
        )
        app = create_app(
            database=database,
            login=LoginService(
                SqlAlchemyLoginRepository(database),
                passwords,
                SessionService(SqlAlchemySessionRepository(database)),
            ),
            login_rate_limiter=LoginLimiter(database, email_failure_attempts=10),
            password_recovery=PasswordRecoveryService(
                repository, RecoveryEmailSenderStub(), passwords
            ),
            password_reset_attempt_rate_limiter=RateLimitStub(),
        )
        async with (
            AsyncClient(
                transport=ASGITransport(app=app, client=("203.0.113.10", 123)),
                base_url="https://test",
            ) as attacker,
            AsyncClient(
                transport=ASGITransport(app=app, client=("198.51.100.7", 123)),
                base_url="https://test",
            ) as student,
            AsyncClient(
                transport=ASGITransport(app=app, client=("192.0.2.8", 123)),
                base_url="https://test",
            ) as distributed,
        ):
            for client, attempts in ((attacker, 5), (distributed, 4), (student, 1)):
                for _ in range(attempts):
                    failed = await client.post(
                        "/api/v1/auth/login", json={"email": email, "password": "wrong"}
                    )
                    assert failed.status_code == 401
            locked = await student.post(
                "/api/v1/auth/login", json={"email": email, "password": "old-secure-password"}
            )
            assert locked.status_code == 429
            new_password = {"policy": "rejected-password", "validation": "short"}.get(
                reset_case, "new-secure-password"
            )
            reset = await student.post(
                "/api/v1/auth/reset-password",
                json={
                    "token": "invalid-password-reset-token" if reset_case == "invalid" else token,
                    "password": new_password,
                },
            )
            assert reset.status_code == expected_status
            assert not student.cookies
            async with database.transaction() as session:
                assert list(await session.scalars(select(AuthenticationSession))) == []
                account = (await session.scalars(select(StudentAccount))).one()
                assert account.password_hash == (
                    f"hashed:{new_password}"
                    if expected_status == 204
                    else "hashed:old-secure-password"
                )
            if reset_case == "clear_failure":
                logger.exception.assert_called_once_with(
                    "Could not clear login failures after password reset"
                )
            still_locked = await attacker.post(
                "/api/v1/auth/login", json={"email": email, "password": "new-secure-password"}
            )
            assert still_locked.status_code == 429
            login = await student.post(
                "/api/v1/auth/login", json={"email": email, "password": "new-secure-password"}
            )
            assert login.status_code == (200 if reset_case == "success" else 429)
    finally:
        await database.stop()
