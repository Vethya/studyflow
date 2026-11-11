"""Plain-text and HTML study reminder emails."""

from markupsafe import Markup

from studyflow.auth.email_delivery import EmailTransport
from studyflow.mail.layout import (
    LIGHT,
    button,
    heading,
    outcome_row,
    paragraph,
    render_layout,
    session_card,
)
from studyflow.mail.message import build_message
from studyflow.reminders.service import ReminderCandidate
from studyflow.timezones import to_local_time

MAX_SUBJECT_TITLE_LENGTH = 120
OUTCOMES = (
    ("Finished it", "The work for this session is done."),
    ("Partly done", "I worked, but there is more left."),
    ("Didn't study", "This session didn't happen."),
)


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
        await self._send(
            candidate,
            subject=f"Starting soon: {title}",
            title="Your next session starts soon",
            preheader=f"{_duration_minutes(candidate)} minutes planned. "
            "Open your calendar to see what's next.",
            intro="here's what you planned.",
            status="Starting soon",
            link_label="Open calendar",
        )

    async def send_after_session(self, candidate: ReminderCandidate) -> None:
        title = _single_line(candidate.task_title, MAX_SUBJECT_TITLE_LENGTH)
        await self._send(
            candidate,
            subject=f"How did it go? {title}",
            title="How did it go?",
            preheader="Record how it went so the rest of your plan stays accurate.",
            intro="your session just ended. Record how it went and StudyFlow will adjust "
            "the rest of your plan.",
            status="Ended",
            link_label="Record how it went",
            outcomes=OUTCOMES,
        )

    async def _send(
        self,
        candidate: ReminderCandidate,
        *,
        subject: str,
        title: str,
        preheader: str,
        intro: str,
        status: str,
        link_label: str,
        outcomes: tuple[tuple[str, str], ...] = (),
    ) -> None:
        name = _single_line(candidate.name, 200) or "there"
        start = to_local_time(candidate.starts_at, candidate.timezone)
        end = to_local_time(candidate.ends_at, candidate.timezone)
        date = f"{start:%A} {start.day} {start:%B}"
        minutes = _duration_minutes(candidate)
        footer = "You get these because study reminders are on. Change or turn them off:"
        text_body = "\n\n".join(
            (
                f"Hi {name},",
                title,
                intro[0].upper() + intro[1:],
                f"{start:%H:%M}\u2013{end:%H:%M} ({minutes} min), {date}, {candidate.timezone}"
                f"\n{candidate.task_title}",
                *(f"{label}: {hint}" for label, hint in outcomes),
                f"{link_label}:\n{self.calendar_url}",
                f"{footer}\n{self.settings_url}",
            )
        )
        body = (
            heading(title)
            + paragraph(f"Hi {name}, {intro}", top=14)
            + session_card(
                start=f"{start:%H:%M}",
                end=f"{end:%H:%M}",
                minutes=minutes,
                title=candidate.task_title,
                date=date,
                tz=candidate.timezone,
                status=status,
            )
        )
        if outcomes:
            body += Markup(
                '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
                'style="margin:24px 0 0;border-collapse:collapse;">{}</table>'
            ).format(Markup("").join(outcome_row(*outcome) for outcome in outcomes))
        reason = Markup(
            'You get these because study reminders are on. <a class="sf-faint" href="{}" '
            'style="color:{};">Change or turn off reminders</a>.'
        ).format(self.settings_url, LIGHT["faint"])
        message = build_message(
            to=candidate.email,
            from_address=self._from_address,
            subject=subject,
            text=text_body,
            html=render_layout(
                title=title,
                preheader=preheader,
                body=body + button(link_label, self.calendar_url),
                reason=reason,
                public_app_url=self._public_app_url,
            ),
        )
        await self._transport.send(message)
