"""Create Academic Task persistence.

Revision ID: 20260729_04
Revises: 20260729_03
Create Date: 2026-07-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260729_04"
down_revision: str | Sequence[str] | None = "20260729_03"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "academic_tasks",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("category", sa.String(length=32), nullable=False),
        sa.Column("priority", sa.String(length=16), server_default="medium", nullable=False),
        sa.Column("course", sa.String(length=100), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("deadline_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("original_estimate_minutes", sa.Integer(), nullable=False),
        sa.Column("adaptive_estimate_minutes", sa.Integer(), nullable=True),
        sa.Column(
            "planned_source", sa.String(length=16), server_default="original", nullable=False
        ),
        sa.Column("planned_duration_minutes", sa.Integer(), nullable=False),
        sa.Column("estimate_frozen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_early_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint(
            "category IN ('assignment', 'reading', 'exam_preparation', 'project', "
            "'research_writing', 'other')",
            name="category",
        ),
        sa.CheckConstraint("priority IN ('low', 'medium', 'high')", name="priority"),
        sa.CheckConstraint(
            "original_estimate_minutes > 0 AND "
            "(adaptive_estimate_minutes IS NULL OR adaptive_estimate_minutes > 0) AND "
            "planned_duration_minutes > 0",
            name="positive_estimates",
        ),
        sa.CheckConstraint(
            "(planned_source = 'original' AND "
            "planned_duration_minutes = original_estimate_minutes) "
            "OR (planned_source = 'adaptive' AND adaptive_estimate_minutes IS NOT NULL AND "
            "planned_duration_minutes = adaptive_estimate_minutes)",
            name="planned_duration_source",
        ),
        sa.CheckConstraint(
            "length(replace(replace(replace(replace(replace(replace("
            "title, ' ', ''), '\t', ''), '\n', ''), '\r', ''), '\f', ''), '\v', '')) > 0",
            name="title_required",
        ),
        sa.CheckConstraint("course IS NULL OR length(course) <= 100", name="course_length"),
        sa.CheckConstraint("notes IS NULL OR length(notes) <= 2000", name="notes_length"),
        sa.ForeignKeyConstraint(["account_id"], ["student_accounts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_academic_tasks_account_id", "academic_tasks", ["account_id"])
    op.create_index("ix_academic_tasks_deadline_at", "academic_tasks", ["deadline_at"])
    op.create_table(
        "task_deadline_history",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("task_id", sa.Uuid(), nullable=False),
        sa.Column("previous_deadline_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("new_deadline_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "changed_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["task_id"], ["academic_tasks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_task_deadline_history_task_id", "task_deadline_history", ["task_id"])


def downgrade() -> None:
    op.drop_index("ix_task_deadline_history_task_id", table_name="task_deadline_history")
    op.drop_table("task_deadline_history")
    op.drop_index("ix_academic_tasks_deadline_at", table_name="academic_tasks")
    op.drop_index("ix_academic_tasks_account_id", table_name="academic_tasks")
    op.drop_table("academic_tasks")
