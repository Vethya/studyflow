from dataclasses import dataclass, field

import pytest
from httpx import ASGITransport, AsyncClient

from studyflow.app import create_app
from studyflow.auth.registration import DeferredTasks


@dataclass
class VerificationResendStub:
    emails: list[str] = field(default_factory=list)

    async def resend(self, email: str, deferred_tasks: DeferredTasks) -> None:
        self.emails.append(email)


@dataclass
class RateLimitStub:
    async def check(self, client_ip: str, email: str) -> None:
        return None


@pytest.mark.anyio
async def test_verification_resend_returns_a_non_enumerating_response() -> None:
    resend = VerificationResendStub()
    transport = ASGITransport(
        app=create_app(
            verification_resend=resend,
            verification_resend_rate_limiter=RateLimitStub(),
        )
    )

    async with AsyncClient(transport=transport, base_url="https://test") as client:
        response = await client.post(
            "/api/v1/auth/resend-verification",
            json={"email": "Student@Example.com"},
        )

    assert response.status_code == 202
    assert response.json() == {
        "message": "If the address is eligible, a verification email has been sent."
    }
    assert resend.emails == ["Student@example.com"]
