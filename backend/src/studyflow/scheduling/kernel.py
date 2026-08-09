"""Exact-minute CP-SAT feasibility kernel.

The kernel deliberately accepts normalized concrete windows. Weekly calendar
expansion, persistence, overload allocation, and API orchestration belong to
later layers.
"""

from dataclasses import dataclass

from ortools.sat.python import cp_model

from studyflow.scheduling.contracts import (
    FeasibilityProblem,
    FeasibilityResult,
    KernelStatus,
    ScheduledSession,
    SessionDemand,
    SolverDiagnostics,
)


@dataclass(frozen=True, slots=True)
class _SessionVariable:
    demand: SessionDemand
    start: cp_model.IntVar


def _candidate_start_intervals(
    demand: SessionDemand, planning_start_minute: int
) -> list[list[int]]:
    intervals: list[list[int]] = []
    for window in demand.allowed_windows:
        latest_start = min(window.end, demand.deadline_minute) - demand.duration_minutes
        earliest_start = max(window.start, planning_start_minute)
        if earliest_start <= latest_start:
            intervals.append([earliest_start, latest_start])
    return intervals


def _diagnostics(solver: cp_model.CpSolver, status: cp_model.CpSolverStatus) -> SolverDiagnostics:
    return SolverDiagnostics(
        solver_status=solver.status_name(status),
        wall_time_seconds=solver.wall_time,
        conflicts=solver.num_conflicts,
        branches=solver.num_branches,
    )


def _empty_diagnostics(status: str) -> SolverDiagnostics:
    return SolverDiagnostics(status, 0.0, 0, 0)


def solve_feasibility(problem: FeasibilityProblem) -> FeasibilityResult:
    """Place every session or report why no complete placement was produced."""

    if not problem.sessions:
        return FeasibilityResult(
            KernelStatus.FEASIBLE,
            (),
            _empty_diagnostics("EMPTY"),
        )

    model = cp_model.CpModel()
    variables: list[_SessionVariable] = []
    intervals: list[cp_model.IntervalVar] = []

    for demand in problem.sessions:
        candidate_intervals = _candidate_start_intervals(demand, problem.planning_start_minute)
        if not candidate_intervals:
            return FeasibilityResult(
                KernelStatus.INFEASIBLE,
                (),
                _empty_diagnostics("EMPTY_DOMAIN"),
                f"Session {demand.session_id!r} has no valid start time",
            )

        start = model.new_int_var_from_domain(
            cp_model.Domain.from_intervals(candidate_intervals),
            f"start_{demand.session_id}",
        )
        extended_size = demand.duration_minutes + problem.minimum_break_minutes
        interval = model.new_fixed_size_interval_var(
            start,
            extended_size,
            f"session_with_break_{demand.session_id}",
        )
        variables.append(_SessionVariable(demand, start))
        intervals.append(interval)

    model.add_no_overlap(intervals)
    validation_error = model.validate()
    if validation_error:
        return FeasibilityResult(
            KernelStatus.TECHNICAL_FAILURE,
            (),
            _empty_diagnostics("MODEL_INVALID"),
            validation_error,
        )

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = problem.max_solve_seconds
    solver.parameters.num_search_workers = 1
    solver.parameters.random_seed = 0

    try:
        status = solver.solve(model)
    except (RuntimeError, ValueError) as error:
        return FeasibilityResult(
            KernelStatus.TECHNICAL_FAILURE,
            (),
            _empty_diagnostics("EXCEPTION"),
            str(error),
        )

    diagnostics = _diagnostics(solver, status)
    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        scheduled = tuple(
            sorted(
                (
                    ScheduledSession(
                        item.demand.session_id,
                        item.demand.task_id,
                        solver.value(item.start),
                        solver.value(item.start) + item.demand.duration_minutes,
                    )
                    for item in variables
                ),
                key=lambda session: (session.start_minute, session.session_id),
            )
        )
        return FeasibilityResult(KernelStatus.FEASIBLE, scheduled, diagnostics)

    if status == cp_model.INFEASIBLE:
        return FeasibilityResult(
            KernelStatus.INFEASIBLE,
            (),
            diagnostics,
            "No conflict-free placement exists for every session",
        )

    return FeasibilityResult(
        KernelStatus.TECHNICAL_FAILURE,
        (),
        diagnostics,
        "The solver stopped without a usable schedule",
    )
