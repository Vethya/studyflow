"""Store optional Google profile images on student accounts.

Revision ID: 20260917_21
Revises: 20260917_20
Create Date: 2026-09-17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260917_21"
down_revision: str | Sequence[str] | None = "20260917_20"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "student_accounts",
        sa.Column("avatar_url", sa.String(length=2048), nullable=True),
    )
    op.add_column(
        "authentication_oidc_link_challenges",
        sa.Column("picture_url", sa.String(length=2048), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("authentication_oidc_link_challenges", "picture_url")
    op.drop_column("student_accounts", "avatar_url")
