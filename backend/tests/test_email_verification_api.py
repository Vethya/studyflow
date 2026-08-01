from dataclasses import dataclass, field

import pytest
from httpx import ASGITransport, AsyncClient

from studyflow.app import create_app
from studyflow.auth.rate_limits import EmailVerificationRateLimitExceeded


@dataclass
class EmailVerificationStub:
    valid: bool = True
    tokens: list[str] = field(default_factory=list)

    async def verify(self, token: str) -> bool:
        self.tokens.append(token)
        return self.valid


@dataclass
class EmailVerificationRateLimitStub:
    error: Exception | None = None

    async def check(self, client_ip: str, token: str) -> None:
        if self.error is not None:
            raise self.error


@pytest.mark.anyio
async def test_email_verification_consumes_a_valid_single_use_token() -> None:
    verification = EmailVerificationStub()
    application = create_app(
        email_verification=verification,
        email_verification_rate_limiter=EmailVerificationRateLimitStub(),
    )
    transport = ASGITransport(app=application)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/v1/auth/verify-email",
            json={"token": "single-use-verification-token"},
        )

    assert response.status_code == 204
    assert response.content == b""
    assert verification.tokens == ["single-use-verification-token"]


@pytest.mark.anyio
async def test_email_verification_rejects_an_invalid_or_expired_token() -> None:
    verification = EmailVerificationStub(valid=False)
    transport = ASGITransport(
        app=create_app(
            email_verification=verification,
            email_verification_rate_limiter=EmailVerificationRateLimitStub(),
        )
    )

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/v1/auth/verify-email",
            json={"token": "invalid-verification-token"},
        )

    assert response.status_code == 400
    assert response.json() == {"detail": "Verification token is invalid or expired"}


@pytest.mark.anyio
async def test_email_verification_is_rate_limited_before_token_lookup() -> None:
    verification = EmailVerificationStub()
    rate_limit = EmailVerificationRateLimitStub(error=EmailVerificationRateLimitExceeded())
    transport = ASGITransport(
        app=create_app(
            email_verification=verification,
            email_verification_rate_limiter=rate_limit,
        )
    )

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/v1/auth/verify-email",
            json={"token": "single-use-verification-token"},
        )

    assert response.status_code == 429
    assert response.headers["Retry-After"] == "900"
    assert verification.tokens == []
