"""Create dated unavailable periods.

Revision ID: 20260729_06
Revises: 20260729_05
Create Date: 2026-07-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260729_06"
down_revision: str | Sequence[str] | None = "20260729_05"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "unavailable_periods",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("reason", sa.String(length=200), nullable=True),
        sa.CheckConstraint("ends_at > starts_at", name="expiry_order"),
        sa.CheckConstraint("reason IS NULL OR length(reason) <= 200", name="reason_length"),
        sa.ForeignKeyConstraint(["account_id"], ["student_accounts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_unavailable_periods_account_id", "unavailable_periods", ["account_id"])
    op.create_index("ix_unavailable_periods_starts_at", "unavailable_periods", ["starts_at"])
    op.create_index("ix_unavailable_periods_ends_at", "unavailable_periods", ["ends_at"])


def downgrade() -> None:
    op.drop_index("ix_unavailable_periods_ends_at", table_name="unavailable_periods")
    op.drop_index("ix_unavailable_periods_starts_at", table_name="unavailable_periods")
    op.drop_index("ix_unavailable_periods_account_id", table_name="unavailable_periods")
    op.drop_table("unavailable_periods")
