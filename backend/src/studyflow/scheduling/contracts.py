"""Immutable contracts for the persistence-free scheduling kernel."""

from dataclasses import dataclass
from enum import StrEnum


@dataclass(frozen=True, slots=True, order=True)
class MinuteWindow:
    """Half-open UTC-minute interval ``[start, end)``."""

    start: int
    end: int

    def __post_init__(self) -> None:
        if self.end <= self.start:
            raise ValueError("minute window end must be after start")


@dataclass(frozen=True, slots=True)
class SessionDemand:
    """One fixed-duration session that must be placed in an allowed window."""

    session_id: str
    task_id: str
    duration_minutes: int
    deadline_minute: int
    allowed_windows: tuple[MinuteWindow, ...]

    def __post_init__(self) -> None:
        if not self.session_id:
            raise ValueError("session_id must not be empty")
        if not self.task_id:
            raise ValueError("task_id must not be empty")
        if self.duration_minutes <= 0:
            raise ValueError("duration_minutes must be positive")


@dataclass(frozen=True, slots=True)
class FeasibilityProblem:
    """A normalized, in-memory scheduling problem."""

    sessions: tuple[SessionDemand, ...]
    minimum_break_minutes: int = 0
    max_solve_seconds: float = 4.0

    def __post_init__(self) -> None:
        if self.minimum_break_minutes < 0:
            raise ValueError("minimum_break_minutes must not be negative")
        if not 0 < self.max_solve_seconds <= 5:
            raise ValueError("max_solve_seconds must be greater than zero and at most five")
        session_ids = [session.session_id for session in self.sessions]
        if len(session_ids) != len(set(session_ids)):
            raise ValueError("session_id values must be unique")


class KernelStatus(StrEnum):
    FEASIBLE = "feasible"
    INFEASIBLE = "infeasible"
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
