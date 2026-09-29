"""Short-lived persistence for one-time Google Calendar and Classroom imports.

StudyFlow never stores Google access or refresh tokens. An import stores only
the OAuth state needed to finish the redirect and, afterwards, a snapshot of
the items the student can choose from. Both expire within minutes.
"""

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import JSON, CheckConstraint, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from studyflow.database.base import Base

GOOGLE_IMPORT_SOURCES = "('google_calendar', 'google_classroom')"


class GoogleImportState(Base):
    __tablename__ = "google_import_states"
    __table_args__ = (
        CheckConstraint("length(state_hash) = 64", name="state_hash_length"),
        CheckConstraint(f"source IN {GOOGLE_IMPORT_SOURCES}", name="source"),
        CheckConstraint("length(code_verifier) BETWEEN 43 AND 128", name="code_verifier_length"),
        CheckConstraint("horizon_days BETWEEN 1 AND 90", name="horizon_days"),
        CheckConstraint("created_at < expires_at", name="expiry_order"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    account_id: Mapped[UUID] = mapped_column(
        ForeignKey("student_accounts.id", ondelete="CASCADE"), index=True
    )
    state_hash: Mapped[str] = mapped_column(String(64), unique=True)
    source: Mapped[str] = mapped_column(String(32))
    code_verifier: Mapped[str] = mapped_column(String(128))
    horizon_days: Mapped[int] = mapped_column(Integer)
    redirect_uri: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class GoogleImportSnapshot(Base):
    __tablename__ = "google_import_snapshots"
    __table_args__ = (
        CheckConstraint(f"source IN {GOOGLE_IMPORT_SOURCES}", name="source"),
        CheckConstraint("created_at < expires_at", name="expiry_order"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    account_id: Mapped[UUID] = mapped_column(
        ForeignKey("student_accounts.id", ondelete="CASCADE"), index=True
    )
    source: Mapped[str] = mapped_column(String(32))
    items: Mapped[list[dict[str, object]]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class GoogleImportCheck(Base):
    """When a student last asked Google for this source's data.

    Only the timestamp is kept, so StudyFlow can say "last checked six days
    ago" without holding any Google access. A future background sync can hang
    its own state off the same row.
    """

    __tablename__ = "google_import_checks"
    __table_args__ = (CheckConstraint(f"source IN {GOOGLE_IMPORT_SOURCES}", name="source"),)

    account_id: Mapped[UUID] = mapped_column(
        ForeignKey("student_accounts.id", ondelete="CASCADE"), primary_key=True
    )
    source: Mapped[str] = mapped_column(String(32), primary_key=True)
    checked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
