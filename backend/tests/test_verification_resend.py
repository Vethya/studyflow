from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

import pytest

from studyflow.auth.registration import DeferredTasks
from studyflow.auth.resend import VerificationResendService


@dataclass
class ResendRepositoryStub:
    eligible: bool
    calls: list[tuple[str, str, datetime]] = field(default_factory=list)

    async def rotate(self, email: str, token_hash: str, expires_at: datetime) -> bool:
        self.calls.append((email, token_hash, expires_at))
        return self.eligible


@dataclass
class EmailSenderStub:
    calls: list[tuple[str, str]] = field(default_factory=list)

    async def send_verification(self, email: str, token: str) -> None:
        self.calls.append((email, token))


@dataclass
class DeferredTasksStub(DeferredTasks):
    calls: list[tuple[object, tuple[object, ...]]] = field(default_factory=list)

    def add_task(self, function: object, *arguments: object) -> None:
        self.calls.append((function, arguments))


@pytest.mark.anyio
async def test_resend_rotates_an_eight_hour_token_and_defers_email() -> None:
    now = datetime(2026, 7, 29, 12, tzinfo=UTC)
    repository = ResendRepositoryStub(True)
    sender = EmailSenderStub()
    deferred = DeferredTasksStub()
    service = VerificationResendService(
        repository,
        sender,
        token_factory=lambda: "replacement-verification-token",
        clock=lambda: now,
    )

    await service.resend(" STUDENT@example.com ", deferred)

    assert repository.calls == [
        (
            "student@example.com",
            "ebaa834c8f7ada9aaee9e78f301850735239292502573957bc64b58739b4cc20",
            now + timedelta(hours=8),
        )
    ]
    assert deferred.calls == [
        (sender.send_verification, ("student@example.com", "replacement-verification-token"))
    ]
