"""Create recurring availability windows.

Revision ID: 20260729_05
Revises: 20260729_04
Create Date: 2026-07-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260729_05"
down_revision: str | Sequence[str] | None = "20260729_04"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "availability_windows",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("weekday", sa.Integer(), nullable=False),
        sa.Column("local_start_time", sa.Time(), nullable=False),
        sa.Column("local_end_time", sa.Time(), nullable=False),
        sa.Column("crosses_midnight", sa.Boolean(), nullable=False),
        sa.CheckConstraint("weekday BETWEEN 0 AND 6", name="weekday"),
        sa.ForeignKeyConstraint(["account_id"], ["student_accounts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_availability_windows_account_id", "availability_windows", ["account_id"])


def downgrade() -> None:
    op.drop_index("ix_availability_windows_account_id", table_name="availability_windows")
    op.drop_table("availability_windows")
