from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import CheckConstraint, select

from studyflow.database import Base, Database
from studyflow.database.models import AcademicTask, StudentAccount
from studyflow.database.models import StudySession as SessionRow
from studyflow.scheduling import (
    NewProposedSession,
    NewScheduleProposal,
    NewTaskAllocation,
    ProposalKind,
    ProposalStatus,
)
from studyflow.scheduling.repositories import SqlAlchemyScheduleProposalRepository

FINGERPRINT = "a" * 64


def _allocation(task_id: UUID, deadline: datetime, required: int) -> NewTaskAllocation:
    return NewTaskAllocation(
        task_id=task_id,
        deadline_at=deadline,
        required_minutes=required,
        scheduled_minutes=required,
        unscheduled_minutes=0,
        raw_calendar_capacity_minutes=240,
        available_minutes_before_deadline=240,
        shortfall_minutes=0,
    )


def _proposal(task_id: UUID, starts_at: datetime, duration: int) -> NewScheduleProposal:
    return NewScheduleProposal(
        ProposalKind.GENERATION,
        None,
        ProposalStatus.FEASIBLE,
        FINGERPRINT,
        (
            NewProposedSession(
                task_id,
                starts_at,
                starts_at + timedelta(minutes=duration),
                duration,
            ),
        ),
        (_allocation(task_id, starts_at + timedelta(days=1), duration),),
    )


async def _seed(database: Database) -> tuple[UUID, UUID, UUID, UUID]:
    owner_id, other_id, owner_task_id, other_task_id = uuid4(), uuid4(), uuid4(), uuid4()
    now = datetime(2026, 8, 24, tzinfo=UTC)
    async with database.transaction() as session:
        await session.run_sync(lambda sync: Base.metadata.create_all(sync.connection()))
        session.add_all(
            [
                StudentAccount(
                    id=owner_id,
                    email="owner@example.com",
                    name="Owner",
                    password_hash="$argon2id$hash",
                    email_verified_at=now,
                    timezone="UTC",
                ),
                StudentAccount(
                    id=other_id,
                    email="other@example.com",
                    name="Other",
                    password_hash="$argon2id$hash",
                    email_verified_at=now,
                    timezone="UTC",
                ),
                AcademicTask(
                    id=owner_task_id,
                    account_id=owner_id,
                    title="Owner task",
                    category="assignment",
                    deadline_at=now + timedelta(days=2),
                    original_estimate_minutes=60,
                    planned_duration_minutes=60,
                ),
                AcademicTask(
                    id=other_task_id,
                    account_id=other_id,
                    title="Other task",
                    category="assignment",
                    deadline_at=now + timedelta(days=2),
                    original_estimate_minutes=60,
                    planned_duration_minutes=60,
                ),
            ]
        )
    return owner_id, other_id, owner_task_id, other_task_id


def test_schedule_proposal_tables_are_registered_with_constraints() -> None:
    assert {
        "schedule_proposals",
        "study_sessions",
        "proposal_task_allocations",
    }.issubset(Base.metadata.tables)
    proposal_constraints = {
        item.name
        for item in Base.metadata.tables["schedule_proposals"].constraints
        if isinstance(item, CheckConstraint)
    }
    assert {
        "ck_schedule_proposals_kind",
        "ck_schedule_proposals_status",
        "ck_schedule_proposals_fingerprint_length",
        "ck_schedule_proposals_revision_reason",
    }.issubset(proposal_constraints)
    assert Base.metadata.tables["study_sessions"].c.proposal_id.nullable


def test_proposal_rejects_allocation_not_backed_by_scheduled_sessions() -> None:
    task_id = uuid4()
    starts_at = datetime(2026, 8, 25, 10, tzinfo=UTC)

    with pytest.raises(ValueError, match="scheduled_minutes"):
        NewScheduleProposal(
            ProposalKind.GENERATION,
            None,
            ProposalStatus.FEASIBLE,
            FINGERPRINT,
            (NewProposedSession(task_id, starts_at, starts_at + timedelta(minutes=30), 30),),
            (_allocation(task_id, starts_at + timedelta(days=1), 60),),
        )


@pytest.mark.anyio
async def test_repository_roundtrips_orders_and_replaces_single_proposal() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    try:
        owner_id, _, task_id, _ = await _seed(database)
        repository = SqlAlchemyScheduleProposalRepository(database)
        late = datetime(2026, 8, 25, 14, tzinfo=UTC)
        early = datetime(2026, 8, 25, 10, tzinfo=UTC)
        first = NewScheduleProposal(
            ProposalKind.GENERATION,
            None,
            ProposalStatus.FEASIBLE,
            FINGERPRINT,
            (
                NewProposedSession(task_id, late, late + timedelta(minutes=30), 30),
                NewProposedSession(task_id, early, early + timedelta(minutes=30), 30),
            ),
            (_allocation(task_id, late + timedelta(days=1), 60),),
        )
        stored = await repository.replace(owner_id, first)
        assert stored is not None
        loaded = await repository.get(owner_id)
        assert loaded is not None
        assert [item.starts_at for item in loaded.sessions] == [early, late]

        replacement = await repository.replace(owner_id, _proposal(task_id, late, 45))
        assert replacement is not None and replacement.id != stored.id
        loaded = await repository.get(owner_id)
        assert loaded is not None and loaded.id == replacement.id
        assert len(loaded.sessions) == 1
    finally:
        await database.stop()


@pytest.mark.anyio
async def test_repository_enforces_ownership_and_reject_preserves_accepted_sessions() -> None:
    database = Database("sqlite+aiosqlite:///:memory:")
    await database.start()
    try:
        owner_id, other_id, task_id, other_task_id = await _seed(database)
        repository = SqlAlchemyScheduleProposalRepository(database)
        starts_at = datetime(2026, 8, 25, 10, tzinfo=UTC)
        assert await repository.replace(owner_id, _proposal(other_task_id, starts_at, 30)) is None
        stored = await repository.replace(owner_id, _proposal(task_id, starts_at, 30))
        assert stored is not None
        async with database.transaction() as session:
            session.add(
                SessionRow(
                    account_id=owner_id,
                    task_id=task_id,
                    proposal_id=None,
                    starts_at=starts_at + timedelta(days=1),
                    ends_at=starts_at + timedelta(days=1, minutes=30),
                    planned_duration_minutes=30,
                )
            )

        assert await repository.get(other_id) is None
        assert not await repository.reject(other_id, stored.id)
        assert await repository.reject(owner_id, stored.id)
        assert await repository.get(owner_id) is None
        async with database.transaction() as session:
            remaining = list(await session.scalars(select(SessionRow)))
        assert len(remaining) == 1 and remaining[0].proposal_id is None
    finally:
        await database.stop()
