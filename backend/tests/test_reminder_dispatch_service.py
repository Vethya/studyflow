from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta, timezone
from email.message import EmailMessage
from uuid import UUID, uuid4

import pytest

from studyflow.reminders.email import SmtpReminderEmailSender, format_local_time
from studyflow.reminders.service import (
    ReminderCandidate,
    ReminderDispatchService,
    ReminderKind,
)

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
    assert format_local_time(NOW + timedelta(minutes=20), timezone) == expected


def test_naive_times_are_treated_as_utc() -> None:
    assert format_local_time(datetime(2026, 1, 5, 9, 5), "Europe/Paris") == (
        "10:05 on Monday 5 January"
    )


@pytest.mark.anyio
async def test_before_session_email_has_text_html_and_calendar_link() -> None:
    transport = TransportStub()
    sender = SmtpReminderEmailSender(
        transport, "no-reply@studyflow.test", "https://studyflow.test/"
    )

    await sender.send_before_session(
        candidate(timezone="Asia/Phnom_Penh", title="Essay <draft>\nchapter 2", name="Dara")
    )

    [message] = transport.messages
    assert message["To"] == "student@example.com"
    assert message["From"] == "no-reply@studyflow.test"
    assert message["Subject"] == "Starting soon: Essay <draft> chapter 2"
    plain = message.get_body(("plain",))
    html = message.get_body(("html",))
    assert plain is not None and html is not None
    text_content = plain.get_content()
    html_content = html.get_content()
    assert "Hi Dara," in text_content
    assert "starts at 15:20 on Tuesday 20 October (Asia/Phnom_Penh)" in text_content
    assert "planned for 60 minutes" in text_content
    assert "https://studyflow.test/calendar" in text_content
    assert "https://studyflow.test/settings" in text_content
    assert "Essay &lt;draft&gt; chapter 2" in html_content
    assert "<draft>" not in html_content
    assert '<a href="https://studyflow.test/calendar">' in html_content


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
    assert "ended at 09:20 on Tuesday 20 October (UTC)" in content
    assert "Record how it went:\nhttps://studyflow.test/calendar" in content
