"""Create inactive schedule proposal persistence.

Revision ID: 20260729_10
Revises: 20260729_09
Create Date: 2026-08-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260729_10"
down_revision: str | Sequence[str] | None = "20260729_09"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "schedule_proposals",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("revision_reason", sa.String(length=500), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("input_fingerprint", sa.String(length=64), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("kind IN ('generation', 'revision')", name="kind"),
        sa.CheckConstraint("status IN ('feasible', 'overload')", name="status"),
        sa.CheckConstraint("length(input_fingerprint) = 64", name="fingerprint_length"),
        sa.CheckConstraint(
            "(kind = 'generation' AND revision_reason IS NULL) OR "
            "(kind = 'revision' AND revision_reason IS NOT NULL "
            "AND length(trim(revision_reason)) > 0)",
            name="revision_reason",
        ),
        sa.CheckConstraint(
            "revision_reason IS NULL OR length(revision_reason) <= 500",
            name="revision_reason_length",
        ),
        sa.ForeignKeyConstraint(["account_id"], ["student_accounts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name="pk_schedule_proposals"),
        sa.UniqueConstraint("account_id", name="uq_schedule_proposals_account_id"),
    )
    op.create_index("ix_schedule_proposals_account_id", "schedule_proposals", ["account_id"])

    op.create_table(
        "study_sessions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("task_id", sa.Uuid(), nullable=False),
        sa.Column("proposal_id", sa.Uuid(), nullable=True),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("planned_duration_minutes", sa.Integer(), nullable=False),
        sa.CheckConstraint("ends_at > starts_at", name="interval_order"),
        sa.CheckConstraint("planned_duration_minutes > 0", name="positive_duration"),
        sa.ForeignKeyConstraint(["account_id"], ["student_accounts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["task_id"], ["academic_tasks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["proposal_id"], ["schedule_proposals.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name="pk_study_sessions"),
    )
    op.create_index("ix_study_sessions_account_id", "study_sessions", ["account_id"])
    op.create_index("ix_study_sessions_task_id", "study_sessions", ["task_id"])
    op.create_index("ix_study_sessions_proposal_id", "study_sessions", ["proposal_id"])
    op.create_index("ix_study_sessions_starts_at", "study_sessions", ["starts_at"])
    op.create_index("ix_study_sessions_ends_at", "study_sessions", ["ends_at"])

    op.create_table(
        "proposal_task_allocations",
        sa.Column("proposal_id", sa.Uuid(), nullable=False),
        sa.Column("task_id", sa.Uuid(), nullable=False),
        sa.Column("deadline_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("required_minutes", sa.Integer(), nullable=False),
        sa.Column("scheduled_minutes", sa.Integer(), nullable=False),
        sa.Column("unscheduled_minutes", sa.Integer(), nullable=False),
        sa.Column("raw_calendar_capacity_minutes", sa.Integer(), nullable=False),
        sa.Column("available_minutes_before_deadline", sa.Integer(), nullable=False),
        sa.Column("shortfall_minutes", sa.Integer(), nullable=False),
        sa.CheckConstraint("required_minutes >= 0", name="nonnegative_required"),
        sa.CheckConstraint("scheduled_minutes >= 0", name="nonnegative_scheduled"),
        sa.CheckConstraint("unscheduled_minutes >= 0", name="nonnegative_unscheduled"),
        sa.CheckConstraint("raw_calendar_capacity_minutes >= 0", name="nonnegative_raw_capacity"),
        sa.CheckConstraint("available_minutes_before_deadline >= 0", name="nonnegative_available"),
        sa.CheckConstraint("shortfall_minutes >= 0", name="nonnegative_shortfall"),
        sa.CheckConstraint(
            "required_minutes = scheduled_minutes + unscheduled_minutes",
            name="allocation_balance",
        ),
        sa.ForeignKeyConstraint(["proposal_id"], ["schedule_proposals.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["task_id"], ["academic_tasks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("proposal_id", "task_id", name="pk_proposal_task_allocations"),
    )


def downgrade() -> None:
    op.drop_table("proposal_task_allocations")
    op.drop_index("ix_study_sessions_ends_at", table_name="study_sessions")
    op.drop_index("ix_study_sessions_starts_at", table_name="study_sessions")
    op.drop_index("ix_study_sessions_proposal_id", table_name="study_sessions")
    op.drop_index("ix_study_sessions_task_id", table_name="study_sessions")
    op.drop_index("ix_study_sessions_account_id", table_name="study_sessions")
    op.drop_table("study_sessions")
    op.drop_index("ix_schedule_proposals_account_id", table_name="schedule_proposals")
    op.drop_table("schedule_proposals")
