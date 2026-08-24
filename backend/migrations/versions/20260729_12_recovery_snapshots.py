"""Create missed-session recovery snapshots.

Revision ID: 20260729_12
Revises: 20260729_11
Create Date: 2026-08-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260729_12"
down_revision: str | Sequence[str] | None = "20260729_11"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "schedule_recovery_snapshots",
        sa.Column("proposal_id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("missed_session_id", sa.Uuid(), nullable=False),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["student_accounts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["missed_session_id"], ["study_session_outcomes.session_id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(["proposal_id"], ["schedule_proposals.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("proposal_id", name="pk_schedule_recovery_snapshots"),
    )
    op.create_index(
        "ix_schedule_recovery_snapshots_account_id", "schedule_recovery_snapshots", ["account_id"]
    )
    op.create_index(
        "ix_schedule_recovery_snapshots_missed_session_id",
        "schedule_recovery_snapshots",
        ["missed_session_id"],
    )
    op.create_table(
        "recovery_task_work",
        sa.Column("proposal_id", sa.Uuid(), nullable=False),
        sa.Column("task_id", sa.Uuid(), nullable=False),
        sa.Column("unfinished_minutes", sa.Integer(), nullable=False),
        sa.CheckConstraint("unfinished_minutes > 0", name="positive_unfinished"),
        sa.ForeignKeyConstraint(
            ["proposal_id"], ["schedule_recovery_snapshots.proposal_id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["task_id"], ["academic_tasks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("proposal_id", "task_id", name="pk_recovery_task_work"),
    )


def downgrade() -> None:
    op.drop_table("recovery_task_work")
    op.drop_index(
        "ix_schedule_recovery_snapshots_missed_session_id",
        table_name="schedule_recovery_snapshots",
    )
    op.drop_index(
        "ix_schedule_recovery_snapshots_account_id", table_name="schedule_recovery_snapshots"
    )
    op.drop_table("schedule_recovery_snapshots")
