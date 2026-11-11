"""Add one-time Google Calendar and Classroom imports.

Revision ID: 20260918_22
Revises: 20260917_21
Create Date: 2026-09-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260918_22"
down_revision: str | Sequence[str] | None = "20260917_21"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SOURCES = "source IN ('google_calendar', 'google_classroom')"


def upgrade() -> None:
    op.create_table(
        "google_import_states",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("state_hash", sa.String(length=64), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("code_verifier", sa.String(length=128), nullable=False),
        sa.Column("horizon_days", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("length(state_hash) = 64", name="state_hash_length"),
        sa.CheckConstraint(SOURCES, name="source"),
        sa.CheckConstraint("length(code_verifier) BETWEEN 43 AND 128", name="code_verifier_length"),
        sa.CheckConstraint("horizon_days BETWEEN 1 AND 90", name="horizon_days"),
        sa.CheckConstraint("created_at < expires_at", name="expiry_order"),
        sa.ForeignKeyConstraint(["account_id"], ["student_accounts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("state_hash"),
    )
    op.create_index("ix_google_import_states_account_id", "google_import_states", ["account_id"])
    op.create_index("ix_google_import_states_expires_at", "google_import_states", ["expires_at"])

    op.create_table(
        "google_import_snapshots",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("items", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(SOURCES, name="source"),
        sa.CheckConstraint("created_at < expires_at", name="expiry_order"),
        sa.ForeignKeyConstraint(["account_id"], ["student_accounts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_google_import_snapshots_account_id", "google_import_snapshots", ["account_id"]
    )
    op.create_index(
        "ix_google_import_snapshots_expires_at", "google_import_snapshots", ["expires_at"]
    )

    for table, source in (
        ("academic_tasks", "google_classroom"),
        ("unavailable_periods", "google_calendar"),
    ):
        op.add_column(table, sa.Column("external_source", sa.String(length=32), nullable=True))
        op.add_column(table, sa.Column("external_id", sa.String(length=64), nullable=True))
        op.create_check_constraint(
            op.f(f"ck_{table}_external_reference"),
            table,
            "(external_source IS NULL AND external_id IS NULL) OR "
            f"(external_source = '{source}' AND length(external_id) = 64)",
        )
        op.create_unique_constraint(
            op.f(f"uq_{table}_external_reference"),
            table,
            ["account_id", "external_source", "external_id"],
        )


def downgrade() -> None:
    for table in ("unavailable_periods", "academic_tasks"):
        op.drop_constraint(op.f(f"uq_{table}_external_reference"), table, type_="unique")
        op.drop_constraint(op.f(f"ck_{table}_external_reference"), table, type_="check")
        op.drop_column(table, "external_id")
        op.drop_column(table, "external_source")
    op.drop_index("ix_google_import_snapshots_expires_at", table_name="google_import_snapshots")
    op.drop_index("ix_google_import_snapshots_account_id", table_name="google_import_snapshots")
    op.drop_table("google_import_snapshots")
    op.drop_index("ix_google_import_states_expires_at", table_name="google_import_states")
    op.drop_index("ix_google_import_states_account_id", table_name="google_import_states")
    op.drop_table("google_import_states")
