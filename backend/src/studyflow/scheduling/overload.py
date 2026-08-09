"""Overload-aware scheduling policy on top of the exact-minute CP-SAT model."""

from collections import defaultdict
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
    KernelStatus,
    MinuteWindow,
    OverloadResult,
    ScheduledSession,
    SessionDemand,
    TaskAllocation,
    TaskPriority,
)

_PRIORITY_WEIGHT = {
    TaskPriority.LOW: 0,
    TaskPriority.MEDIUM: 1,
    TaskPriority.HIGH: 2,
}


@dataclass(frozen=True, slots=True)
class _TaskDemand:
    task_id: str
    deadline_minute: int
    priority: TaskPriority
    allowed_windows: tuple[MinuteWindow, ...]
    required_minutes: int
    calendar_capacity_minutes: int

    @property
    def slack_minutes(self) -> int:
        return self.calendar_capacity_minutes - self.required_minutes


@dataclass(frozen=True, slots=True)
class _OptionalSessionVariable:
    demand: SessionDemand
    start: cp_model.IntVar | None
    presence: cp_model.IntVar | None


def _calendar_capacity(
    windows: tuple[MinuteWindow, ...], planning_start_minute: int, deadline_minute: int
) -> int:
    clipped = sorted(
        (max(window.start, planning_start_minute), min(window.end, deadline_minute))
        for window in windows
        if max(window.start, planning_start_minute) < min(window.end, deadline_minute)
    )
    if not clipped:
        return 0

    merged: list[tuple[int, int]] = []
    for start, end in clipped:
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return sum(end - start for start, end in merged)


def _task_demands(problem: FeasibilityProblem) -> tuple[_TaskDemand, ...]:
    sessions_by_task: dict[str, list[SessionDemand]] = defaultdict(list)
    for session in problem.sessions:
        sessions_by_task[session.task_id].append(session)

    tasks: list[_TaskDemand] = []
    for task_id, sessions in sessions_by_task.items():
        reference = sessions[0]
        if any(
            session.deadline_minute != reference.deadline_minute
            or session.priority is not reference.priority
            or session.allowed_windows != reference.allowed_windows
            for session in sessions[1:]
        ):
            raise ValueError(
                f"Sessions for task {task_id!r} must share deadline, priority, and windows"
            )
        required_minutes = sum(session.duration_minutes for session in sessions)
        tasks.append(
            _TaskDemand(
                task_id,
                reference.deadline_minute,
                reference.priority,
                reference.allowed_windows,
                required_minutes,
                _calendar_capacity(
                    reference.allowed_windows,
                    problem.planning_start_minute,
                    reference.deadline_minute,
                ),
            )
        )
    return tuple(tasks)


def _policy_order(tasks: tuple[_TaskDemand, ...]) -> tuple[_TaskDemand, ...]:
    """Order tasks by least slack, deadline, work, priority, then stable ID."""

    return tuple(
        sorted(
            tasks,
            key=lambda task: (
                task.slack_minutes,
                task.deadline_minute,
                -task.required_minutes,
                -_PRIORITY_WEIGHT[task.priority],
                task.task_id,
            ),
        )
    )


def classify_overload_status(
    solver_status: cp_model.CpSolverStatus, *, all_sessions_scheduled: bool
) -> KernelStatus:
    """Conservatively classify a solver result without inventing overload."""

    if solver_status == cp_model.OPTIMAL:
        return KernelStatus.FEASIBLE if all_sessions_scheduled else KernelStatus.OVERLOAD
    if solver_status == cp_model.FEASIBLE and all_sessions_scheduled:
        return KernelStatus.FEASIBLE
    return KernelStatus.TECHNICAL_FAILURE


def _allocations(
    tasks: tuple[_TaskDemand, ...], scheduled_session_ids: set[str], problem: FeasibilityProblem
) -> tuple[TaskAllocation, ...]:
    scheduled_by_task: dict[str, int] = defaultdict(int)
    for session in problem.sessions:
        if session.session_id in scheduled_session_ids:
            scheduled_by_task[session.task_id] += session.duration_minutes

    return tuple(
        TaskAllocation(
            task_id=task.task_id,
            deadline_minute=task.deadline_minute,
            required_minutes=task.required_minutes,
            scheduled_minutes=scheduled_by_task[task.task_id],
            unscheduled_minutes=task.required_minutes - scheduled_by_task[task.task_id],
            calendar_capacity_minutes=task.calendar_capacity_minutes,
            shortfall_minutes=task.required_minutes - scheduled_by_task[task.task_id],
        )
        for task in sorted(tasks, key=lambda item: item.task_id)
    )


def solve_with_overload(problem: FeasibilityProblem) -> OverloadResult:
    """Schedule the best feasible portion and report proven excess work."""

    if not problem.sessions:
        return OverloadResult(
            KernelStatus.FEASIBLE,
            (),
            (),
            empty_diagnostics("EMPTY"),
        )

    tasks = _task_demands(problem)
    task_scores = {
        task.task_id: len(tasks) - index for index, task in enumerate(_policy_order(tasks))
    }

    model = cp_model.CpModel()
    variables: list[_OptionalSessionVariable] = []
    intervals: list[cp_model.IntervalVar] = []
    objective_terms: list[cp_model.LinearExpr] = []

    for demand in problem.sessions:
        candidate_intervals = candidate_start_intervals(demand, problem.planning_start_minute)
        if not candidate_intervals:
            variables.append(_OptionalSessionVariable(demand, None, None))
            continue

        start = model.new_int_var_from_domain(
            cp_model.Domain.from_intervals(candidate_intervals),
            f"start_{demand.session_id}",
        )
        presence = model.new_bool_var(f"present_{demand.session_id}")
        interval = model.new_optional_fixed_size_interval_var(
            start,
            demand.duration_minutes + problem.minimum_break_minutes,
            presence,
            f"session_with_break_{demand.session_id}",
        )
        variables.append(_OptionalSessionVariable(demand, start, presence))
        intervals.append(interval)
        objective_terms.append(presence * demand.duration_minutes * task_scores[demand.task_id])

    model.add_no_overlap(intervals)
    model.maximize(sum(objective_terms))
    validation_error = model.validate()
    if validation_error:
        return OverloadResult(
            KernelStatus.TECHNICAL_FAILURE,
            (),
            (),
            empty_diagnostics("MODEL_INVALID"),
            validation_error,
        )

    solver = configured_solver(problem.max_solve_seconds)
    try:
        solver_status = solver.solve(model)
    except (RuntimeError, ValueError) as error:
        return OverloadResult(
            KernelStatus.TECHNICAL_FAILURE,
            (),
            (),
            empty_diagnostics("EXCEPTION"),
            str(error),
        )

    diagnostics = solver_diagnostics(solver, solver_status)
    present_variables = (
        [
            variable
            for variable in variables
            if variable.presence is not None and solver.boolean_value(variable.presence)
        ]
        if solver_status in (cp_model.OPTIMAL, cp_model.FEASIBLE)
        else []
    )
    all_sessions_scheduled = len(present_variables) == len(problem.sessions)
    status = classify_overload_status(
        solver_status,
        all_sessions_scheduled=all_sessions_scheduled,
    )
    if status is KernelStatus.TECHNICAL_FAILURE:
        return OverloadResult(
            status,
            (),
            (),
            diagnostics,
            "The solver stopped without a proven overload allocation",
        )

    scheduled = tuple(
        sorted(
            (
                ScheduledSession(
                    variable.demand.session_id,
                    variable.demand.task_id,
                    solver.value(variable.start),
                    solver.value(variable.start) + variable.demand.duration_minutes,
                )
                for variable in present_variables
                if variable.start is not None
            ),
            key=lambda session: (session.start_minute, session.session_id),
        )
    )
    scheduled_ids = {session.session_id for session in scheduled}
    return OverloadResult(
        status,
        scheduled,
        _allocations(tasks, scheduled_ids, problem),
        diagnostics,
        "Some work could not fit before its deadline" if status is KernelStatus.OVERLOAD else None,
    )
