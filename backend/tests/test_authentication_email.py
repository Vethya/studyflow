from dataclasses import dataclass, field
from email.message import EmailMessage
from html import unescape

import pytest

from studyflow.auth.email_delivery import (
    AiosmtplibEmailTransport,
    SmtpAuthenticationEmailSender,
)
from studyflow.mail.layout import button, fallback_link, heading, paragraph, render_layout


@dataclass
class EmailTransportStub:
    messages: list[EmailMessage] = field(default_factory=list)

    async def send(self, message: EmailMessage) -> None:
        self.messages.append(message)


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("path", "subject", "preheader", "expiry", "html_expiry"),
    [
        (
            "verify-email",
            "Confirm your email for StudyFlow",
            "One click to finish setting up your account. The link works for 8 hours.",
            "The link works for 8 hours.",
            "The link works for 8 hours.",
        ),
        (
            "reset-password",
            "Reset your StudyFlow password",
            "Use this link within the hour. If you didn't ask for it, nothing changes.",
            "expires in one hour",
            "The link works for 1 hour.",
        ),
    ],
)
async def test_authentication_email_contains_multipart_link_and_expiry(
    path: str, subject: str, preheader: str, expiry: str, html_expiry: str
) -> None:
    transport = EmailTransportStub()
    sender = SmtpAuthenticationEmailSender(
        transport=transport,
        from_address="no-reply@studyflow.test",
        public_app_url="https://studyflow.test/",
    )

    if path == "verify-email":
        await sender.send_verification("student@example.com", "a+b/=")
    else:
        await sender.send_password_reset("student@example.com", "a+b/=")

    [message] = transport.messages
    assert message["To"] == "student@example.com"
    assert message["From"] == "StudyFlow <no-reply@studyflow.test>"
    assert message["Subject"] == subject
    assert message.get_content_type() == "multipart/alternative"
    plain, html = list(message.iter_parts())
    assert plain.get_content_type() == "text/plain"
    assert html.get_content_type() == "text/html"
    url = f"https://studyflow.test/{path}?token=a%2Bb%2F%3D"
    assert url in plain.get_content()
    assert expiry in plain.get_content()
    html_body = html.get_content()
    assert f'href="{url}"' in html_body
    assert url in html_body
    assert html_expiry in html_body
    assert preheader in unescape(html_body)
    assert "student@example.com" in html_body
    assert 'src="https://studyflow.test/brand/email-mark.png" width="28" height="28"' in html_body
    assert 'href="https://studyflow.test"' in html_body
    assert ">studyflow.test</a>" in html_body
    assert "@media (prefers-color-scheme:dark)" in html_body
    assert "@media (max-width:620px)" in html_body
    assert ".sf-btn{background:#E7E9EE!important}" in html_body
    assert "<!--[if mso]><v:roundrect" in html_body
    assert "fonts.googleapis.com" not in html_body
    assert "<link" not in html_body
    assert "studyflow.example.com" not in html_body
    for ledger_label in ("Account:", "Link expires:", "Requested:", "Can be used:"):
        assert ledger_label not in plain.get_content()
    for ledger_label in (">Account<", ">Link expires<", ">Requested<", ">Can be used<"):
        assert ledger_label not in html_body


def test_layout_components_escape_text_and_urls_without_escaping_composed_markup() -> None:
    text = '<script>alert("x")</script>'
    url = 'https://studyflow.test/?token=a%2Bb%2F%3D&next="<script>"'
    escaped_url = "https://studyflow.test/?token=a%2Bb%2F%3D&amp;next=&#34;&lt;script&gt;&#34;"
    body = heading(text) + paragraph(text) + button(text, url) + fallback_link(url)

    html = render_layout(
        title=text,
        preheader=text,
        body=body,
        reason=text,
        public_app_url="https://app.studyflow.test/study/",
    )

    assert text not in html
    assert "&lt;script&gt;alert(&#34;x&#34;)&lt;/script&gt;" in html
    assert "&amp;lt;script" not in html
    assert html.count(f'href="{escaped_url}"') == 3  # VML, button, fallback.
    assert f">{escaped_url}</a>" in html
    assert '<h1 class="sf-ink"' in html
    assert 'src="https://app.studyflow.test/study/brand/email-mark.png"' in html
    assert 'href="https://app.studyflow.test/study"' in html
    assert ">app.studyflow.test</a>" in html


def test_layout_escapes_a_plain_string_body_and_app_url() -> None:
    html = render_layout(
        title="Title",
        preheader="Preview",
        body="<script>bad</script>",
        reason="Reason",
        public_app_url='https://studyflow.test/<img src=x onerror="bad">',
    )

    assert "&lt;script&gt;bad&lt;/script&gt;" in html
    assert "<script>" not in html
    assert 'src="https://studyflow.test/&lt;img src=x onerror=&#34;bad&#34;&gt;/brand/' in html


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
