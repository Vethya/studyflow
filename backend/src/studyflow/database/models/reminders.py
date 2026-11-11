"""Opt-in study reminder preferences and delivery bookkeeping."""

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from studyflow.database.base import Base


class ReminderPreference(Base):
    __tablename__ = "reminder_preferences"
    __table_args__ = (
        CheckConstraint(
            "before_session_minutes = 0 OR before_session_minutes BETWEEN 30 AND 120",
            name="before_session_minutes",
        ),
    )

    account_id: Mapped[UUID] = mapped_column(
        ForeignKey("student_accounts.id", ondelete="CASCADE"), primary_key=True
    )
    email_enabled: Mapped[bool] = mapped_column(Boolean, server_default="false")
    before_session_minutes: Mapped[int] = mapped_column(Integer, server_default="30")
    after_session: Mapped[bool] = mapped_column(Boolean, server_default="true")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class ReminderDelivery(Base):
    __tablename__ = "reminder_deliveries"
    __table_args__ = (
        CheckConstraint("kind IN ('before', 'after')", name="kind"),
        UniqueConstraint("session_id", "kind", name="uq_reminder_deliveries_session_kind"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    account_id: Mapped[UUID] = mapped_column(
        ForeignKey("student_accounts.id", ondelete="CASCADE"), index=True
    )
    session_id: Mapped[UUID] = mapped_column(ForeignKey("study_sessions.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(16))
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
