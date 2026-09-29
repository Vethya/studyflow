"""Add native Google import callback support.

Revision ID: 20260928_26
Revises: 20260928_25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision = "20260928_26"
down_revision = "20260928_25"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "google_import_states",
        sa.Column("redirect_uri", sa.String(length=512), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("google_import_states", "redirect_uri")
