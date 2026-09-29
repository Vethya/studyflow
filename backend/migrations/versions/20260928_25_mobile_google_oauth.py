"""Store mobile OAuth redirect state and one-time exchange codes.

Revision ID: 20260928_25
Revises: 20260928_24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260928_25"
down_revision: str | Sequence[str] | None = "20260928_24"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "authentication_oidc_states",
        sa.Column("redirect_uri", sa.String(length=512), nullable=True),
    )
    op.create_table(
        "authentication_mobile_oauth_codes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("code_hash", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("length(code_hash) = 64", name="code_hash_length"),
        sa.CheckConstraint("created_at < expires_at", name="expiry_order"),
        sa.ForeignKeyConstraint(["account_id"], ["student_accounts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code_hash"),
    )
    op.create_index(
        "ix_authentication_mobile_oauth_codes_account_id",
        "authentication_mobile_oauth_codes",
        ["account_id"],
    )
    op.create_index(
        "ix_authentication_mobile_oauth_codes_expires_at",
        "authentication_mobile_oauth_codes",
        ["expires_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_authentication_mobile_oauth_codes_expires_at",
        table_name="authentication_mobile_oauth_codes",
    )
    op.drop_index(
        "ix_authentication_mobile_oauth_codes_account_id",
        table_name="authentication_mobile_oauth_codes",
    )
    op.drop_table("authentication_mobile_oauth_codes")
    op.drop_column("authentication_oidc_states", "redirect_uri")
