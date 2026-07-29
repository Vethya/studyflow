"""Track availability confirmation after timezone changes.

Revision ID: 20260729_03
Revises: 20260728_02
Create Date: 2026-07-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260729_03"
down_revision: str | Sequence[str] | None = "20260728_02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "student_accounts",
        sa.Column(
            "availability_timezone_confirmed",
            sa.Boolean(),
            server_default=sa.true(),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("student_accounts", "availability_timezone_confirmed")
