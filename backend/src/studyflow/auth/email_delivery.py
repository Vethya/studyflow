"""Replaceable delivery for authentication-only emails."""

from email.message import EmailMessage
from typing import Protocol
from urllib.parse import urlencode

import aiosmtplib


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
        verification_url = f"{self._public_app_url}/verify-email?{query}"
        message = EmailMessage()
        message["To"] = email
        message["From"] = self._from_address
        message["Subject"] = "Verify your StudyFlow email"
        message.set_content(
            "Verify your StudyFlow email using this single-use link:\n\n"
            f"{verification_url}\n\n"
            "This link expires in eight hours."
        )
        await self._transport.send(message)
