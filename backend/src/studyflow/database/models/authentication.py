"""Persistence models for accounts and authentication credentials."""

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from studyflow.database.base import Base


class StudentAccount(Base):
    __tablename__ = "student_accounts"
    __table_args__ = (
        CheckConstraint("email = lower(email) AND email <> ''", name="email_canonical"),
        CheckConstraint(
            "preferred_session_length_minutes BETWEEN 10 AND 240",
            name="preferred_session_length",
        ),
        CheckConstraint(
            "minimum_break_minutes BETWEEN 0 AND 120",
            name="minimum_break",
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    email: Mapped[str] = mapped_column(String(320), unique=True)
    name: Mapped[str] = mapped_column(String(200))
    password_hash: Mapped[str | None] = mapped_column(Text, nullable=True)
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    timezone: Mapped[str] = mapped_column(String(64), server_default="UTC")
    preferred_session_length_minutes: Mapped[int] = mapped_column(
        Integer,
        server_default="60",
    )
    minimum_break_minutes: Mapped[int] = mapped_column(Integer, server_default="10")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class AuthenticationIdentity(Base):
    __tablename__ = "authentication_identities"
    __table_args__ = (
        CheckConstraint("provider IN ('google')", name="supported_provider"),
        UniqueConstraint(
            "provider", "subject", name="uq_authentication_identities_provider_subject"
        ),
        UniqueConstraint(
            "account_id",
            "provider",
            name="uq_authentication_identities_account_provider",
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    account_id: Mapped[UUID] = mapped_column(
        ForeignKey("student_accounts.id", ondelete="CASCADE"),
        index=True,
    )
    provider: Mapped[str] = mapped_column(String(32))
    subject: Mapped[str] = mapped_column(String(255))
    email: Mapped[str] = mapped_column(String(320))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )


class AuthenticationSession(Base):
    __tablename__ = "authentication_sessions"
    __table_args__ = (
        CheckConstraint("length(token_hash) = 64", name="token_hash_length"),
        CheckConstraint("length(csrf_token_hash) = 64", name="csrf_token_hash_length"),
        CheckConstraint(
            "created_at < idle_expires_at AND idle_expires_at <= absolute_expires_at",
            name="expiry_order",
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    account_id: Mapped[UUID] = mapped_column(
        ForeignKey("student_accounts.id", ondelete="CASCADE"),
        index=True,
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    csrf_token_hash: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
    idle_expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    absolute_expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AuthenticationEmailToken(Base):
    __tablename__ = "authentication_email_tokens"
    __table_args__ = (
        CheckConstraint(
            "purpose IN ('email_verification', 'password_reset')",
            name="supported_purpose",
        ),
        CheckConstraint("length(token_hash) = 64", name="token_hash_length"),
        CheckConstraint("created_at < expires_at", name="expiry_order"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    account_id: Mapped[UUID] = mapped_column(
        ForeignKey("student_accounts.id", ondelete="CASCADE"),
        index=True,
    )
    purpose: Mapped[str] = mapped_column(String(32), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AuthenticationRateLimit(Base):
    __tablename__ = "authentication_rate_limits"
    __table_args__ = (
        CheckConstraint("length(key_hash) = 64", name="key_hash_length"),
        CheckConstraint("attempts > 0", name="positive_attempts"),
        UniqueConstraint("action", "key_hash", name="uq_authentication_rate_limits_action_key"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    action: Mapped[str] = mapped_column(String(32))
    key_hash: Mapped[str] = mapped_column(String(64))
    window_started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    attempts: Mapped[int] = mapped_column(Integer)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )
