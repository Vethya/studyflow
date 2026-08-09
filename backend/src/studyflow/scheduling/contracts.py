"""Immutable contracts for the persistence-free scheduling kernel."""

from dataclasses import dataclass
from enum import StrEnum
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
        _require_int("duration_minutes", self.duration_minutes)
        _require_int("deadline_minute", self.deadline_minute)
        if self.duration_minutes <= 0:
            raise ValueError("duration_minutes must be positive")


@dataclass(frozen=True, slots=True)
class FeasibilityProblem:
    """A normalized, in-memory scheduling problem."""

    sessions: tuple[SessionDemand, ...]
    planning_start_minute: int
    minimum_break_minutes: int = 0
    max_solve_seconds: float = 4.0

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
