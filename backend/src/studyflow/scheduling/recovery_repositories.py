"""SQLAlchemy recovery snapshot capture and persistence."""

from collections import defaultdict
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from studyflow.auth.repositories import SessionTransactions
from studyflow.database.models import ProposalTaskAllocation as AllocationRow
from studyflow.database.models import RecoveryTaskWork as WorkRow
from studyflow.database.models import ScheduleProposal as ProposalRow
from studyflow.database.models import ScheduleRecoverySnapshot as SnapshotRow
from studyflow.database.models import StudentAccount
from studyflow.database.models import StudySession as SessionRow
from studyflow.database.models import StudySessionOutcome as OutcomeRow
from studyflow.scheduling.outcomes import SessionOutcomeKind, StudySessionOutcomeRecord
from studyflow.scheduling.proposals import StudySessionRecord
from studyflow.scheduling.recovery import (
    InvalidRecoveryTriggerError,
    RecoverySnapshot,
    RecoveryTaskWork,
)


class SqlAlchemyRecoverySnapshotRepository:
    def __init__(self, database: SessionTransactions) -> None:
        self._database = database

    async def capture(
        self, account_id: UUID, missed_session_id: UUID, now: datetime
    ) -> RecoverySnapshot | None:
        async with self._database.transaction() as session:
            account = await session.get(StudentAccount, account_id, with_for_update=True)
            if account is None:
                return None
            trigger = await session.scalar(
                select(SessionRow)
                .where(SessionRow.id == missed_session_id, SessionRow.account_id == account_id)
                .with_for_update()
            )
            if trigger is None:
                return None
            trigger_outcome = await session.get(OutcomeRow, missed_session_id)
            if (
                trigger.proposal_id is not None
                or trigger_outcome is None
                or trigger_outcome.kind != SessionOutcomeKind.MISSED.value
                or trigger_outcome.remaining_minutes <= 0
                or trigger_outcome.rescheduled_at is not None
            ):
                raise InvalidRecoveryTriggerError(
                    "Recovery requires an unresolved missed-session outcome"
                )
            now_utc = self._aware(now).astimezone(UTC)
            accepted = list(
                await session.scalars(
                    select(SessionRow)
                    .where(SessionRow.account_id == account_id, SessionRow.proposal_id.is_(None))
                    .order_by(SessionRow.starts_at, SessionRow.id)
                )
            )
            outcome_by_session = {
                item.session_id: item
                for item in await session.scalars(
                    select(OutcomeRow).where(
                        OutcomeRow.session_id.in_([item.id for item in accepted])
                    )
                )
            }
            unfinished: defaultdict[UUID, int] = defaultdict(int)
            future: list[StudySessionRecord] = []
            in_progress: list[StudySessionRecord] = []
            unresolved: list[StudySessionOutcomeRecord] = []
            for item in accepted:
                if self._aware(item.starts_at) >= now_utc:
                    unfinished[item.task_id] += item.planned_duration_minutes
                    future.append(self._session_record(item))
                    continue
                if self._aware(item.ends_at) > now_utc:
                    in_progress.append(self._session_record(item))
                    continue
                outcome = outcome_by_session.get(item.id)
                if outcome is None:
                    unfinished[item.task_id] += item.planned_duration_minutes
                elif outcome.remaining_minutes > 0 and outcome.rescheduled_at is None:
                    unfinished[item.task_id] += outcome.remaining_minutes
                    unresolved.append(self._outcome_record(outcome))
            return RecoverySnapshot(
                missed_session_id,
                now_utc,
                tuple(
                    RecoveryTaskWork(task_id, minutes)
                    for task_id, minutes in sorted(unfinished.items(), key=lambda item: item[0])
                ),
                tuple(future),
                tuple(in_progress),
                tuple(unresolved),
            )

    async def save(self, account_id: UUID, proposal_id: UUID, snapshot: RecoverySnapshot) -> bool:
        async with self._database.transaction() as session:
            proposal = await session.scalar(
                select(ProposalRow).where(
                    ProposalRow.id == proposal_id, ProposalRow.account_id == account_id
                )
            )
            if proposal is None:
                return False
            session.add(
                SnapshotRow(
                    proposal_id=proposal_id,
                    account_id=account_id,
                    missed_session_id=snapshot.missed_session_id,
                    captured_at=snapshot.captured_at,
                )
            )
            session.add_all(
                WorkRow(
                    proposal_id=proposal_id,
                    task_id=item.task_id,
                    unfinished_minutes=item.unfinished_minutes,
                )
                for item in snapshot.unfinished_work
            )
            return True

    @staticmethod
    def _aware(value: datetime) -> datetime:
        return value if value.tzinfo is not None else value.replace(tzinfo=UTC)

    @classmethod
    def _session_record(cls, item: SessionRow) -> StudySessionRecord:
        return StudySessionRecord(
            item.id,
            item.account_id,
            item.task_id,
            item.proposal_id,
            cls._aware(item.starts_at),
            cls._aware(item.ends_at),
            item.planned_duration_minutes,
        )

    @classmethod
    def _outcome_record(cls, item: OutcomeRow) -> StudySessionOutcomeRecord:
        return StudySessionOutcomeRecord(
            item.session_id,
            SessionOutcomeKind(item.kind),
            item.actual_minutes,
            item.remaining_minutes,
            cls._aware(item.recorded_at),
            cls._aware(item.rescheduled_at) if item.rescheduled_at is not None else None,
        )


class SqlAlchemyTaskRecoveryProposalInvalidator:
    async def invalidate_for_task(
        self,
        session: AsyncSession,
        account_id: UUID,
        task_id: UUID,
    ) -> None:
        proposal_ids = tuple(
            await session.scalars(
                select(SnapshotRow.proposal_id)
                .join(WorkRow, WorkRow.proposal_id == SnapshotRow.proposal_id)
                .where(
                    SnapshotRow.account_id == account_id,
                    WorkRow.task_id == task_id,
                )
                .with_for_update()
            )
        )
        if not proposal_ids:
            return
        await session.execute(delete(WorkRow).where(WorkRow.proposal_id.in_(proposal_ids)))
        await session.execute(delete(SnapshotRow).where(SnapshotRow.proposal_id.in_(proposal_ids)))
        await session.execute(
            delete(AllocationRow).where(AllocationRow.proposal_id.in_(proposal_ids))
        )
        await session.execute(delete(SessionRow).where(SessionRow.proposal_id.in_(proposal_ids)))
        await session.execute(delete(ProposalRow).where(ProposalRow.id.in_(proposal_ids)))
