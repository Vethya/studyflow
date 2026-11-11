"""Recurring and exceptional availability persistence."""

from datetime import datetime, time
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Time,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from studyflow.database.base import Base


class AvailabilityWindow(Base):
    __tablename__ = "availability_windows"
    __table_args__ = (CheckConstraint("weekday BETWEEN 0 AND 6", name="weekday"),)

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    account_id: Mapped[UUID] = mapped_column(
        ForeignKey("student_accounts.id", ondelete="CASCADE"), index=True
    )
    weekday: Mapped[int] = mapped_column(Integer)
    local_start_time: Mapped[time] = mapped_column(Time)
    local_end_time: Mapped[time] = mapped_column(Time)
    crosses_midnight: Mapped[bool] = mapped_column(Boolean)


class UnavailablePeriod(Base):
    __tablename__ = "unavailable_periods"
    __table_args__ = (
        CheckConstraint("ends_at > starts_at", name="expiry_order"),
        CheckConstraint("reason IS NULL OR length(reason) <= 200", name="reason_length"),
        CheckConstraint(
            "(external_source IS NULL AND external_id IS NULL) OR "
            "(external_source = 'google_calendar' AND length(external_id) = 64)",
            name="external_reference",
        ),
        UniqueConstraint(
            "account_id",
            "external_source",
            "external_id",
            name="uq_unavailable_periods_external_reference",
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    account_id: Mapped[UUID] = mapped_column(
        ForeignKey("student_accounts.id", ondelete="CASCADE"), index=True
    )
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    reason: Mapped[str | None] = mapped_column(String(200))
    # Set only for periods imported from Google Calendar, so a repeat import updates them.
    external_source: Mapped[str | None] = mapped_column(String(32))
    external_id: Mapped[str | None] = mapped_column(String(64))
