"""Merge overdue remediation and adaptive estimation migration branches.

Revision ID: 20260905_18
Revises: 20260903_17, 20260905_17
Create Date: 2026-09-05
"""

from collections.abc import Sequence

revision: str = "20260905_18"
down_revision: str | Sequence[str] | None = ("20260903_17", "20260905_17")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
