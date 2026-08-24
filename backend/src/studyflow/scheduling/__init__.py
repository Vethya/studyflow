"""Pure scheduling domain and Google OR-Tools kernel."""

from studyflow.scheduling.contracts import (
    FeasibilityProblem,
    FeasibilityResult,
    KernelStatus,
    MinuteWindow,
    OverloadResult,
    PlanningDay,
    ScheduledSession,
    SessionDemand,
    SolverDiagnostics,
    TaskAllocation,
    TaskPriority,
)
from studyflow.scheduling.kernel import solve_feasibility
from studyflow.scheduling.overload import classify_overload_status, solve_with_overload
from studyflow.scheduling.splitting import (
    MAX_SUPPORTED_SESSION_COUNT,
    SessionDraft,
    split_task,
    split_task_sessions,
)

__all__ = [
    "MAX_SUPPORTED_SESSION_COUNT",
    "FeasibilityProblem",
    "FeasibilityResult",
    "KernelStatus",
    "MinuteWindow",
    "OverloadResult",
    "PlanningDay",
    "ScheduledSession",
    "SessionDemand",
    "SessionDraft",
    "SolverDiagnostics",
    "TaskAllocation",
    "TaskPriority",
    "classify_overload_status",
    "solve_feasibility",
    "solve_with_overload",
    "split_task",
    "split_task_sessions",
]
