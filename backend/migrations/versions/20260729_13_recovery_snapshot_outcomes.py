"""Track unresolved outcomes covered by recovery proposals.

Revision ID: 20260729_13
Revises: 20260729_12
Create Date: 2026-08-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260729_13"
down_revision: str | Sequence[str] | None = "20260729_12"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "recovery_snapshot_outcomes",
        sa.Column("proposal_id", sa.Uuid(), nullable=False),
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(
            ["proposal_id"], ["schedule_recovery_snapshots.proposal_id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["session_id"], ["study_session_outcomes.session_id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("proposal_id", "session_id", name="pk_recovery_snapshot_outcomes"),
    )


def downgrade() -> None:
    op.drop_table("recovery_snapshot_outcomes")
