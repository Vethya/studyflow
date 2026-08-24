"""Schedule proposal, task allocation, and study session persistence."""

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from studyflow.database.base import Base


class ScheduleProposal(Base):
    __tablename__ = "schedule_proposals"
    __table_args__ = (
        CheckConstraint("kind IN ('generation', 'revision')", name="kind"),
        CheckConstraint("status IN ('feasible', 'overload')", name="status"),
        CheckConstraint("length(input_fingerprint) = 64", name="fingerprint_length"),
        CheckConstraint(
            "(kind = 'generation' AND revision_reason IS NULL) OR "
            "(kind = 'revision' AND revision_reason IS NOT NULL "
            "AND length(trim(revision_reason)) > 0)",
            name="revision_reason",
        ),
        CheckConstraint(
            "revision_reason IS NULL OR length(revision_reason) <= 500",
            name="revision_reason_length",
        ),
        UniqueConstraint("account_id"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    account_id: Mapped[UUID] = mapped_column(
        ForeignKey("student_accounts.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(String(16))
    revision_reason: Mapped[str | None] = mapped_column(String(500))
    status: Mapped[str] = mapped_column(String(16))
    input_fingerprint: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class StudySession(Base):
    __tablename__ = "study_sessions"
    __table_args__ = (
        CheckConstraint("ends_at > starts_at", name="interval_order"),
        CheckConstraint("planned_duration_minutes > 0", name="positive_duration"),
        CheckConstraint(
            "(invalidated_at IS NULL AND invalidation_reason IS NULL) OR "
            "(invalidated_at IS NOT NULL AND "
            "invalidation_reason IN ('availability', 'deadline'))",
            name="invalidation_state",
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    account_id: Mapped[UUID] = mapped_column(
        ForeignKey("student_accounts.id", ondelete="CASCADE"), index=True
    )
    task_id: Mapped[UUID] = mapped_column(
        ForeignKey("academic_tasks.id", ondelete="CASCADE"), index=True
    )
    proposal_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("schedule_proposals.id", ondelete="CASCADE"), index=True
    )
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    planned_duration_minutes: Mapped[int] = mapped_column(Integer)
    invalidated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    invalidation_reason: Mapped[str | None] = mapped_column(String(16))


class StudySessionOutcome(Base):
    __tablename__ = "study_session_outcomes"
    __table_args__ = (
        CheckConstraint("kind IN ('completed', 'delayed', 'missed')", name="kind"),
        CheckConstraint("actual_minutes >= 0", name="nonnegative_actual"),
        CheckConstraint("remaining_minutes >= 0", name="nonnegative_remaining"),
    )

    session_id: Mapped[UUID] = mapped_column(
        ForeignKey("study_sessions.id", ondelete="CASCADE"), primary_key=True
    )
    kind: Mapped[str] = mapped_column(String(16))
    actual_minutes: Mapped[int] = mapped_column(Integer)
    remaining_minutes: Mapped[int] = mapped_column(Integer)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    rescheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ScheduleRecoverySnapshot(Base):
    __tablename__ = "schedule_recovery_snapshots"

    proposal_id: Mapped[UUID] = mapped_column(
        ForeignKey("schedule_proposals.id", ondelete="CASCADE"), primary_key=True
    )
    account_id: Mapped[UUID] = mapped_column(
        ForeignKey("student_accounts.id", ondelete="CASCADE"), index=True
    )
    missed_session_id: Mapped[UUID] = mapped_column(
        ForeignKey("study_session_outcomes.session_id", ondelete="CASCADE"), index=True
    )
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class RecoveryTaskWork(Base):
    __tablename__ = "recovery_task_work"
    __table_args__ = (CheckConstraint("unfinished_minutes > 0", name="positive_unfinished"),)

    proposal_id: Mapped[UUID] = mapped_column(
        ForeignKey("schedule_recovery_snapshots.proposal_id", ondelete="CASCADE"),
        primary_key=True,
    )
    task_id: Mapped[UUID] = mapped_column(
        ForeignKey("academic_tasks.id", ondelete="CASCADE"), primary_key=True
    )
    unfinished_minutes: Mapped[int] = mapped_column(Integer)


class RecoverySnapshotOutcome(Base):
    __tablename__ = "recovery_snapshot_outcomes"

    proposal_id: Mapped[UUID] = mapped_column(
        ForeignKey("schedule_recovery_snapshots.proposal_id", ondelete="CASCADE"),
        primary_key=True,
    )
    session_id: Mapped[UUID] = mapped_column(
        ForeignKey("study_session_outcomes.session_id", ondelete="CASCADE"), primary_key=True
    )


class ProposalTaskAllocation(Base):
    __tablename__ = "proposal_task_allocations"
    __table_args__ = (
        CheckConstraint("required_minutes >= 0", name="nonnegative_required"),
        CheckConstraint("scheduled_minutes >= 0", name="nonnegative_scheduled"),
        CheckConstraint("unscheduled_minutes >= 0", name="nonnegative_unscheduled"),
        CheckConstraint("raw_calendar_capacity_minutes >= 0", name="nonnegative_raw_capacity"),
        CheckConstraint("available_minutes_before_deadline >= 0", name="nonnegative_available"),
        CheckConstraint("shortfall_minutes >= 0", name="nonnegative_shortfall"),
        CheckConstraint(
            "required_minutes = scheduled_minutes + unscheduled_minutes",
            name="allocation_balance",
        ),
    )

    proposal_id: Mapped[UUID] = mapped_column(
        ForeignKey("schedule_proposals.id", ondelete="CASCADE"), primary_key=True
    )
    task_id: Mapped[UUID] = mapped_column(
        ForeignKey("academic_tasks.id", ondelete="CASCADE"), primary_key=True
    )
    deadline_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    required_minutes: Mapped[int] = mapped_column(Integer)
    scheduled_minutes: Mapped[int] = mapped_column(Integer)
    unscheduled_minutes: Mapped[int] = mapped_column(Integer)
    raw_calendar_capacity_minutes: Mapped[int] = mapped_column(Integer)
    available_minutes_before_deadline: Mapped[int] = mapped_column(Integer)
    shortfall_minutes: Mapped[int] = mapped_column(Integer)
