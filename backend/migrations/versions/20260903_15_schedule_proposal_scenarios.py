"""Store scenario inputs on inactive schedule proposals.

Revision ID: 20260903_15
Revises: 20260729_14
Create Date: 2026-09-03
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260903_15"
down_revision: str | Sequence[str] | None = "20260729_14"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("schedule_proposals", sa.Column("scenario", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("schedule_proposals", "scenario")
