"""Academic Task persistence models."""

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, String, Text, func
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
        CheckConstraint("length(trim(title)) > 0", name="title_required"),
        CheckConstraint("course IS NULL OR length(course) <= 100", name="course_length"),
        CheckConstraint("notes IS NULL OR length(notes) <= 2000", name="notes_length"),
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
    finished_early_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
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
