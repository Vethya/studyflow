"""Add separate access and refresh token storage for mobile clients.

Revision ID: 20260928_24
Revises: 20260918_23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260928_24"
down_revision: str | Sequence[str] | None = "20260918_23"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "authentication_mobile_tokens",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("token_type", sa.String(length=16), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("length(token_hash) = 64", name="token_hash_length"),
        sa.CheckConstraint("token_type IN ('access', 'refresh')", name="supported_token_type"),
        sa.CheckConstraint("created_at < expires_at", name="expiry_order"),
        sa.ForeignKeyConstraint(["account_id"], ["student_accounts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index(
        "ix_authentication_mobile_tokens_account_id",
        "authentication_mobile_tokens",
        ["account_id"],
    )
    op.create_index(
        "ix_authentication_mobile_tokens_expires_at",
        "authentication_mobile_tokens",
        ["expires_at"],
    )
    op.create_index(
        "ix_authentication_mobile_tokens_token_type",
        "authentication_mobile_tokens",
        ["token_type"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_authentication_mobile_tokens_token_type", table_name="authentication_mobile_tokens"
    )
    op.drop_index(
        "ix_authentication_mobile_tokens_expires_at", table_name="authentication_mobile_tokens"
    )
    op.drop_index(
        "ix_authentication_mobile_tokens_account_id", table_name="authentication_mobile_tokens"
    )
    op.drop_table("authentication_mobile_tokens")
