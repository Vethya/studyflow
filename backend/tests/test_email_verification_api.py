from dataclasses import dataclass, field

import pytest
from httpx import ASGITransport, AsyncClient

from studyflow.app import create_app
from studyflow.auth.rate_limits import EmailVerificationRateLimitExceeded


@dataclass
class EmailVerificationStub:
    signup_token: str | None = "short-lived-signup-token"
    tokens: list[str] = field(default_factory=list)

    async def verify(self, token: str) -> str | None:
        self.tokens.append(token)
        return self.signup_token


@dataclass
class EmailVerificationRateLimitStub:
    error: Exception | None = None

    async def check(self, client_ip: str, token: str) -> None:
        if self.error is not None:
            raise self.error


@pytest.mark.anyio
async def test_email_verification_returns_a_short_lived_signup_token() -> None:
    verification = EmailVerificationStub()
    application = create_app(
        email_verification=verification,
        email_verification_rate_limiter=EmailVerificationRateLimitStub(),
    )

    async with AsyncClient(
        transport=ASGITransport(app=application), base_url="http://test"
    ) as client:
        response = await client.post(
            "/api/v1/auth/verify-email", json={"token": "single-use-verification-token"}
        )

    assert response.status_code == 200
    assert response.json() == {"signup_token": "short-lived-signup-token"}


@pytest.mark.anyio
async def test_email_verification_rejects_an_invalid_or_expired_token() -> None:
    application = create_app(
        email_verification=EmailVerificationStub(signup_token=None),
        email_verification_rate_limiter=EmailVerificationRateLimitStub(),
    )
    async with AsyncClient(
        transport=ASGITransport(app=application), base_url="http://test"
    ) as client:
        response = await client.post(
            "/api/v1/auth/verify-email", json={"token": "invalid-verification-token"}
        )
    assert response.status_code == 400


@pytest.mark.anyio
async def test_email_verification_is_rate_limited_before_token_lookup() -> None:
    verification = EmailVerificationStub()
    application = create_app(
        email_verification=verification,
        email_verification_rate_limiter=EmailVerificationRateLimitStub(
            error=EmailVerificationRateLimitExceeded()
        ),
    )
    async with AsyncClient(
        transport=ASGITransport(app=application), base_url="http://test"
    ) as client:
        response = await client.post(
            "/api/v1/auth/verify-email", json={"token": "single-use-verification-token"}
        )
    assert response.status_code == 429
    assert verification.tokens == []
