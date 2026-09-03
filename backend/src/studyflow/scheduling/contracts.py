"""Immutable contracts for the persistence-free scheduling kernel."""

from dataclasses import dataclass
from enum import StrEnum
from itertools import pairwise
from math import isfinite


def _require_int(name: str, value: object) -> None:
    if type(value) is not int:
        raise TypeError(f"{name} must be an integer")


@dataclass(frozen=True, slots=True, order=True)
class MinuteWindow:
    """Half-open UTC-minute interval ``[start, end)``."""

    start: int
    end: int

    def __post_init__(self) -> None:
        _require_int("minute window start", self.start)
        _require_int("minute window end", self.end)
        if self.end <= self.start:
            raise ValueError("minute window end must be after start")


@dataclass(frozen=True, slots=True, order=True)
class PlanningDay:
    """One account-local calendar day expressed as UTC-minute boundaries."""

    day_index: int
    start_minute: int
    end_minute: int

    def __post_init__(self) -> None:
        _require_int("planning day index", self.day_index)
        _require_int("planning day start", self.start_minute)
        _require_int("planning day end", self.end_minute)
        if self.day_index < 0:
            raise ValueError("planning day index must not be negative")
        if self.end_minute <= self.start_minute:
            raise ValueError("planning day end must be after start")


class TaskPriority(StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


@dataclass(frozen=True, slots=True)
class SessionDemand:
    """One indivisible fixed-duration session produced by exact task splitting."""

    session_id: str
    task_id: str
    duration_minutes: int
    deadline_minute: int
    allowed_windows: tuple[MinuteWindow, ...]
    priority: TaskPriority = TaskPriority.MEDIUM

    def __post_init__(self) -> None:
        if not self.session_id:
            raise ValueError("session_id must not be empty")
        if not self.task_id:
            raise ValueError("task_id must not be empty")
        _require_int("duration_minutes", self.duration_minutes)
        _require_int("deadline_minute", self.deadline_minute)
        if self.duration_minutes <= 0:
            raise ValueError("duration_minutes must be positive")
        if not isinstance(self.priority, TaskPriority):
            raise TypeError("priority must be a TaskPriority")


@dataclass(frozen=True, slots=True)
class FeasibilityProblem:
    """A normalized, in-memory scheduling problem."""

    sessions: tuple[SessionDemand, ...]
    planning_start_minute: int
    minimum_break_minutes: int = 0
    max_solve_seconds: float = 4.0
    planning_days: tuple[PlanningDay, ...] = ()

    def __post_init__(self) -> None:
        _require_int("planning_start_minute", self.planning_start_minute)
        _require_int("minimum_break_minutes", self.minimum_break_minutes)
        if not 0 <= self.minimum_break_minutes <= 120:
            raise ValueError("minimum_break_minutes must be between zero and 120")
        if (
            isinstance(self.max_solve_seconds, bool)
            or not isinstance(self.max_solve_seconds, (int, float))
            or not isfinite(self.max_solve_seconds)
            or not 0 < self.max_solve_seconds <= 4
        ):
            raise ValueError("max_solve_seconds must be greater than zero and at most four")
        session_ids = [session.session_id for session in self.sessions]
        if len(session_ids) != len(set(session_ids)):
            raise ValueError("session_id values must be unique")
        day_indices = [day.day_index for day in self.planning_days]
        if len(day_indices) != len(set(day_indices)):
            raise ValueError("planning day indices must be unique")
        chronological_days = sorted(self.planning_days, key=lambda day: day.start_minute)
        if any(
            following.start_minute < previous.end_minute
            for previous, following in pairwise(chronological_days)
        ):
            raise ValueError("planning days must not overlap")


class KernelStatus(StrEnum):
    FEASIBLE = "feasible"
    INFEASIBLE = "infeasible"
    OVERLOAD = "overload"
    TECHNICAL_FAILURE = "technical_failure"


@dataclass(frozen=True, slots=True)
class ScheduledSession:
    session_id: str
    task_id: str
    start_minute: int
    end_minute: int


@dataclass(frozen=True, slots=True)
class SolverDiagnostics:
    solver_status: str
    wall_time_seconds: float
    conflicts: int
    branches: int


@dataclass(frozen=True, slots=True)
class FeasibilityResult:
    status: KernelStatus
    sessions: tuple[ScheduledSession, ...]
    diagnostics: SolverDiagnostics
    detail: str | None = None


@dataclass(frozen=True, slots=True)
class TaskAllocation:
    """Per-task allocation with raw ranking capacity and solver-usable capacity."""

    task_id: str
    deadline_minute: int
    required_minutes: int
    scheduled_minutes: int
    unscheduled_minutes: int
    raw_calendar_capacity_minutes: int
    available_minutes_before_deadline: int
    shortfall_minutes: int


@dataclass(frozen=True, slots=True)
class OverloadResult:
    """A complete schedule, proven overload, or technical failure."""

    status: KernelStatus
    sessions: tuple[ScheduledSession, ...]
    allocations: tuple[TaskAllocation, ...]
    diagnostics: SolverDiagnostics
    detail: str | None = None
