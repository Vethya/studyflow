"""Create authentication registration persistence.

Revision ID: 20260729_09
Revises: 20260729_08
Create Date: 2026-08-19
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260729_09"
down_revision: str | Sequence[str] | None = "20260729_08"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "authentication_registrations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("verification_token_hash", sa.String(length=64), nullable=False),
        sa.Column("verification_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("signup_token_hash", sa.String(length=64), nullable=True),
        sa.Column("signup_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("email = lower(email) AND email <> ''", name="email_canonical"),
        sa.CheckConstraint("length(verification_token_hash) = 64", name="verification_hash_length"),
        sa.CheckConstraint(
            "signup_token_hash IS NULL OR length(signup_token_hash) = 64",
            name="signup_hash_length",
        ),
        sa.CheckConstraint(
            "created_at < verification_expires_at", name="verification_expiry_order"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_authentication_registrations"),
        sa.UniqueConstraint("email", name="uq_authentication_registrations_email"),
        sa.UniqueConstraint(
            "verification_token_hash",
            name="uq_authentication_registrations_verification_token_hash",
        ),
        sa.UniqueConstraint(
            "signup_token_hash", name="uq_authentication_registrations_signup_token_hash"
        ),
    )
    op.create_index(
        "ix_authentication_registrations_verification_expires_at",
        "authentication_registrations",
        ["verification_expires_at"],
    )
    op.create_index(
        "ix_authentication_registrations_signup_expires_at",
        "authentication_registrations",
        ["signup_expires_at"],
    )
    op.execute(
        """
        INSERT INTO authentication_registrations (
            id, email, verification_token_hash, verification_expires_at
        )
        SELECT id, email, token_hash, expires_at
        FROM (
            SELECT
                account.id,
                account.email,
                token.token_hash,
                token.expires_at,
                row_number() OVER (
                    PARTITION BY account.id ORDER BY token.created_at DESC
                ) AS token_rank
            FROM student_accounts AS account
            JOIN authentication_email_tokens AS token
                ON token.account_id = account.id
            WHERE account.email_verified_at IS NULL
              AND token.purpose = 'email_verification'
              AND token.consumed_at IS NULL
              AND token.expires_at > CURRENT_TIMESTAMP
        ) AS pending
        WHERE token_rank = 1
        """
    )
    op.execute(
        """
        UPDATE authentication_email_tokens
        SET consumed_at = CURRENT_TIMESTAMP
        WHERE purpose = 'email_verification'
          AND consumed_at IS NULL
          AND account_id IN (
              SELECT id FROM student_accounts WHERE email_verified_at IS NULL
          )
        """
    )


def downgrade() -> None:
    op.drop_index(
        "ix_authentication_registrations_signup_expires_at",
        table_name="authentication_registrations",
    )
    op.drop_index(
        "ix_authentication_registrations_verification_expires_at",
        table_name="authentication_registrations",
    )
    op.drop_table("authentication_registrations")
