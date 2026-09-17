"""Add account deletion reauthentication challenges.

Revision ID: 20260917_20
Revises: 20260917_19
Create Date: 2026-09-17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260917_20"
down_revision: str | Sequence[str] | None = "20260917_19"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "authentication_oidc_states",
        sa.Column("deletion_account_id", sa.Uuid(), nullable=True),
    )
    op.create_foreign_key(
        "fk_oidc_states_deletion_account",
        "authentication_oidc_states",
        "student_accounts",
        ["deletion_account_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index(
        "ix_authentication_oidc_states_deletion_account_id",
        "authentication_oidc_states",
        ["deletion_account_id"],
    )
    op.create_table(
        "authentication_account_deletion_challenges",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
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
        "ix_authentication_account_deletion_challenges_account_id",
        "authentication_account_deletion_challenges",
        ["account_id"],
    )
    op.create_index(
        "ix_authentication_account_deletion_challenges_expires_at",
        "authentication_account_deletion_challenges",
        ["expires_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_authentication_account_deletion_challenges_expires_at",
        table_name="authentication_account_deletion_challenges",
    )
    op.drop_index(
        "ix_authentication_account_deletion_challenges_account_id",
        table_name="authentication_account_deletion_challenges",
    )
    op.drop_table("authentication_account_deletion_challenges")
    op.drop_index(
        "ix_authentication_oidc_states_deletion_account_id",
        table_name="authentication_oidc_states",
    )
    op.drop_constraint(
        "fk_oidc_states_deletion_account",
        "authentication_oidc_states",
        type_="foreignkey",
    )
    op.drop_column("authentication_oidc_states", "deletion_account_id")
