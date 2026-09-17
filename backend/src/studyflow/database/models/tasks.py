"""Academic Task persistence models."""

from datetime import datetime
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from studyflow.database.base import Base


class AcademicTask(Base):
    __tablename__ = "academic_tasks"
    __table_args__ = (
        CheckConstraint(
            "category IN ('assignment', 'reading', 'exam_preparation', "
            "'project', 'research_writing', 'other')",
            name="category",
        ),
        CheckConstraint("priority IN ('low', 'medium', 'high')", name="priority"),
        CheckConstraint(
            "original_estimate_minutes > 0 AND "
            "(adaptive_estimate_minutes IS NULL OR adaptive_estimate_minutes > 0) AND "
            "planned_duration_minutes > 0",
            name="positive_estimates",
        ),
        CheckConstraint(
            "(planned_source = 'original' AND "
            "planned_duration_minutes = original_estimate_minutes) OR "
            "(planned_source = 'adaptive' AND adaptive_estimate_minutes IS NOT NULL AND "
            "planned_duration_minutes = adaptive_estimate_minutes)",
            name="planned_duration_source",
        ),
        CheckConstraint(
            "length(replace(replace(replace(replace(replace(replace("
            "title, ' ', ''), '\t', ''), '\n', ''), '\r', ''), '\f', ''), '\v', '')) > 0",
            name="title_required",
        ),
        CheckConstraint("course IS NULL OR length(course) <= 100", name="course_length"),
        CheckConstraint("notes IS NULL OR length(notes) <= 2000", name="notes_length"),
        CheckConstraint(
            "(finished_early_at IS NULL AND completed_at IS NULL) OR "
            "estimate_frozen_at IS NOT NULL",
            name="completion_requires_start",
        ),
        CheckConstraint(
            "(external_source IS NULL AND external_id IS NULL) OR "
            "(external_source = 'google_classroom' AND length(external_id) = 64)",
            name="external_reference",
        ),
        UniqueConstraint(
            "account_id",
            "external_source",
            "external_id",
            name="uq_academic_tasks_external_reference",
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    account_id: Mapped[UUID] = mapped_column(
        ForeignKey("student_accounts.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(200))
    category: Mapped[str] = mapped_column(String(32))
    priority: Mapped[str] = mapped_column(String(16), server_default="medium")
    course: Mapped[str | None] = mapped_column(String(100))
    notes: Mapped[str | None] = mapped_column(Text)
    deadline_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    original_estimate_minutes: Mapped[int] = mapped_column(Integer)
    adaptive_estimate_minutes: Mapped[int | None] = mapped_column(Integer)
    planned_source: Mapped[str] = mapped_column(String(16), server_default="original")
    planned_duration_minutes: Mapped[int] = mapped_column(Integer)
    estimate_frozen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    overdue_remediated_deadline_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_early_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Set only for tasks imported from Google Classroom, so a repeat import is recognised.
    external_source: Mapped[str | None] = mapped_column(String(32))
    external_id: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class TaskDeadlineHistory(Base):
    __tablename__ = "task_deadline_history"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    task_id: Mapped[UUID] = mapped_column(
        ForeignKey("academic_tasks.id", ondelete="CASCADE"), index=True
    )
    previous_deadline_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    new_deadline_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AdaptiveEstimationPrediction(Base):
    """An immutable correction prediction captured before a task begins."""

    __tablename__ = "adaptive_estimation_predictions"
    __table_args__ = (
        CheckConstraint("original_minutes > 0 AND predicted_minutes > 0", name="positive_minutes"),
        CheckConstraint("correction_factor > 0", name="positive_factor"),
        CheckConstraint("history_scope IN ('overall', 'category')", name="history_scope"),
        CheckConstraint("history_count > 0", name="positive_history_count"),
    )

    task_id: Mapped[UUID] = mapped_column(
        ForeignKey("academic_tasks.id", ondelete="CASCADE"), primary_key=True
    )
    account_id: Mapped[UUID] = mapped_column(
        ForeignKey("student_accounts.id", ondelete="CASCADE"), index=True
    )
    category: Mapped[str] = mapped_column(String(32), index=True)
    original_minutes: Mapped[int] = mapped_column(Integer)
    predicted_minutes: Mapped[int] = mapped_column(Integer)
    correction_factor: Mapped[Decimal] = mapped_column(Numeric)
    history_scope: Mapped[str] = mapped_column(String(16))
    history_count: Mapped[int] = mapped_column(Integer)
    exposed: Mapped[bool] = mapped_column(Boolean)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AdaptiveEstimationAcknowledgment(Base):
    """The latest acknowledged large correction for one account and category."""

    __tablename__ = "adaptive_estimation_acknowledgments"
    __table_args__ = (
        CheckConstraint(
            "category IN ('assignment', 'reading', 'exam_preparation', "
            "'project', 'research_writing', 'other')",
            name="category",
        ),
        CheckConstraint("correction_factor > 0", name="positive_factor"),
    )

    account_id: Mapped[UUID] = mapped_column(
        ForeignKey("student_accounts.id", ondelete="CASCADE"), primary_key=True
    )
    category: Mapped[str] = mapped_column(String(32), primary_key=True)
    correction_factor: Mapped[Decimal] = mapped_column(Numeric)
    acknowledged_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
