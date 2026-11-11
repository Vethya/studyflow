"""Track natural Academic Task completion.

Revision ID: 20260901_15
Revises: 20260729_14
Create Date: 2026-09-01
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260901_15"
down_revision: str | Sequence[str] | None = "20260729_14"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "academic_tasks",
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.execute(
        "UPDATE academic_tasks SET completed_at = finished_early_at "
        "WHERE finished_early_at IS NOT NULL"
    )
    op.drop_constraint(
        op.f("ck_academic_tasks_completion_requires_start"),
        "academic_tasks",
        type_="check",
    )
    op.create_check_constraint(
        op.f("ck_academic_tasks_completion_requires_start"),
        "academic_tasks",
        "(finished_early_at IS NULL AND completed_at IS NULL) OR estimate_frozen_at IS NOT NULL",
    )


def downgrade() -> None:
    op.execute(
        "UPDATE academic_tasks SET finished_early_at = completed_at "
        "WHERE finished_early_at IS NULL AND completed_at IS NOT NULL"
    )
    op.drop_constraint(
        op.f("ck_academic_tasks_completion_requires_start"),
        "academic_tasks",
        type_="check",
    )
    op.create_check_constraint(
        op.f("ck_academic_tasks_completion_requires_start"),
        "academic_tasks",
        "finished_early_at IS NULL OR estimate_frozen_at IS NOT NULL",
    )
    op.drop_column("academic_tasks", "completed_at")
