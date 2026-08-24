"""SQLAlchemy schedule proposal repository."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from studyflow.auth.repositories import SessionTransactions
from studyflow.database.models import AcademicTask, StudentAccount
from studyflow.database.models import ProposalTaskAllocation as AllocationRow
from studyflow.database.models import ScheduleProposal as ProposalRow
from studyflow.database.models import StudySession as SessionRow
from studyflow.scheduling.proposals import (
    NewScheduleProposal,
    ProposalKind,
    ProposalStatus,
    ScheduleProposalRecord,
    StudySessionRecord,
    TaskAllocationRecord,
)


class SqlAlchemyScheduleProposalRepository:
    def __init__(self, database: SessionTransactions) -> None:
        self._database = database

    async def replace(
        self, account_id: UUID, proposal: NewScheduleProposal
    ) -> ScheduleProposalRecord | None:
        async with self._database.transaction() as session:
            account = await session.get(StudentAccount, account_id, with_for_update=True)
            if account is None:
                return None
            task_ids = {
                *(item.task_id for item in proposal.sessions),
                *(item.task_id for item in proposal.allocations),
            }
            if task_ids:
                owned_task_ids = set(
                    await session.scalars(
                        select(AcademicTask.id).where(
                            AcademicTask.account_id == account_id,
                            AcademicTask.id.in_(task_ids),
                        )
                    )
                )
                if owned_task_ids != task_ids:
                    return None

            existing = await session.scalar(
                select(ProposalRow).where(ProposalRow.account_id == account_id).with_for_update()
            )
            if existing is not None:
                await self._delete_proposal(session, existing.id)

            proposal_row = ProposalRow(
                account_id=account_id,
                kind=proposal.kind.value,
                revision_reason=proposal.revision_reason,
                status=proposal.status.value,
                input_fingerprint=proposal.input_fingerprint,
            )
            session.add(proposal_row)
            await session.flush()
            session_rows = [
                SessionRow(
                    account_id=account_id,
                    task_id=item.task_id,
                    proposal_id=proposal_row.id,
                    starts_at=item.starts_at,
                    ends_at=item.ends_at,
                    planned_duration_minutes=item.planned_duration_minutes,
                )
                for item in proposal.sessions
            ]
            allocation_rows = [
                AllocationRow(
                    proposal_id=proposal_row.id,
                    task_id=item.task_id,
                    deadline_at=item.deadline_at,
                    required_minutes=item.required_minutes,
                    scheduled_minutes=item.scheduled_minutes,
                    unscheduled_minutes=item.unscheduled_minutes,
                    raw_calendar_capacity_minutes=item.raw_calendar_capacity_minutes,
                    available_minutes_before_deadline=item.available_minutes_before_deadline,
                    shortfall_minutes=item.shortfall_minutes,
                )
                for item in proposal.allocations
            ]
            session.add_all([*session_rows, *allocation_rows])
            await session.flush()
            await session.refresh(proposal_row)
            return self._record(proposal_row, session_rows, allocation_rows)

    async def get(self, account_id: UUID) -> ScheduleProposalRecord | None:
        async with self._database.transaction() as session:
            proposal = await session.scalar(
                select(ProposalRow).where(ProposalRow.account_id == account_id)
            )
            if proposal is None:
                return None
            sessions = list(
                await session.scalars(
                    select(SessionRow)
                    .where(SessionRow.proposal_id == proposal.id)
                    .order_by(SessionRow.starts_at, SessionRow.id)
                )
            )
            allocations = list(
                await session.scalars(
                    select(AllocationRow)
                    .where(AllocationRow.proposal_id == proposal.id)
                    .order_by(AllocationRow.deadline_at, AllocationRow.task_id)
                )
            )
            return self._record(proposal, sessions, allocations)

    async def reject(self, account_id: UUID, proposal_id: UUID) -> bool:
        async with self._database.transaction() as session:
            proposal = await session.scalar(
                select(ProposalRow)
                .where(ProposalRow.id == proposal_id, ProposalRow.account_id == account_id)
                .with_for_update()
            )
            if proposal is None:
                return False
            await self._delete_proposal(session, proposal.id)
            return True

    @staticmethod
    async def _delete_proposal(session: AsyncSession, proposal_id: UUID) -> None:
        await session.execute(delete(AllocationRow).where(AllocationRow.proposal_id == proposal_id))
        await session.execute(delete(SessionRow).where(SessionRow.proposal_id == proposal_id))
        await session.execute(delete(ProposalRow).where(ProposalRow.id == proposal_id))

    @staticmethod
    def _aware(value: datetime) -> datetime:
        return value if value.tzinfo is not None else value.replace(tzinfo=UTC)

    @classmethod
    def _record(
        cls,
        proposal: ProposalRow,
        sessions: list[SessionRow],
        allocations: list[AllocationRow],
    ) -> ScheduleProposalRecord:
        return ScheduleProposalRecord(
            id=proposal.id,
            account_id=proposal.account_id,
            kind=ProposalKind(proposal.kind),
            revision_reason=proposal.revision_reason,
            status=ProposalStatus(proposal.status),
            input_fingerprint=proposal.input_fingerprint,
            created_at=cls._aware(proposal.created_at),
            sessions=tuple(
                StudySessionRecord(
                    id=item.id,
                    account_id=item.account_id,
                    task_id=item.task_id,
                    proposal_id=item.proposal_id,
                    starts_at=cls._aware(item.starts_at),
                    ends_at=cls._aware(item.ends_at),
                    planned_duration_minutes=item.planned_duration_minutes,
                )
                for item in sessions
            ),
            allocations=tuple(
                TaskAllocationRecord(
                    proposal_id=item.proposal_id,
                    task_id=item.task_id,
                    deadline_at=cls._aware(item.deadline_at),
                    required_minutes=item.required_minutes,
                    scheduled_minutes=item.scheduled_minutes,
                    unscheduled_minutes=item.unscheduled_minutes,
                    raw_calendar_capacity_minutes=item.raw_calendar_capacity_minutes,
                    available_minutes_before_deadline=item.available_minutes_before_deadline,
                    shortfall_minutes=item.shortfall_minutes,
                )
                for item in allocations
            ),
        )
