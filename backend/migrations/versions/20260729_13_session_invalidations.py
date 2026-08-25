"""Retain unfinished work from invalidated future sessions.

Revision ID: 20260729_13
Revises: 20260729_12
Create Date: 2026-08-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260729_13"
down_revision: str | Sequence[str] | None = "20260729_12"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "study_sessions",
        sa.Column("invalidated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "study_sessions",
        sa.Column("invalidation_reason", sa.String(length=16), nullable=True),
    )
    op.create_check_constraint(
        "invalidation_state",
        "study_sessions",
        "(invalidated_at IS NULL AND invalidation_reason IS NULL) OR "
        "(invalidated_at IS NOT NULL AND invalidation_reason IN ('availability', 'deadline'))",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_study_sessions_invalidation_state",
        "study_sessions",
        type_="check",
    )
    op.drop_column("study_sessions", "invalidation_reason")
    op.drop_column("study_sessions", "invalidated_at")
