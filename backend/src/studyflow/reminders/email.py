"""Plain-text and HTML study reminder emails."""

from datetime import UTC, datetime, tzinfo
from email.message import EmailMessage
from html import escape
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from studyflow.auth.email_delivery import EmailTransport
from studyflow.reminders.service import ReminderCandidate

MAX_SUBJECT_TITLE_LENGTH = 120


def _zone(timezone: str) -> tzinfo:
    try:
        return ZoneInfo(timezone)
    except (ZoneInfoNotFoundError, ValueError):
        return UTC


def format_local_time(value: datetime, timezone: str) -> str:
    """Render an instant in the account timezone, e.g. "14:30 on Monday 20 October"."""
    aware = value if value.tzinfo is not None else value.replace(tzinfo=UTC)
    local = aware.astimezone(_zone(timezone))
    return f"{local:%H:%M} on {local:%A} {local.day} {local:%B}"


def _single_line(value: str, limit: int) -> str:
    collapsed = " ".join(value.split())
    return collapsed if len(collapsed) <= limit else f"{collapsed[: limit - 3].rstrip()}..."


def _duration_minutes(candidate: ReminderCandidate) -> int:
    return max(1, round((candidate.ends_at - candidate.starts_at).total_seconds() / 60))


class SmtpReminderEmailSender:
    def __init__(self, transport: EmailTransport, from_address: str, public_app_url: str) -> None:
        self._transport = transport
        self._from_address = from_address
        self._public_app_url = public_app_url.rstrip("/")

    @property
    def calendar_url(self) -> str:
        return f"{self._public_app_url}/calendar"

    @property
    def settings_url(self) -> str:
        return f"{self._public_app_url}/settings"

    async def send_before_session(self, candidate: ReminderCandidate) -> None:
        title = _single_line(candidate.task_title, MAX_SUBJECT_TITLE_LENGTH)
        starts = format_local_time(candidate.starts_at, candidate.timezone)
        intro = (
            f'Your study session for "{title}" starts at {starts} ({candidate.timezone}). '
            f"It is planned for {_duration_minutes(candidate)} minutes."
        )
        await self._send(
            candidate,
            subject=f"Starting soon: {title}",
            paragraphs=(intro,),
            link_label="Open your StudyFlow calendar",
        )

    async def send_after_session(self, candidate: ReminderCandidate) -> None:
        title = _single_line(candidate.task_title, MAX_SUBJECT_TITLE_LENGTH)
        ended = format_local_time(candidate.ends_at, candidate.timezone)
        intro = (
            f'Your study session for "{title}" ended at {ended} ({candidate.timezone}). '
            "How did it go?"
        )
        follow_up = (
            "Record whether you completed it, need more time, or missed it so StudyFlow "
            "can keep your plan accurate."
        )
        await self._send(
            candidate,
            subject=f"How did it go? {title}",
            paragraphs=(intro, follow_up),
            link_label="Record how it went",
        )

    async def _send(
        self,
        candidate: ReminderCandidate,
        *,
        subject: str,
        paragraphs: tuple[str, ...],
        link_label: str,
    ) -> None:
        name = _single_line(candidate.name, 200) or "there"
        footer = (
            "You are receiving this because study reminders are turned on. "
            "You can change or turn them off in StudyFlow settings:"
        )
        text_body = "\n\n".join(
            (
                f"Hi {name},",
                *paragraphs,
                f"{link_label}:\n{self.calendar_url}",
                f"{footer}\n{self.settings_url}",
            )
        )
        html_paragraphs = "".join(f"<p>{escape(paragraph)}</p>" for paragraph in paragraphs)
        html_body = (
            "<!DOCTYPE html><html><body>"
            f"<p>Hi {escape(name)},</p>"
            f"{html_paragraphs}"
            f'<p><a href="{escape(self.calendar_url)}">{escape(link_label)}</a></p>'
            f'<p><small>{escape(footer)} <a href="{escape(self.settings_url)}">'
            "StudyFlow settings</a></small></p>"
            "</body></html>"
        )
        message = EmailMessage()
        message["To"] = candidate.email
        message["From"] = self._from_address
        message["Subject"] = subject
        message.set_content(text_body)
        message.add_alternative(html_body, subtype="html")
        await self._transport.send(message)
