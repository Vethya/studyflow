"""Add opt-in study reminder preferences and delivery records.

Revision ID: 20261018_25
Revises: 20260918_23
Create Date: 2026-10-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261018_25"
down_revision: str | Sequence[str] | None = "20260918_23"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "reminder_preferences",
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("email_enabled", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("before_session_minutes", sa.Integer(), server_default="30", nullable=False),
        sa.Column("after_session", sa.Boolean(), server_default="true", nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "before_session_minutes = 0 OR before_session_minutes BETWEEN 30 AND 120",
            name="before_session_minutes",
        ),
        sa.ForeignKeyConstraint(["account_id"], ["student_accounts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("account_id"),
    )
    op.create_table(
        "reminder_deliveries",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("kind IN ('before', 'after')", name="kind"),
        sa.ForeignKeyConstraint(["account_id"], ["student_accounts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["session_id"], ["study_sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("session_id", "kind", name="uq_reminder_deliveries_session_kind"),
    )
    op.create_index(
        "ix_reminder_deliveries_account_id",
        "reminder_deliveries",
        ["account_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_reminder_deliveries_account_id", table_name="reminder_deliveries")
    op.drop_table("reminder_deliveries")
    op.drop_table("reminder_preferences")
