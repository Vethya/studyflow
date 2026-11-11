"""Replaceable delivery for authentication-only emails."""

from datetime import datetime
from email.message import EmailMessage
from typing import Protocol
from urllib.parse import urlencode

import aiosmtplib
from markupsafe import Markup

from studyflow.mail.layout import LIGHT, button, fallback_link, heading, paragraph, render_layout
from studyflow.mail.message import build_message
from studyflow.timezones import to_local_time


class EmailTransport(Protocol):
    async def send(self, message: EmailMessage) -> None: ...


class AiosmtplibEmailTransport:
    def __init__(
        self,
        hostname: str,
        port: int,
        *,
        username: str | None = None,
        password: str | None = None,
        start_tls: bool = False,
        timeout_seconds: float = 10,
    ) -> None:
        self._hostname = hostname
        self._port = port
        self._username = username
        self._password = password
        self._start_tls = start_tls
        self._timeout_seconds = timeout_seconds

    async def send(self, message: EmailMessage) -> None:
        await aiosmtplib.send(
            message,
            hostname=self._hostname,
            port=self._port,
            username=self._username,
            password=self._password,
            start_tls=self._start_tls,
            timeout=self._timeout_seconds,
        )


class SmtpAuthenticationEmailSender:
    def __init__(
        self,
        transport: EmailTransport,
        from_address: str,
        public_app_url: str,
    ) -> None:
        self._transport = transport
        self._from_address = from_address
        self._public_app_url = public_app_url.rstrip("/")

    async def send_verification(self, email: str, token: str) -> None:
        query = urlencode({"token": token})
        url = f"{self._public_app_url}/verify-email?{query}"
        await self._send(
            email,
            subject="Confirm your email for StudyFlow",
            title="Confirm your email",
            preheader="One click to finish setting up your account. The link works for 8 hours.",
            body=heading("Confirm your email")
            + paragraph(
                "Confirm this address and you can start adding coursework. StudyFlow will plan "
                "your study sessions around the hours you're free.",
                top=14,
            )
            + button("Confirm email", url)
            + paragraph("The link works for 8 hours.", size=14)
            + fallback_link(url),
            text="Confirm your email\n\nConfirm this address and you can start adding coursework."
            f"\n\nConfirm email:\n{url}\n\nThe link works for 8 hours.\n\n"
            "If you didn't sign up for StudyFlow, ignore this email "
            "and no account will be activated.",
            reason=f"You're getting this because someone signed up for StudyFlow with {email}. "
            "If it wasn't you, ignore this email and no account will be activated.",
        )

    async def send_password_reset(
        self, email: str, token: str, requested_at: datetime, timezone: str
    ) -> None:
        query = urlencode({"token": token})
        url = f"{self._public_app_url}/reset-password?{query}"
        local = to_local_time(requested_at, timezone)
        requested = (
            f"Requested at {local:%H:%M} on {local:%A} {local.day} {local:%B} ({local.tzinfo})."
        )
        await self._send(
            email,
            subject="Reset your StudyFlow password",
            title="Reset your password",
            preheader="Use this link within the hour. If you didn't ask for it, nothing changes.",
            body=heading("Reset your password")
            + paragraph(
                "Someone asked to reset the password for your StudyFlow account. "
                "Choose a new one with the button below.",
                top=14,
            )
            + button("Choose a new password", url)
            + paragraph("The link works for 1 hour.", size=14)
            + paragraph(requested, size=14)
            + paragraph(
                Markup(
                    '<strong class="sf-ink" style="color:{};">Didn\'t ask for this?</strong> '
                ).format(LIGHT["ink"])
                + "Ignore this email. Your password stays the same.",
                size=14,
                top=24,
            )
            + fallback_link(url),
            text="Reset your password\n\nSomeone asked to reset the password for your StudyFlow "
            f"account.\n\nChoose a new password:\n{url}\n\nThis link expires in one hour.\n\n"
            f"{requested}\n\n"
            "Didn't ask for this? Ignore this email. Your password stays the same.",
            reason=f"Sent to {email} because a password reset was requested for this account. "
            "StudyFlow will never ask for your password by email.",
        )

    async def _send(
        self,
        email: str,
        *,
        subject: str,
        title: str,
        preheader: str,
        body: Markup,
        text: str,
        reason: str,
    ) -> None:
        message = build_message(
            to=email,
            from_address=self._from_address,
            subject=subject,
            text=text,
            html=render_layout(
                title=title,
                preheader=preheader,
                body=body,
                reason=reason,
                public_app_url=self._public_app_url,
            ),
        )
        await self._transport.send(message)
