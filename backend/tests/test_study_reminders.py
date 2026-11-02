from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage
from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select, text

from studyflow.accounts.repositories import SqlAlchemyAccountDeletionRepository
from studyflow.database import Base, Database
from studyflow.database.models import (
    AcademicTask,
    AuthenticationAccountDeletionChallenge,
    ReminderDelivery,
    ReminderPreference,
    ScheduleProposal,
    StudentAccount,
    StudySession,
    StudySessionOutcome,
)
from studyflow.reminders.email import SmtpReminderEmailSender
from studyflow.reminders.preferences import ReminderPreferences
from studyflow.reminders.repositories import (
    SqlAlchemyReminderDispatchRepository,
    SqlAlchemyReminderPreferencesRepository,
)
from studyflow.reminders.service import ReminderCandidate, ReminderDispatchService, ReminderKind

NOW = datetime(2026, 10, 20, 8, 0, tzinfo=UTC)
OPTED_IN = ReminderPreferences(email_enabled=True)


@dataclass
class FlakyTransport:
    fail_for: set[str] = field(default_factory=set)
    messages: list[EmailMessage] = field(default_factory=list)

    async def send(self, message: EmailMessage) -> None:
        if message["To"] in self.fail_for:
            raise OSError("SMTP relay unavailable")
        self.messages.append(message)


@pytest.fixture
async def database() -> AsyncIterator[Database]:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    async with database.transaction() as session:
        await session.run_sync(
            lambda sync_session: Base.metadata.create_all(sync_session.connection())
        )
    try:
        yield database
    finally:
        await database.stop()


async def add_account(
    database: Database,
    email: str,
    *,
    verified: bool = True,
    timezone: str = "UTC",
    reminders: ReminderPreferences | None = OPTED_IN,
) -> UUID:
    account_id = uuid4()
    async with database.transaction() as session:
        session.add(
            StudentAccount(
                id=account_id,
                email=email,
                name="Student",
                password_hash="$argon2id$hash",
                email_verified_at=NOW - timedelta(days=1) if verified else None,
                timezone=timezone,
            )
        )
        await session.flush()
        if reminders is not None:
            session.add(
                ReminderPreference(
                    account_id=account_id,
                    email_enabled=reminders.email_enabled,
                    before_session_minutes=reminders.before_session_minutes,
                    after_session=reminders.after_session,
                )
            )
    return account_id


async def add_session(
    database: Database,
    account_id: UUID,
    starts_at: datetime,
    *,
    minutes: int = 60,
    title: str = "Essay",
    proposed: bool = False,
    invalidated: bool = False,
    completed_task: bool = False,
    outcome: bool = False,
) -> UUID:
    task_id = uuid4()
    session_id = uuid4()
    async with database.transaction() as session:
        session.add(
            AcademicTask(
                id=task_id,
                account_id=account_id,
                title=title,
                category="assignment",
                deadline_at=NOW + timedelta(days=3),
                original_estimate_minutes=minutes,
                planned_duration_minutes=minutes,
                estimate_frozen_at=NOW - timedelta(days=1) if completed_task else None,
                completed_at=NOW - timedelta(hours=1) if completed_task else None,
            )
        )
        proposal_id = None
        if proposed:
            proposal_id = await session.scalar(
                select(ScheduleProposal.id).where(ScheduleProposal.account_id == account_id)
            )
            if proposal_id is None:
                proposal_id = uuid4()
                session.add(
                    ScheduleProposal(
                        id=proposal_id,
                        account_id=account_id,
                        kind="generation",
                        status="feasible",
                        input_fingerprint="0" * 64,
                    )
                )
        await session.flush()
        session.add(
            StudySession(
                id=session_id,
                account_id=account_id,
                task_id=task_id,
                proposal_id=proposal_id,
                starts_at=starts_at,
                ends_at=starts_at + timedelta(minutes=minutes),
                planned_duration_minutes=minutes,
                invalidated_at=NOW - timedelta(hours=1) if invalidated else None,
                invalidation_reason="availability" if invalidated else None,
            )
        )
        if outcome:
            await session.flush()
            session.add(
                StudySessionOutcome(
                    session_id=session_id,
                    kind="completed",
                    actual_minutes=minutes,
                    remaining_minutes=0,
                    recorded_at=NOW,
                )
            )
    return session_id


def due_ids(candidates: list[ReminderCandidate]) -> set[tuple[str, UUID]]:
    return {(c.kind.value, c.session_id) for c in candidates}


@pytest.mark.anyio
async def test_preferences_default_to_opted_out_and_update_only_the_owner(
    database: Database,
) -> None:
    owner = await add_account(database, "owner@example.com", reminders=None, verified=False)
    other = await add_account(database, "other@example.com", reminders=None)
    repository = SqlAlchemyReminderPreferencesRepository(database)

    initial = await repository.get(owner)
    updated = await repository.update(
        owner, ReminderPreferences(email_enabled=True, before_session_minutes=45)
    )
    updated_again = await repository.update(
        owner,
        ReminderPreferences(email_enabled=False, before_session_minutes=0, after_session=False),
    )

    assert initial is not None
    assert initial.preferences == ReminderPreferences(False, 30, True)
    assert initial.email_verified is False
    assert updated is not None
    assert updated.preferences == ReminderPreferences(True, 45, True)
    assert updated_again is not None
    assert updated_again.preferences == ReminderPreferences(False, 0, False)
    other_state = await repository.get(other)
    assert other_state is not None
    assert other_state.preferences == ReminderPreferences()
    assert other_state.email_verified is True
    assert await repository.get(uuid4()) is None
    assert await repository.update(uuid4(), ReminderPreferences()) is None


@pytest.mark.anyio
async def test_before_reminders_use_each_accounts_lead_time(database: Database) -> None:
    account = await add_account(database, "student@example.com")
    long_lead = await add_account(
        database,
        "long@example.com",
        reminders=ReminderPreferences(email_enabled=True, before_session_minutes=60),
    )
    within = await add_session(database, account, NOW + timedelta(minutes=30))
    beyond = await add_session(database, account, NOW + timedelta(minutes=31))
    already_started = await add_session(database, account, NOW - timedelta(minutes=1))
    long_within = await add_session(database, long_lead, NOW + timedelta(minutes=60))
    long_beyond = await add_session(database, long_lead, NOW + timedelta(minutes=61))
    repository = SqlAlchemyReminderDispatchRepository(database)

    due = due_ids(await repository.due_candidates(NOW, 100))

    assert ("before", within) in due
    assert ("before", long_within) in due
    for session_id in (beyond, already_started, long_beyond):
        assert ("before", session_id) not in due


@pytest.mark.anyio
@pytest.mark.parametrize("starts_in_minutes", (1, 10, 29, 30))
async def test_shortest_lead_is_due_at_the_last_half_hour_run_before_the_session(
    database: Database, starts_in_minutes: int
) -> None:
    account = await add_account(
        database,
        "student@example.com",
        reminders=ReminderPreferences(
            email_enabled=True, before_session_minutes=30, after_session=False
        ),
    )
    session_id = await add_session(database, account, NOW + timedelta(minutes=starts_in_minutes))
    repository = SqlAlchemyReminderDispatchRepository(database)

    due = due_ids(await repository.due_candidates(NOW, 100))

    assert due == {("before", session_id)}


@pytest.mark.anyio
async def test_after_reminders_wait_ten_minutes_and_expire_after_a_day(
    database: Database,
) -> None:
    account = await add_account(database, "student@example.com")
    ended_recently = await add_session(database, account, NOW - timedelta(minutes=65))
    ended_long_enough = await add_session(database, account, NOW - timedelta(minutes=70))
    ended_yesterday = await add_session(database, account, NOW - timedelta(hours=25))
    recorded = await add_session(database, account, NOW - timedelta(hours=2), outcome=True)
    repository = SqlAlchemyReminderDispatchRepository(database)

    due = due_ids(await repository.due_candidates(NOW, 100))

    assert due == {("after", ended_long_enough)}
    assert ("after", ended_recently) not in due
    assert ("after", ended_yesterday) not in due
    assert ("after", recorded) not in due


@pytest.mark.anyio
async def test_only_opted_in_verified_active_sessions_are_selected(database: Database) -> None:
    opted_in = await add_account(database, "student@example.com")
    unverified = await add_account(database, "unverified@example.com", verified=False)
    opted_out = await add_account(
        database, "optout@example.com", reminders=ReminderPreferences(email_enabled=False)
    )
    no_preferences = await add_account(database, "none@example.com", reminders=None)
    kinds_off = await add_account(
        database,
        "kinds-off@example.com",
        reminders=ReminderPreferences(
            email_enabled=True, before_session_minutes=0, after_session=False
        ),
    )
    soon = NOW + timedelta(minutes=20)
    ended = NOW - timedelta(hours=2)
    expected = {
        ("before", await add_session(database, opted_in, soon)),
        ("after", await add_session(database, opted_in, ended)),
    }
    for account in (unverified, opted_out, no_preferences, kinds_off):
        await add_session(database, account, soon)
        await add_session(database, account, ended)
    for starts_at in (soon, ended):
        await add_session(database, opted_in, starts_at, proposed=True)
        await add_session(database, opted_in, starts_at, invalidated=True)
        await add_session(database, opted_in, starts_at, completed_task=True)
    repository = SqlAlchemyReminderDispatchRepository(database)

    due = due_ids(await repository.due_candidates(NOW, 100))

    assert due == expected


@pytest.mark.anyio
async def test_claims_are_unique_per_session_and_kind(database: Database) -> None:
    account = await add_account(database, "student@example.com")
    await add_session(database, account, NOW + timedelta(minutes=20))
    repository = SqlAlchemyReminderDispatchRepository(database)
    [candidate] = await repository.due_candidates(NOW, 100)

    assert await repository.claim(candidate, NOW) is True
    assert await repository.claim(candidate, NOW) is False
    assert await repository.due_candidates(NOW, 100) == []

    await repository.release(candidate)

    assert await repository.due_candidates(NOW, 100) == [candidate]


@pytest.mark.anyio
async def test_dispatch_sends_each_reminder_once_and_retries_failed_emails(
    database: Database,
) -> None:
    healthy = await add_account(database, "student@example.com", timezone="Asia/Phnom_Penh")
    failing = await add_account(database, "bounce@example.com")
    before_id = await add_session(database, healthy, NOW + timedelta(minutes=20), title="Essay")
    after_id = await add_session(database, healthy, NOW - timedelta(hours=2), title="Reading")
    failing_id = await add_session(database, failing, NOW + timedelta(minutes=25))
    transport = FlakyTransport(fail_for={"bounce@example.com"})
    service = ReminderDispatchService(
        SqlAlchemyReminderDispatchRepository(database),
        SmtpReminderEmailSender(transport, "no-reply@studyflow.test", "https://studyflow.test"),
        clock=lambda: NOW,
    )

    first = await service.dispatch()
    second = await service.dispatch()
    transport.fail_for.clear()
    retried = await service.dispatch()

    assert (first.sent_before, first.sent_after, first.skipped, first.failed) == (1, 1, 0, 1)
    assert (second.sent_before, second.sent_after, second.failed) == (0, 0, 1)
    assert (retried.sent_before, retried.sent_after, retried.failed) == (1, 0, 0)
    assert [message["To"] for message in transport.messages] == [
        "student@example.com",
        "student@example.com",
        "bounce@example.com",
    ]
    assert "15:20 on Tuesday 20 October (Asia/Phnom_Penh)" in (
        transport.messages[0].get_body(("plain",)).get_content()  # type: ignore[union-attr]
    )
    async with database.transaction() as session:
        deliveries = set(
            (await session.execute(select(ReminderDelivery.session_id, ReminderDelivery.kind)))
            .tuples()
            .all()
        )
    assert deliveries == {
        (before_id, ReminderKind.BEFORE.value),
        (after_id, ReminderKind.AFTER.value),
        (failing_id, ReminderKind.BEFORE.value),
    }


@pytest.mark.anyio
async def test_account_deletion_removes_reminder_rows(database: Database) -> None:
    account = await add_account(database, "student@example.com")
    other = await add_account(database, "other@example.com")
    await add_session(database, account, NOW + timedelta(minutes=20))
    await add_session(database, other, NOW + timedelta(minutes=20))
    repository = SqlAlchemyReminderDispatchRepository(database)
    for candidate in await repository.due_candidates(NOW, 100):
        assert await repository.claim(candidate, NOW)
    async with database.transaction() as session:
        await session.execute(text("PRAGMA foreign_keys = ON"))
        session.add(
            AuthenticationAccountDeletionChallenge(
                account_id=account,
                token_hash="a" * 64,
                created_at=NOW - timedelta(minutes=1),
                expires_at=NOW + timedelta(minutes=10),
            )
        )

    assert await SqlAlchemyAccountDeletionRepository(database).delete_account(
        account, "a" * 64, NOW
    )

    async with database.transaction() as session:
        preference_owners = set(
            (await session.scalars(select(ReminderPreference.account_id))).all()
        )
        delivery_owners = set((await session.scalars(select(ReminderDelivery.account_id))).all())
        session_count = await session.scalar(select(func.count()).select_from(StudySession))
    assert preference_owners == {other}
    assert delivery_owners == {other}
    assert session_count == 1


@pytest.mark.anyio
async def test_due_before_reminder_is_not_starved_by_an_earlier_limit(database: Database) -> None:
    soon = await add_account(
        database,
        "soon@example.com",
        reminders=ReminderPreferences(email_enabled=True, before_session_minutes=30),
    )
    later = await add_account(
        database,
        "later@example.com",
        reminders=ReminderPreferences(email_enabled=True, before_session_minutes=120),
    )
    await add_session(database, soon, NOW + timedelta(minutes=40))
    await add_session(database, soon, NOW + timedelta(minutes=45))
    due_later = await add_session(database, later, NOW + timedelta(minutes=90))
    repository = SqlAlchemyReminderDispatchRepository(database)

    due = due_ids(await repository.due_candidates(NOW, 1))

    assert due == {("before", due_later)}


@pytest.mark.anyio
async def test_due_after_reminder_is_not_starved_by_a_full_before_batch(
    database: Database,
) -> None:
    account = await add_account(database, "student@example.com")
    await add_session(database, account, NOW + timedelta(minutes=10))
    await add_session(database, account, NOW + timedelta(minutes=15))
    ended = await add_session(database, account, NOW - timedelta(minutes=70))
    repository = SqlAlchemyReminderDispatchRepository(database)

    due = due_ids(await repository.due_candidates(NOW, 2))

    assert ("after", ended) in due
    assert len(due) == 2
