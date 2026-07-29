"""Create password-confirmed OIDC link challenges.

Revision ID: 20260729_08
Revises: 20260729_07
Create Date: 2026-07-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260729_08"
down_revision: str | Sequence[str] | None = "20260729_07"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "authentication_oidc_link_challenges",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("subject", sa.String(length=255), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("length(token_hash) = 64", name="token_hash_length"),
        sa.CheckConstraint("created_at < expires_at", name="expiry_order"),
        sa.ForeignKeyConstraint(["account_id"], ["student_accounts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index(
        "ix_authentication_oidc_link_challenges_account_id",
        "authentication_oidc_link_challenges",
        ["account_id"],
    )
    op.create_index(
        "ix_authentication_oidc_link_challenges_expires_at",
        "authentication_oidc_link_challenges",
        ["expires_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_authentication_oidc_link_challenges_expires_at",
        table_name="authentication_oidc_link_challenges",
    )
    op.drop_index(
        "ix_authentication_oidc_link_challenges_account_id",
        table_name="authentication_oidc_link_challenges",
    )
    op.drop_table("authentication_oidc_link_challenges")
