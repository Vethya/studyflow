"""Persist chronological adaptive-estimation evidence.

Revision ID: 20260903_17
Revises: 20260904_16
Create Date: 2026-09-03
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260903_17"
down_revision: str | Sequence[str] | None = "20260904_16"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "adaptive_estimation_predictions",
        sa.Column("task_id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("category", sa.String(length=32), nullable=False),
        sa.Column("original_minutes", sa.Integer(), nullable=False),
        sa.Column("predicted_minutes", sa.Integer(), nullable=False),
        sa.Column("correction_factor", sa.Numeric(), nullable=False),
        sa.Column("history_scope", sa.String(length=16), nullable=False),
        sa.Column("history_count", sa.Integer(), nullable=False),
        sa.Column("exposed", sa.Boolean(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint(
            "original_minutes > 0 AND predicted_minutes > 0", name="positive_minutes"
        ),
        sa.CheckConstraint("correction_factor > 0", name="positive_factor"),
        sa.CheckConstraint("history_scope IN ('overall', 'category')", name="history_scope"),
        sa.CheckConstraint("history_count > 0", name="positive_history_count"),
        sa.ForeignKeyConstraint(["account_id"], ["student_accounts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["task_id"], ["academic_tasks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("task_id", name="pk_adaptive_estimation_predictions"),
    )
    op.create_index(
        "ix_adaptive_estimation_predictions_account_id",
        "adaptive_estimation_predictions",
        ["account_id"],
    )
    op.create_index(
        "ix_adaptive_estimation_predictions_category",
        "adaptive_estimation_predictions",
        ["category"],
    )
    op.create_table(
        "adaptive_estimation_acknowledgments",
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("category", sa.String(length=32), nullable=False),
        sa.Column("correction_factor", sa.Numeric(), nullable=False),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "category IN ('assignment', 'reading', 'exam_preparation', "
            "'project', 'research_writing', 'other')",
            name="category",
        ),
        sa.CheckConstraint("correction_factor > 0", name="positive_factor"),
        sa.ForeignKeyConstraint(["account_id"], ["student_accounts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint(
            "account_id", "category", name="pk_adaptive_estimation_acknowledgments"
        ),
    )


def downgrade() -> None:
    op.drop_table("adaptive_estimation_acknowledgments")
    op.drop_index(
        "ix_adaptive_estimation_predictions_category",
        table_name="adaptive_estimation_predictions",
    )
    op.drop_index(
        "ix_adaptive_estimation_predictions_account_id",
        table_name="adaptive_estimation_predictions",
    )
    op.drop_table("adaptive_estimation_predictions")
