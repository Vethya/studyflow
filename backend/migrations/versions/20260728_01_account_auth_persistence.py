"""Create account and authentication persistence.

Revision ID: 20260728_01
Revises:
Create Date: 2026-07-28
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260728_01"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "student_accounts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=True),
        sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("timezone", sa.String(length=64), server_default="UTC", nullable=False),
        sa.Column(
            "preferred_session_length_minutes",
            sa.Integer(),
            server_default="60",
            nullable=False,
        ),
        sa.Column("minimum_break_minutes", sa.Integer(), server_default="10", nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint(
            "email = lower(email) AND email <> ''",
            name="email_canonical",
        ),
        sa.CheckConstraint(
            "preferred_session_length_minutes BETWEEN 10 AND 240",
            name="preferred_session_length",
        ),
        sa.CheckConstraint(
            "minimum_break_minutes BETWEEN 0 AND 120",
            name="minimum_break",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_student_accounts"),
        sa.UniqueConstraint("email", name="uq_student_accounts_email"),
    )
    op.create_table(
        "authentication_identities",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("subject", sa.String(length=255), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint(
            "provider IN ('google')",
            name="supported_provider",
        ),
        sa.ForeignKeyConstraint(
            ["account_id"],
            ["student_accounts.id"],
            name="fk_authentication_identities_account_id_student_accounts",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_authentication_identities"),
        sa.UniqueConstraint(
            "account_id",
            "provider",
            name="uq_authentication_identities_account_provider",
        ),
        sa.UniqueConstraint(
            "provider",
            "subject",
            name="uq_authentication_identities_provider_subject",
        ),
    )
    op.create_index(
        "ix_authentication_identities_account_id",
        "authentication_identities",
        ["account_id"],
    )
    op.create_table(
        "authentication_sessions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("csrf_token_hash", sa.String(length=64), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("idle_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("absolute_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "length(token_hash) = 64",
            name="token_hash_length",
        ),
        sa.CheckConstraint(
            "length(csrf_token_hash) = 64",
            name="csrf_token_hash_length",
        ),
        sa.CheckConstraint(
            "created_at < idle_expires_at AND idle_expires_at <= absolute_expires_at",
            name="expiry_order",
        ),
        sa.ForeignKeyConstraint(
            ["account_id"],
            ["student_accounts.id"],
            name="fk_authentication_sessions_account_id_student_accounts",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_authentication_sessions"),
        sa.UniqueConstraint("token_hash", name="uq_authentication_sessions_token_hash"),
    )
    op.create_index(
        "ix_authentication_sessions_absolute_expires_at",
        "authentication_sessions",
        ["absolute_expires_at"],
    )
    op.create_index(
        "ix_authentication_sessions_account_id",
        "authentication_sessions",
        ["account_id"],
    )
    op.create_index(
        "ix_authentication_sessions_idle_expires_at",
        "authentication_sessions",
        ["idle_expires_at"],
    )
    op.create_table(
        "authentication_email_tokens",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("purpose", sa.String(length=32), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "purpose IN ('email_verification', 'password_reset')",
            name="supported_purpose",
        ),
        sa.CheckConstraint(
            "length(token_hash) = 64",
            name="token_hash_length",
        ),
        sa.CheckConstraint(
            "created_at < expires_at",
            name="expiry_order",
        ),
        sa.ForeignKeyConstraint(
            ["account_id"],
            ["student_accounts.id"],
            name="fk_authentication_email_tokens_account_id_student_accounts",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_authentication_email_tokens"),
        sa.UniqueConstraint("token_hash", name="uq_authentication_email_tokens_token_hash"),
    )
    op.create_index(
        "ix_authentication_email_tokens_account_id",
        "authentication_email_tokens",
        ["account_id"],
    )
    op.create_index(
        "ix_authentication_email_tokens_expires_at",
        "authentication_email_tokens",
        ["expires_at"],
    )
    op.create_index(
        "ix_authentication_email_tokens_purpose",
        "authentication_email_tokens",
        ["purpose"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_authentication_email_tokens_purpose", table_name="authentication_email_tokens"
    )
    op.drop_index(
        "ix_authentication_email_tokens_expires_at", table_name="authentication_email_tokens"
    )
    op.drop_index(
        "ix_authentication_email_tokens_account_id", table_name="authentication_email_tokens"
    )
    op.drop_table("authentication_email_tokens")
    op.drop_index(
        "ix_authentication_sessions_idle_expires_at", table_name="authentication_sessions"
    )
    op.drop_index("ix_authentication_sessions_account_id", table_name="authentication_sessions")
    op.drop_index(
        "ix_authentication_sessions_absolute_expires_at",
        table_name="authentication_sessions",
    )
    op.drop_table("authentication_sessions")
    op.drop_index("ix_authentication_identities_account_id", table_name="authentication_identities")
    op.drop_table("authentication_identities")
    op.drop_table("student_accounts")
