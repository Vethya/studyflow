"""Create one-time Google OIDC state records.

Revision ID: 20260729_07
Revises: 20260729_06
Create Date: 2026-07-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260729_07"
down_revision: str | Sequence[str] | None = "20260729_06"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "authentication_oidc_states",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("state_hash", sa.String(length=64), nullable=False),
        sa.Column("nonce_hash", sa.String(length=64), nullable=False),
        sa.Column("timezone", sa.String(length=64), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("length(state_hash) = 64", name="state_hash_length"),
        sa.CheckConstraint("length(nonce_hash) = 64", name="nonce_hash_length"),
        sa.CheckConstraint("created_at < expires_at", name="expiry_order"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("state_hash"),
    )
    op.create_index(
        "ix_authentication_oidc_states_expires_at", "authentication_oidc_states", ["expires_at"]
    )


def downgrade() -> None:
    op.drop_index(
        "ix_authentication_oidc_states_expires_at", table_name="authentication_oidc_states"
    )
    op.drop_table("authentication_oidc_states")
