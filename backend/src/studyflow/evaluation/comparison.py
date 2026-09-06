"""Static vs adaptive technical comparison tooling (§24.6)."""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from itertools import pairwise
from time import perf_counter
from uuid import UUID

from studyflow.scheduling.contracts import (
    FeasibilityProblem,
    KernelStatus,
    OverloadResult,
    ScheduledSession,
    SessionDemand,
    TaskAllocation,
)
from studyflow.scheduling.overload import solve_with_overload


@dataclass(frozen=True, slots=True)
class PredictionEvaluation:
    """A saved prediction joined to a task's later completion outcome."""

    task_id: UUID
    original_minutes: int
    adaptive_minutes: int
    actual_minutes: int | None
    completed_at: datetime | None


@dataclass(frozen=True, slots=True)
class ScheduleStabilityMetrics:
    """Schedule stability / replanning disruption metrics per SPEC §24.6."""

    sessions_moved: int
    total_absolute_minutes_shifted: int
    sessions_added: int
    sessions_removed: int
    minutes_left_unscheduled: int


@dataclass(frozen=True, slots=True)
class EstimationAccuracyMetrics:
    """Internal estimation accuracy and signed bias metrics per SPEC §16.2 & §24.6."""

    sample_count: int
    original_mae: float
    adaptive_mae: float
    original_signed_bias: float
    adaptive_signed_bias: float
    mae_reduction_percentage: float


@dataclass(frozen=True, slots=True)
class ScheduleRunResult:
    """Execution outcome for one scheduling pipeline run."""

    status: KernelStatus
    sessions: tuple[ScheduledSession, ...]
    allocations: tuple[TaskAllocation, ...]
    generation_time_seconds: float
    hard_constraint_violations: int
    deadline_feasible: bool
    total_unscheduled_minutes: int
    successful_recovery: bool = False


@dataclass(frozen=True, slots=True)
class ScheduleComparisonResult:
    """Complete static vs adaptive comparison per SPEC §24.6."""

    static_run: ScheduleRunResult
    adaptive_run: ScheduleRunResult
    stability_vs_static: ScheduleStabilityMetrics
    estimation_metrics: EstimationAccuracyMetrics | None


def compute_schedule_stability(
    previous_sessions: Sequence[ScheduledSession],
    new_sessions: Sequence[ScheduledSession],
    minutes_left_unscheduled: int = 0,
) -> ScheduleStabilityMetrics:
    """Calculate schedule change/stability metrics between two schedule versions."""
    prev_by_id = {s.session_id: s for s in previous_sessions}
    new_by_id = {s.session_id: s for s in new_sessions}

    sessions_moved = 0
    total_absolute_minutes_shifted = 0

    for session_id, prev_session in prev_by_id.items():
        if session_id in new_by_id:
            new_session = new_by_id[session_id]
            if prev_session.start_minute != new_session.start_minute:
                sessions_moved += 1
            total_absolute_minutes_shifted += abs(
                new_session.start_minute - prev_session.start_minute
            )

    sessions_added = len(set(new_by_id.keys()) - set(prev_by_id.keys()))
    sessions_removed = len(set(prev_by_id.keys()) - set(new_by_id.keys()))

    return ScheduleStabilityMetrics(
        sessions_moved=sessions_moved,
        total_absolute_minutes_shifted=total_absolute_minutes_shifted,
        sessions_added=sessions_added,
        sessions_removed=sessions_removed,
        minutes_left_unscheduled=minutes_left_unscheduled,
    )


def compute_estimation_metrics(
    evaluations: Sequence[PredictionEvaluation],
) -> EstimationAccuracyMetrics:
    """Calculate MAE, signed estimation bias, and relative improvement from prediction records."""
    completed = [
        e
        for e in evaluations
        if e.completed_at is not None and e.actual_minutes is not None and e.actual_minutes > 0
    ]
    if not completed:
        return EstimationAccuracyMetrics(
            sample_count=0,
            original_mae=0.0,
            adaptive_mae=0.0,
            original_signed_bias=0.0,
            adaptive_signed_bias=0.0,
            mae_reduction_percentage=0.0,
        )

    count = len(completed)
    original_abs_errors = [abs(e.original_minutes - e.actual_minutes) for e in completed]  # type: ignore[operator]
    adaptive_abs_errors = [abs(e.adaptive_minutes - e.actual_minutes) for e in completed]  # type: ignore[operator]
    original_signed_errors = [e.original_minutes - e.actual_minutes for e in completed]  # type: ignore[operator]
    adaptive_signed_errors = [e.adaptive_minutes - e.actual_minutes for e in completed]  # type: ignore[operator]

    original_mae = sum(original_abs_errors) / count
    adaptive_mae = sum(adaptive_abs_errors) / count
    original_signed_bias = sum(original_signed_errors) / count
    adaptive_signed_bias = sum(adaptive_signed_errors) / count

    reduction = (
        ((original_mae - adaptive_mae) / original_mae) * 100.0 if original_mae > 0.0 else 0.0
    )

    return EstimationAccuracyMetrics(
        sample_count=count,
        original_mae=original_mae,
        adaptive_mae=adaptive_mae,
        original_signed_bias=original_signed_bias,
        adaptive_signed_bias=adaptive_signed_bias,
        mae_reduction_percentage=reduction,
    )


def check_hard_constraint_violations(
    sessions: Sequence[ScheduledSession],
    problem: FeasibilityProblem,
) -> int:
    """Count hard-constraint violations (overlaps, break-time violations, window violations)."""
    violations = 0
    sorted_sessions = sorted(sessions, key=lambda s: s.start_minute)

    # 1. Break time & overlap violation check
    for prev, following in pairwise(sorted_sessions):
        if following.start_minute < prev.end_minute + problem.minimum_break_minutes:
            violations += 1

    # 2. Window, deadline, task ownership, and duration adherence check
    demands_by_id: dict[str, SessionDemand] = {d.session_id: d for d in problem.sessions}
    for session in sessions:
        demand = demands_by_id.get(session.session_id)
        if demand is None:
            violations += 1
            continue
        if session.task_id != demand.task_id:
            violations += 1
        if (session.end_minute - session.start_minute) != demand.duration_minutes:
            violations += 1
        if session.end_minute > demand.deadline_minute:
            violations += 1
        # Check if contained in at least one allowed window
        contained = any(
            w.start <= session.start_minute and session.end_minute <= w.end
            for w in demand.allowed_windows
        )
        if not contained:
            violations += 1

    return violations


def solve_and_measure(problem: FeasibilityProblem) -> ScheduleRunResult:
    """Run solver on a problem and measure runtime, constraint violations, and allocations."""
    started = perf_counter()
    result: OverloadResult = solve_with_overload(problem)
    duration = perf_counter() - started

    violations = check_hard_constraint_violations(result.sessions, problem)
    total_unscheduled = sum(item.unscheduled_minutes for item in result.allocations)
    deadline_feasible = result.status is KernelStatus.FEASIBLE
    successful_recovery = deadline_feasible and violations == 0 and total_unscheduled == 0

    return ScheduleRunResult(
        status=result.status,
        sessions=result.sessions,
        allocations=result.allocations,
        generation_time_seconds=duration,
        hard_constraint_violations=violations,
        deadline_feasible=deadline_feasible,
        total_unscheduled_minutes=total_unscheduled,
        successful_recovery=successful_recovery,
    )


def compare_static_vs_adaptive(
    static_problem: FeasibilityProblem,
    adaptive_problem: FeasibilityProblem,
    evaluations: Sequence[PredictionEvaluation] | None = None,
) -> ScheduleComparisonResult:
    """Compare static vs adaptive schedules on identical problem fixtures per SPEC §24.6."""
    static_run = solve_and_measure(static_problem)
    adaptive_run = solve_and_measure(adaptive_problem)

    stability = compute_schedule_stability(
        previous_sessions=static_run.sessions,
        new_sessions=adaptive_run.sessions,
        minutes_left_unscheduled=adaptive_run.total_unscheduled_minutes,
    )

    est_metrics = compute_estimation_metrics(evaluations) if evaluations else None

    return ScheduleComparisonResult(
        static_run=static_run,
        adaptive_run=adaptive_run,
        stability_vs_static=stability,
        estimation_metrics=est_metrics,
    )
