"""Pure scheduling domain and Google OR-Tools kernel."""

from studyflow.scheduling.assembly import (
    AvailabilityTimezoneConfirmationRequiredError,
    SchedulingInputError,
    SchedulingInputTooLargeError,
    assemble_schedule_problem,
)
from studyflow.scheduling.calendar import ExpandedCalendar, expand_calendar
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
    SessionDraft,
    SessionSplit,
    split_task,
    split_task_sessions,
)

__all__ = [
    "AvailabilityTimezoneConfirmationRequiredError",
    "ExpandedCalendar",
    "FeasibilityProblem",
    "FeasibilityResult",
    "KernelStatus",
    "MinuteWindow",
    "OverloadResult",
    "PlanningDay",
    "ScheduledSession",
    "SchedulingInputError",
    "SchedulingInputTooLargeError",
    "SessionDemand",
    "SessionDraft",
    "SessionSplit",
    "SolverDiagnostics",
    "TaskAllocation",
    "TaskPriority",
    "assemble_schedule_problem",
    "classify_overload_status",
    "expand_calendar",
    "solve_feasibility",
    "solve_with_overload",
    "split_task",
    "split_task_sessions",
]
