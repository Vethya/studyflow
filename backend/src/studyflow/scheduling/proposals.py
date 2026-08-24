"""Inactive schedule proposal persistence contracts."""

from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum
from typing import Protocol
from uuid import UUID


class ProposalKind(StrEnum):
    GENERATION = "generation"
    REVISION = "revision"


class ProposalStatus(StrEnum):
    FEASIBLE = "feasible"
    OVERLOAD = "overload"


def _require_utc(value: datetime, name: str) -> None:
    if value.utcoffset() != timedelta(0):
        raise ValueError(f"{name} must be an aware UTC instant")


def _require_nonnegative(name: str, value: object) -> None:
    if type(value) is not int:
        raise TypeError(f"{name} must be an integer")
    if value < 0:
        raise ValueError(f"{name} must not be negative")


@dataclass(frozen=True, slots=True)
class NewProposedSession:
    task_id: UUID
    starts_at: datetime
    ends_at: datetime
    planned_duration_minutes: int

    def __post_init__(self) -> None:
        _require_utc(self.starts_at, "starts_at")
        _require_utc(self.ends_at, "ends_at")
        if self.ends_at <= self.starts_at:
            raise ValueError("ends_at must be after starts_at")
        _require_nonnegative("planned_duration_minutes", self.planned_duration_minutes)
        if self.planned_duration_minutes == 0:
            raise ValueError("planned_duration_minutes must be positive")
        if (
            self.starts_at.second
            or self.starts_at.microsecond
            or self.ends_at.second
            or self.ends_at.microsecond
        ):
            raise ValueError("Proposed sessions must use exact minute boundaries")
        if self.ends_at - self.starts_at != timedelta(minutes=self.planned_duration_minutes):
            raise ValueError("planned_duration_minutes must match the session interval")


@dataclass(frozen=True, slots=True)
class NewTaskAllocation:
    task_id: UUID
    deadline_at: datetime
    required_minutes: int
    scheduled_minutes: int
    unscheduled_minutes: int
    raw_calendar_capacity_minutes: int
    available_minutes_before_deadline: int
    shortfall_minutes: int

    def __post_init__(self) -> None:
        _require_utc(self.deadline_at, "deadline_at")
        for name in (
            "required_minutes",
            "scheduled_minutes",
            "unscheduled_minutes",
            "raw_calendar_capacity_minutes",
            "available_minutes_before_deadline",
            "shortfall_minutes",
        ):
            _require_nonnegative(name, getattr(self, name))
        if self.required_minutes != self.scheduled_minutes + self.unscheduled_minutes:
            raise ValueError("required_minutes must equal scheduled plus unscheduled minutes")


@dataclass(frozen=True, slots=True)
class NewScheduleProposal:
    kind: ProposalKind
    revision_reason: str | None
    status: ProposalStatus
    input_fingerprint: str
    sessions: tuple[NewProposedSession, ...]
    allocations: tuple[NewTaskAllocation, ...]

    def __post_init__(self) -> None:
        if not isinstance(self.kind, ProposalKind):
            raise TypeError("kind must be a ProposalKind")
        if not isinstance(self.status, ProposalStatus):
            raise TypeError("status must be a ProposalStatus")
        if len(self.input_fingerprint) != 64:
            raise ValueError("input_fingerprint must contain 64 characters")
        if self.kind is ProposalKind.GENERATION and self.revision_reason is not None:
            raise ValueError("Initial generation proposals cannot have a revision reason")
        if self.kind is ProposalKind.REVISION and (
            self.revision_reason is None or not self.revision_reason.strip()
        ):
            raise ValueError("Revision proposals require a revision reason")
        if self.revision_reason is not None and len(self.revision_reason) > 500:
            raise ValueError("revision_reason cannot exceed 500 characters")
        allocation_task_ids = [allocation.task_id for allocation in self.allocations]
        if len(allocation_task_ids) != len(set(allocation_task_ids)):
            raise ValueError("Proposal task allocations must be unique by task")
        if any(session.task_id not in allocation_task_ids for session in self.sessions):
            raise ValueError("Every proposed session must have a task allocation")


@dataclass(frozen=True, slots=True)
class StudySessionRecord:
    id: UUID
    account_id: UUID
    task_id: UUID
    proposal_id: UUID | None
    starts_at: datetime
    ends_at: datetime
    planned_duration_minutes: int


@dataclass(frozen=True, slots=True)
class TaskAllocationRecord:
    proposal_id: UUID
    task_id: UUID
    deadline_at: datetime
    required_minutes: int
    scheduled_minutes: int
    unscheduled_minutes: int
    raw_calendar_capacity_minutes: int
    available_minutes_before_deadline: int
    shortfall_minutes: int


@dataclass(frozen=True, slots=True)
class ScheduleProposalRecord:
    id: UUID
    account_id: UUID
    kind: ProposalKind
    revision_reason: str | None
    status: ProposalStatus
    input_fingerprint: str
    created_at: datetime
    sessions: tuple[StudySessionRecord, ...]
    allocations: tuple[TaskAllocationRecord, ...]


class ScheduleProposalRepository(Protocol):
    async def replace(
        self, account_id: UUID, proposal: NewScheduleProposal
    ) -> ScheduleProposalRecord | None: ...

    async def get(self, account_id: UUID) -> ScheduleProposalRecord | None: ...

    async def reject(self, account_id: UUID, proposal_id: UUID) -> bool: ...
