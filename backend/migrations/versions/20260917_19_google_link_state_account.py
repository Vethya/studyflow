"""Bind Google link state to the authenticated account.

Revision ID: 20260917_19
Revises: 20260905_18
Create Date: 2026-09-17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260917_19"
down_revision: str | Sequence[str] | None = "20260905_18"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "authentication_oidc_states",
        sa.Column("link_account_id", sa.Uuid(), nullable=True),
    )
    op.create_foreign_key(
        "fk_authentication_oidc_states_link_account_id_student_accounts",
        "authentication_oidc_states",
        "student_accounts",
        ["link_account_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index(
        "ix_authentication_oidc_states_link_account_id",
        "authentication_oidc_states",
        ["link_account_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_authentication_oidc_states_link_account_id",
        table_name="authentication_oidc_states",
    )
    op.drop_constraint(
        "fk_authentication_oidc_states_link_account_id_student_accounts",
        "authentication_oidc_states",
        type_="foreignkey",
    )
    op.drop_column("authentication_oidc_states", "link_account_id")
