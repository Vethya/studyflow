from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, timedelta, timezone
from email.message import EmailMessage
from html import unescape
from uuid import UUID, uuid4

import pytest

from studyflow.reminders.email import SmtpReminderEmailSender
from studyflow.reminders.service import (
    ReminderCandidate,
    ReminderDispatchService,
    ReminderKind,
)
from studyflow.timezones import to_local_time

NOW = datetime(2026, 10, 20, 8, 0, tzinfo=UTC)


def candidate(
    kind: ReminderKind = ReminderKind.BEFORE,
    *,
    email: str = "student@example.com",
    timezone: str = "UTC",
    title: str = "Essay",
    name: str = "Student",
) -> ReminderCandidate:
    return ReminderCandidate(
        kind=kind,
        account_id=uuid4(),
        session_id=uuid4(),
        email=email,
        name=name,
        timezone=timezone,
        task_title=title,
        starts_at=NOW + timedelta(minutes=20),
        ends_at=NOW + timedelta(minutes=80),
    )


@dataclass
class RepositoryStub:
    candidates: list[ReminderCandidate]
    conflicts: set[UUID] = field(default_factory=set)
    claimed: list[UUID] = field(default_factory=list)
    released: list[UUID] = field(default_factory=list)
    release_error: Exception | None = None
    seen_now: list[datetime] = field(default_factory=list)

    async def due_candidates(self, now: datetime, limit: int) -> list[ReminderCandidate]:
        self.seen_now.append(now)
        return self.candidates[:limit]

    async def claim(self, candidate: ReminderCandidate, sent_at: datetime) -> bool:
        if candidate.session_id in self.conflicts:
            return False
        self.claimed.append(candidate.session_id)
        return True

    async def release(self, candidate: ReminderCandidate) -> None:
        if self.release_error is not None:
            raise self.release_error
        self.released.append(candidate.session_id)


@dataclass
class SenderStub:
    failing: set[str] = field(default_factory=set)
    sent: list[tuple[str, UUID]] = field(default_factory=list)

    async def send_before_session(self, candidate: ReminderCandidate) -> None:
        self._send("before", candidate)

    async def send_after_session(self, candidate: ReminderCandidate) -> None:
        self._send("after", candidate)

    def _send(self, kind: str, candidate: ReminderCandidate) -> None:
        if candidate.email in self.failing:
            raise OSError("relay down")
        self.sent.append((kind, candidate.session_id))


@dataclass
class TransportStub:
    messages: list[EmailMessage] = field(default_factory=list)

    async def send(self, message: EmailMessage) -> None:
        self.messages.append(message)


@pytest.mark.anyio
async def test_one_failed_email_is_released_without_aborting_the_batch() -> None:
    first = candidate(email="bounce@example.com")
    second = candidate(ReminderKind.AFTER)
    third = candidate()
    conflict = candidate()
    repository = RepositoryStub([first, second, conflict, third], conflicts={conflict.session_id})
    sender = SenderStub(failing={"bounce@example.com"})
    service = ReminderDispatchService(repository, sender, clock=lambda: NOW)

    summary = await service.dispatch()

    assert (summary.sent_before, summary.sent_after, summary.skipped, summary.failed) == (
        1,
        1,
        1,
        1,
    )
    assert repository.released == [first.session_id]
    assert sender.sent == [("after", second.session_id), ("before", third.session_id)]


@pytest.mark.anyio
async def test_release_errors_are_contained() -> None:
    repository = RepositoryStub(
        [candidate(email="bounce@example.com"), candidate()],
        release_error=RuntimeError("database gone"),
    )
    sender = SenderStub(failing={"bounce@example.com"})

    summary = await ReminderDispatchService(repository, sender, clock=lambda: NOW).dispatch()

    assert (summary.sent_before, summary.failed) == (1, 1)


@pytest.mark.anyio
async def test_dispatch_stops_claiming_once_the_time_budget_is_spent() -> None:
    ticks = iter([0.0, 0.0, 61.0, 61.0])
    repository = RepositoryStub([candidate(), candidate()])
    service = ReminderDispatchService(
        repository,
        SenderStub(),
        clock=lambda: NOW,
        monotonic=lambda: next(ticks),
        time_budget_seconds=60,
    )

    summary = await service.dispatch()

    assert (summary.sent_before, summary.skipped) == (1, 1)
    assert len(repository.claimed) == 1


@pytest.mark.anyio
async def test_dispatch_normalizes_the_clock_to_utc_and_applies_the_batch_limit() -> None:
    repository = RepositoryStub([candidate(), candidate(), candidate()])
    local_now = NOW.astimezone(timezone(timedelta(hours=7)))
    service = ReminderDispatchService(
        repository, SenderStub(), clock=lambda: local_now, batch_limit=2
    )

    summary = await service.dispatch()

    assert summary.sent_before == 2
    assert repository.seen_now == [NOW]
    assert repository.seen_now[0].tzinfo is UTC


@pytest.mark.parametrize(
    ("timezone", "expected"),
    (
        ("UTC", "08:20 on Tuesday 20 October"),
        ("Asia/Phnom_Penh", "15:20 on Tuesday 20 October"),
        ("America/Los_Angeles", "01:20 on Tuesday 20 October"),
        ("Pacific/Kiritimati", "22:20 on Tuesday 20 October"),
        ("Not/A_Zone", "08:20 on Tuesday 20 October"),
    ),
)
def test_times_are_rendered_in_the_account_timezone(timezone: str, expected: str) -> None:
    local = to_local_time(NOW + timedelta(minutes=20), timezone)
    assert f"{local:%H:%M} on {local:%A} {local.day} {local:%B}" == expected


def test_naive_times_are_treated_as_utc() -> None:
    local = to_local_time(datetime(2026, 1, 5, 9, 5), "Europe/Paris")
    assert (local.hour, local.minute, local.day, local.month) == (10, 5, 5, 1)


@pytest.mark.anyio
@pytest.mark.parametrize("kind", [ReminderKind.BEFORE, ReminderKind.AFTER])
@pytest.mark.parametrize(
    ("timezone", "start", "end", "date"),
    [
        ("UTC", "08:20", "09:20", "Tuesday 20 October"),
        ("Asia/Phnom_Penh", "15:20", "16:20", "Tuesday 20 October"),
        ("Pacific/Honolulu", "22:20", "23:20", "Monday 19 October"),
        ("Not/A_Zone", "08:20", "09:20", "Tuesday 20 October"),
    ],
)
async def test_reminder_email_layout_and_local_times(
    kind: ReminderKind, timezone: str, start: str, end: str, date: str
) -> None:
    transport = TransportStub()
    sender = SmtpReminderEmailSender(
        transport, "no-reply@studyflow.test", "https://studyflow.test/"
    )
    title = "<b>Essay</b> & notes"
    reminder = candidate(kind, timezone=timezone, title=title, name="<i>Dara</i> & friends")
    if kind == ReminderKind.BEFORE:
        await sender.send_before_session(reminder)
    else:
        await sender.send_after_session(reminder)

    [message] = transport.messages
    assert message["To"] == "student@example.com"
    assert message["From"] == "StudyFlow <no-reply@studyflow.test>"
    prefix = "Starting soon:" if kind == ReminderKind.BEFORE else "How did it go?"
    assert message["Subject"] == f"{prefix} {title}"
    assert message.get_content_type() == "multipart/alternative"
    plain, html = list(message.iter_parts())
    assert plain.get_content_type() == "text/plain"
    assert html.get_content_type() == "text/html"
    text_content = plain.get_content()
    html_content = html.get_content()
    assert "Hi <i>Dara</i> & friends," in text_content
    assert title in text_content
    assert f"{start}\u2013{end} (60 min), {date}, {timezone}" in text_content
    for url in (sender.calendar_url, sender.settings_url):
        assert url in text_content
        assert f'href="{url}"' in html_content
    assert "&lt;b&gt;Essay&lt;/b&gt; &amp; notes" in html_content
    assert "Hi &lt;i&gt;Dara&lt;/i&gt; &amp; friends," in html_content
    assert "<b>Essay</b>" not in html_content
    assert "<i>Dara</i>" not in html_content
    assert f'>{start}<span class="sf-faint"' in html_content
    assert f"\u2013{end}</span>" in html_content
    readable_html = unescape(html_content)
    assert f"{date} · " in readable_html
    assert "60 min</span>" in html_content
    assert f"· {timezone}</p>" in html_content
    assert "Today" not in html_content
    assert "IBM Plex Mono" in readable_html
    assert "@media (prefers-color-scheme:dark)" in html_content
    assert 'src="https://studyflow.test/brand/email-mark.png"' in html_content
    assert "Change or turn off reminders</a>" in html_content
    if kind == ReminderKind.BEFORE:
        assert "Your next session starts soon" in html_content
        assert "Hi <i>Dara</i> & friends, here's what you planned." in readable_html
        assert "60 minutes planned. Open your calendar to see what's next." in readable_html
        assert ">Starting soon</p>" in html_content
        assert ">Open calendar</a>" in html_content
        assert ">Finished it</p>" not in html_content
    else:
        assert ">Ended</p>" in html_content
        assert "Record how it went so the rest of your plan stays accurate." in readable_html
        assert (
            "your session just ended. Record how it went and StudyFlow will adjust "
            in readable_html
        )
        assert ">Record how it went</a>" in html_content
        for label, hint in (
            ("Finished it", "The work for this session is done."),
            ("Partly done", "I worked, but there is more left."),
            ("Didn't study", "This session didn't happen."),
        ):
            assert f">{label}</p>" in readable_html
            assert hint in readable_html
            assert f"{label}: {hint}" in text_content


@pytest.mark.anyio
@pytest.mark.parametrize("kind", [ReminderKind.BEFORE, ReminderKind.AFTER])
async def test_reminder_links_are_escaped_and_naive_times_use_utc(kind: ReminderKind) -> None:
    transport = TransportStub()
    sender = SmtpReminderEmailSender(
        transport, "no-reply@studyflow.test", 'https://studyflow.test/a"b&c/'
    )
    reminder = replace(
        candidate(kind, timezone="Asia/Phnom_Penh", title="Essay\nchapter 2"),
        starts_at=datetime(2026, 1, 5, 9, 5),
        ends_at=datetime(2026, 1, 5, 10, 5),
    )
    if kind == ReminderKind.BEFORE:
        await sender.send_before_session(reminder)
    else:
        await sender.send_after_session(reminder)

    [message] = transport.messages
    assert message["Subject"].endswith("Essay chapter 2")
    plain, html = list(message.iter_parts())
    assert "16:05\u201317:05 (60 min), Monday 5 January, Asia/Phnom_Penh" in plain.get_content()
    for path in ("calendar", "settings"):
        assert f'https://studyflow.test/a"b&c/{path}' in plain.get_content()
        assert f'href="https://studyflow.test/a&#34;b&amp;c/{path}"' in html.get_content()
        assert f'href="https://studyflow.test/a"b&c/{path}"' not in html.get_content()


@pytest.mark.anyio
async def test_after_session_email_asks_how_it_went() -> None:
    transport = TransportStub()
    sender = SmtpReminderEmailSender(transport, "no-reply@studyflow.test", "https://studyflow.test")

    await sender.send_after_session(candidate(ReminderKind.AFTER, title="x" * 200, name=" "))

    [message] = transport.messages
    assert message["Subject"].startswith("How did it go? xxx")
    assert message["Subject"].endswith("...")
    assert len(message["Subject"]) < 140
    plain = message.get_body(("plain",))
    assert plain is not None
    content = plain.get_content()
    assert "Hi there," in content
    assert "08:20\u201309:20 (60 min), Tuesday 20 October, UTC" in content
    assert "Record how it went:\nhttps://studyflow.test/calendar" in content
