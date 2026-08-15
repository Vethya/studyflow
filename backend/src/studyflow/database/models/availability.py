"""Recurring and exceptional availability persistence."""

from datetime import time
from uuid import UUID, uuid4

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, Integer, Time
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
