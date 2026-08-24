"""Create immutable study-session outcomes.

Revision ID: 20260729_11
Revises: 20260729_10
Create Date: 2026-08-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260729_11"
down_revision: str | Sequence[str] | None = "20260729_10"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "study_session_outcomes",
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("actual_minutes", sa.Integer(), nullable=False),
        sa.Column("remaining_minutes", sa.Integer(), nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("rescheduled_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("kind IN ('completed', 'delayed', 'missed')", name="kind"),
        sa.CheckConstraint("actual_minutes >= 0", name="nonnegative_actual"),
        sa.CheckConstraint("remaining_minutes >= 0", name="nonnegative_remaining"),
        sa.ForeignKeyConstraint(["session_id"], ["study_sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("session_id", name="pk_study_session_outcomes"),
    )


def downgrade() -> None:
    op.drop_table("study_session_outcomes")
