from dataclasses import dataclass, field
from email.message import EmailMessage

import pytest

from studyflow.auth.email_delivery import (
    AiosmtplibEmailTransport,
    SmtpAuthenticationEmailSender,
)


@dataclass
class EmailTransportStub:
    messages: list[EmailMessage] = field(default_factory=list)

    async def send(self, message: EmailMessage) -> None:
        self.messages.append(message)


@pytest.mark.anyio
async def test_verification_email_contains_only_the_single_use_link() -> None:
    transport = EmailTransportStub()
    sender = SmtpAuthenticationEmailSender(
        transport=transport,
        from_address="no-reply@studyflow.test",
        public_app_url="https://studyflow.test",
    )

    await sender.send_verification("student@example.com", "a+b/=")

    [message] = transport.messages
    assert message["To"] == "student@example.com"
    assert message["From"] == "no-reply@studyflow.test"
    assert message["Subject"] == "Verify your StudyFlow email"
    assert "https://studyflow.test/verify-email?token=a%2Bb%2F%3D" in message.get_content()


@pytest.mark.anyio
async def test_smtp_transport_forwards_security_and_credential_settings(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[EmailMessage, dict[str, object]]] = []

    async def fake_send(
        message: EmailMessage,
        **options: object,
    ) -> tuple[dict[str, object], str]:
        calls.append((message, options))
        return {}, "ok"

    monkeypatch.setattr("studyflow.auth.email_delivery.aiosmtplib.send", fake_send)
    message = EmailMessage()
    transport = AiosmtplibEmailTransport(
        hostname="smtp.example.com",
        port=587,
        username="mailer",
        password="secret",
        start_tls=True,
        timeout_seconds=7,
    )

    await transport.send(message)

    assert calls == [
        (
            message,
            {
                "hostname": "smtp.example.com",
                "port": 587,
                "username": "mailer",
                "password": "secret",
                "start_tls": True,
                "timeout": 7,
            },
        )
    ]
