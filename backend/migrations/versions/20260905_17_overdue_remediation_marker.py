"""Track completed overdue remediation per task deadline.

Revision ID: 20260905_17
Revises: 20260904_16
Create Date: 2026-09-05
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260905_17"
down_revision: str | Sequence[str] | None = "20260904_16"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "academic_tasks",
        sa.Column(
            "overdue_remediated_deadline_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("academic_tasks", "overdue_remediated_deadline_at")
