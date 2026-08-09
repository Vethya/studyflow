"""Exact-minute CP-SAT feasibility kernel.

The kernel deliberately accepts normalized concrete windows. Weekly calendar
expansion, persistence, overload allocation, and API orchestration belong to
later layers.
"""

from dataclasses import dataclass

from ortools.sat.python import cp_model

from studyflow.scheduling._solver import (
    candidate_start_intervals,
    configured_solver,
    empty_diagnostics,
    solver_diagnostics,
)
from studyflow.scheduling.contracts import (
    FeasibilityProblem,
    FeasibilityResult,
    KernelStatus,
    ScheduledSession,
    SessionDemand,
)


@dataclass(frozen=True, slots=True)
class _SessionVariable:
    demand: SessionDemand
    start: cp_model.IntVar


def solve_feasibility(problem: FeasibilityProblem) -> FeasibilityResult:
    """Place every session or report why no complete placement was produced."""

    if not problem.sessions:
        return FeasibilityResult(
            KernelStatus.FEASIBLE,
            (),
            empty_diagnostics("EMPTY"),
        )

    model = cp_model.CpModel()
    variables: list[_SessionVariable] = []
    intervals: list[cp_model.IntervalVar] = []

    for demand in problem.sessions:
        candidate_intervals = candidate_start_intervals(demand, problem.planning_start_minute)
        if not candidate_intervals:
            return FeasibilityResult(
                KernelStatus.INFEASIBLE,
                (),
                empty_diagnostics("EMPTY_DOMAIN"),
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
            empty_diagnostics("MODEL_INVALID"),
            validation_error,
        )

    solver = configured_solver(problem.max_solve_seconds)

    try:
        status = solver.solve(model)
    except (RuntimeError, ValueError) as error:
        return FeasibilityResult(
            KernelStatus.TECHNICAL_FAILURE,
            (),
            empty_diagnostics("EXCEPTION"),
            str(error),
        )

    diagnostics = solver_diagnostics(solver, status)
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
