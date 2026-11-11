"""Shared multipart message construction."""

from email.message import EmailMessage
from email.utils import formataddr


def build_message(
    *, to: str, from_address: str, subject: str, text: str, html: str
) -> EmailMessage:
    message = EmailMessage()
    message["To"] = to
    message["From"] = formataddr(("StudyFlow", from_address))
    message["Subject"] = subject
    message.set_content(text)
    message.add_alternative(html, subtype="html")
    return message
