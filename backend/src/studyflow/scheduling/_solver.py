"""Shared CP-SAT plumbing for the pure scheduling engines."""

from ortools.sat.python import cp_model

from studyflow.scheduling.contracts import SessionDemand, SolverDiagnostics


def candidate_start_intervals(demand: SessionDemand, planning_start_minute: int) -> list[list[int]]:
    intervals: list[list[int]] = []
    for window in demand.allowed_windows:
        latest_start = min(window.end, demand.deadline_minute) - demand.duration_minutes
        earliest_start = max(window.start, planning_start_minute)
        if earliest_start <= latest_start:
            intervals.append([earliest_start, latest_start])
    return intervals


def solver_diagnostics(
    solver: cp_model.CpSolver, status: cp_model.CpSolverStatus
) -> SolverDiagnostics:
    return SolverDiagnostics(
        solver_status=solver.status_name(status),
        wall_time_seconds=solver.wall_time,
        conflicts=solver.num_conflicts,
        branches=solver.num_branches,
    )


def empty_diagnostics(status: str) -> SolverDiagnostics:
    return SolverDiagnostics(status, 0.0, 0, 0)


def configured_solver(max_solve_seconds: float) -> cp_model.CpSolver:
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = max_solve_seconds
    solver.parameters.num_search_workers = 1
    solver.parameters.random_seed = 0
    return solver
