from dataclasses import dataclass, field

import httpx
import pytest
from httpx import ASGITransport, AsyncClient

from studyflow.app import create_app
from studyflow.auth.passwords import PasswordPolicyError
from studyflow.auth.rate_limits import (
    PasswordResetAttemptRateLimitExceeded,
    PasswordResetRequestRateLimitExceeded,
)
from studyflow.auth.recovery import InvalidPasswordResetTokenError
from studyflow.auth.registration import DeferredTasks


@dataclass
class PasswordRecoveryStub:
    requests: list[str] = field(default_factory=list)
    resets: list[tuple[str, str]] = field(default_factory=list)
    invalid: bool = False
    policy_failure: bool = False
    unavailable: bool = False

    async def request_reset(self, email: str, deferred_tasks: DeferredTasks) -> None:
        self.requests.append(email)

    async def reset_password(self, token: str, password: str) -> None:
        self.resets.append((token, password))
        if self.invalid:
            raise InvalidPasswordResetTokenError
        if self.policy_failure:
            raise PasswordPolicyError
        if self.unavailable:
            raise httpx.ConnectError("unavailable")


@dataclass
class RateLimitStub:
    failure: type[RuntimeError] | None = None

    async def check(self, client_ip: str, key: str) -> None:
        if self.failure is not None:
            raise self.failure


@pytest.mark.anyio
async def test_password_reset_request_is_non_enumerating() -> None:
    recovery = PasswordRecoveryStub()
    app = create_app(
        password_recovery=recovery,
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
    app = create_app(
        password_recovery=recovery,
        password_reset_request_rate_limiter=RateLimitStub(),
        password_reset_attempt_rate_limiter=RateLimitStub(),
    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://test") as client:
        invalid = await client.post(
            "/api/v1/auth/reset-password",
            json={"token": "single-use-password-reset-token", "password": "a-new-secure-password"},
        )
        recovery.invalid = False
        valid = await client.post(
            "/api/v1/auth/reset-password",
            json={"token": "single-use-password-reset-token", "password": "a-new-secure-password"},
        )

    assert invalid.status_code == 400
    assert valid.status_code == 204


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
