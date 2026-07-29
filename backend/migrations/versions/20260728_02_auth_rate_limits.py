"""Create durable authentication rate limits.

Revision ID: 20260728_02
Revises: 20260728_01
Create Date: 2026-07-28
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260728_02"
down_revision: str | Sequence[str] | None = "20260728_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "authentication_rate_limits",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("action", sa.String(length=32), nullable=False),
        sa.Column("key_hash", sa.String(length=64), nullable=False),
        sa.Column("window_started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("length(key_hash) = 64", name="key_hash_length"),
        sa.CheckConstraint("attempts > 0", name="positive_attempts"),
        sa.PrimaryKeyConstraint("id", name="pk_authentication_rate_limits"),
        sa.UniqueConstraint("action", "key_hash", name="uq_authentication_rate_limits_action_key"),
    )
    op.create_index(
        "ix_authentication_rate_limits_window_started_at",
        "authentication_rate_limits",
        ["window_started_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_authentication_rate_limits_window_started_at",
        table_name="authentication_rate_limits",
    )
    op.drop_table("authentication_rate_limits")
