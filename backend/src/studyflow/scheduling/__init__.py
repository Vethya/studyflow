"""Pure scheduling domain and Google OR-Tools kernel."""

from studyflow.scheduling.contracts import (
    FeasibilityProblem,
    FeasibilityResult,
    KernelStatus,
    MinuteWindow,
    ScheduledSession,
    SessionDemand,
    SolverDiagnostics,
)
from studyflow.scheduling.kernel import solve_feasibility

__all__ = [
    "FeasibilityProblem",
    "FeasibilityResult",
    "KernelStatus",
    "MinuteWindow",
    "ScheduledSession",
    "SessionDemand",
    "SolverDiagnostics",
    "solve_feasibility",
]
