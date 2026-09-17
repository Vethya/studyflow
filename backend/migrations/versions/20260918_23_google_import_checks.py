"""Remember when a student last checked Google for importable data.

Revision ID: 20260918_23
Revises: 20260918_22
Create Date: 2026-09-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260918_23"
down_revision: str | Sequence[str] | None = "20260918_22"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "google_import_checks",
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("checked_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("source IN ('google_calendar', 'google_classroom')", name="source"),
        sa.ForeignKeyConstraint(["account_id"], ["student_accounts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("account_id", "source"),
    )


def downgrade() -> None:
    op.drop_table("google_import_checks")
