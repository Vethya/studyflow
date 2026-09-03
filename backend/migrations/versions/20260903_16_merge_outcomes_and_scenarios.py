"""Merge adaptive schema migration heads.

Revision ID: 20260903_16
Revises: 20260901_15, 20260903_15
Create Date: 2026-09-03
"""

from collections.abc import Sequence

revision: str = "20260903_16"
down_revision: str | Sequence[str] | None = ("20260901_15", "20260903_15")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
