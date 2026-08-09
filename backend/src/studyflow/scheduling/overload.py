"""Overload-aware scheduling policy on top of the exact-minute CP-SAT model."""

from collections import defaultdict
from dataclasses import dataclass
from time import monotonic
from typing import cast

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
    required_break_minutes: int
    calendar_capacity_minutes: int

    @property
    def slack_minutes(self) -> int:
        return self.calendar_capacity_minutes - self.required_minutes - self.required_break_minutes


@dataclass(frozen=True, slots=True)
class _OptionalSessionVariable:
    demand: SessionDemand
    start: cp_model.IntVar | None
    presence: cp_model.IntVar | None


class _PolicyPreparationError(RuntimeError):
    def __init__(self, solver_status: str, detail: str) -> None:
        self.solver_status = solver_status
        super().__init__(detail)


def _merged_windows(
    windows: tuple[MinuteWindow, ...], planning_start_minute: int, deadline_minute: int
) -> tuple[tuple[int, int], ...]:
    clipped = sorted(
        (max(window.start, planning_start_minute), min(window.end, deadline_minute))
        for window in windows
        if max(window.start, planning_start_minute) < min(window.end, deadline_minute)
    )
    if not clipped:
        return ()

    merged: list[tuple[int, int]] = []
    for start, end in clipped:
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return tuple(merged)


def _calendar_capacity(
    windows: tuple[MinuteWindow, ...], planning_start_minute: int, deadline_minute: int
) -> int:
    return sum(
        end - start
        for start, end in _merged_windows(windows, planning_start_minute, deadline_minute)
    )


def _break_credit(
    end_minute: int,
    minimum_break_minutes: int,
    availability_windows: tuple[tuple[int, int], ...],
) -> int:
    break_end = end_minute + minimum_break_minutes
    available_minutes = sum(
        max(0, min(break_end, end) - max(end_minute, start)) for start, end in availability_windows
    )
    return minimum_break_minutes - available_minutes


def _minimum_break_capacity(
    sessions: list[SessionDemand],
    problem: FeasibilityProblem,
    solve_deadline: float,
) -> int:
    """Minimize break minutes that consume actual calendar availability."""

    minimum_break = problem.minimum_break_minutes
    if minimum_break == 0 or len(sessions) <= 1:
        return 0

    maximum_break_capacity = (len(sessions) - 1) * minimum_break
    candidates_by_session = {
        session.session_id: candidate_start_intervals(
            session,
            problem.planning_start_minute,
        )
        for session in sessions
    }
    if any(not candidates for candidates in candidates_by_session.values()):
        return maximum_break_capacity

    reference = sessions[0]
    scheduling_windows = _merged_windows(
        reference.allowed_windows,
        problem.planning_start_minute,
        reference.deadline_minute,
    )
    availability_windows = _merged_windows(
        reference.allowed_windows,
        problem.planning_start_minute,
        reference.deadline_minute + minimum_break,
    )

    model = cp_model.CpModel()
    starts: list[cp_model.IntVar] = []
    intervals: list[cp_model.IntervalVar] = []
    final_session: list[cp_model.IntVar] = []
    credit_terms: list[tuple[cp_model.IntVar, int]] = []

    for session in sessions:
        candidate_intervals = candidates_by_session[session.session_id]
        start = model.new_int_var_from_domain(
            cp_model.Domain.from_intervals(candidate_intervals),
            f"slack_start_{session.session_id}",
        )
        interval = model.new_fixed_size_interval_var(
            start,
            session.duration_minutes + minimum_break,
            f"slack_session_with_break_{session.session_id}",
        )
        is_final = model.new_bool_var(f"slack_final_{session.session_id}")
        starts.append(start)
        intervals.append(interval)
        final_session.append(is_final)

        credited_endings: list[cp_model.IntVar] = []
        for _, window_end in scheduling_windows:
            first_relevant_end = max(
                window_end - minimum_break + 1,
                problem.planning_start_minute + session.duration_minutes,
            )
            for end_minute in range(first_relevant_end, window_end + 1):
                start_minute = end_minute - session.duration_minutes
                if not any(first <= start_minute <= last for first, last in candidate_intervals):
                    continue
                credit = _break_credit(
                    end_minute,
                    minimum_break,
                    availability_windows,
                )
                if credit <= 0:
                    continue

                ends_here = model.new_bool_var(f"slack_end_{session.session_id}_{end_minute}")
                earns_credit = model.new_bool_var(f"slack_credit_{session.session_id}_{end_minute}")
                model.add(start == start_minute).only_enforce_if(ends_here)
                model.add(earns_credit <= ends_here)
                model.add(earns_credit + is_final <= 1)
                model.add(earns_credit >= ends_here - is_final)
                credited_endings.append(ends_here)
                credit_terms.append((earns_credit, credit))

        if credited_endings:
            model.add(sum(credited_endings) <= 1)

    model.add_no_overlap(intervals)
    model.add_exactly_one(final_session)
    for index, is_final in enumerate(final_session):
        for other_index, other_start in enumerate(starts):
            if other_index != index:
                model.add(starts[index] >= other_start).only_enforce_if(is_final)

    model.maximize(sum(variable * credit for variable, credit in credit_terms))
    validation_error = model.validate()
    if validation_error:
        raise _PolicyPreparationError("MODEL_INVALID", validation_error)

    remaining_seconds = solve_deadline - monotonic()
    if remaining_seconds <= 0:
        raise _PolicyPreparationError(
            "TIME_LIMIT",
            "Break-adjusted slack exhausted the shared solve budget",
        )
    solver = configured_solver(remaining_seconds)
    try:
        solver_status = solver.solve(model)
    except (RuntimeError, ValueError) as error:
        raise _PolicyPreparationError("EXCEPTION", str(error)) from error

    if solver_status == cp_model.INFEASIBLE:
        return maximum_break_capacity
    if solver_status != cp_model.OPTIMAL:
        raise _PolicyPreparationError(
            solver.status_name(solver_status),
            "Break-adjusted slack was not proven before the shared solve budget expired",
        )

    earned_credit = sum(
        credit for variable, credit in credit_terms if solver.boolean_value(variable)
    )
    return maximum_break_capacity - earned_credit


def _task_demands(problem: FeasibilityProblem, solve_deadline: float) -> tuple[_TaskDemand, ...]:
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
                _minimum_break_capacity(sessions, problem, solve_deadline),
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
            raw_calendar_capacity_minutes=task.calendar_capacity_minutes,
            available_minutes_before_deadline=scheduled_by_task[task.task_id],
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

    solve_deadline = monotonic() + float(problem.max_solve_seconds)
    try:
        tasks = _task_demands(problem, solve_deadline)
    except _PolicyPreparationError as error:
        return OverloadResult(
            KernelStatus.TECHNICAL_FAILURE,
            (),
            (),
            empty_diagnostics(error.solver_status),
            str(error),
        )
    ordered_tasks = _policy_order(tasks)

    model = cp_model.CpModel()
    variables: list[_OptionalSessionVariable] = []
    intervals: list[cp_model.IntervalVar] = []
    objective_terms_by_task: dict[str, list[cp_model.LinearExpr]] = defaultdict(list)

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
        objective_terms_by_task[demand.task_id].append(presence * demand.duration_minutes)

    model.add_no_overlap(intervals)
    validation_error = model.validate()
    if validation_error:
        return OverloadResult(
            KernelStatus.TECHNICAL_FAILURE,
            (),
            (),
            empty_diagnostics("MODEL_INVALID"),
            validation_error,
        )

    objectives = [
        (task, sum(objective_terms_by_task[task.task_id]))
        for task in ordered_tasks
        if objective_terms_by_task[task.task_id]
    ]
    if not objectives:
        objectives = [(ordered_tasks[0], 0)]

    solver: cp_model.CpSolver | None = None
    solver_status = cp_model.UNKNOWN
    present_variables: list[_OptionalSessionVariable] = []

    for task, objective in objectives:
        remaining_seconds = solve_deadline - monotonic()
        if remaining_seconds <= 0:
            return OverloadResult(
                KernelStatus.TECHNICAL_FAILURE,
                (),
                (),
                empty_diagnostics("TIME_LIMIT"),
                "The overload policy exhausted its shared solve budget",
            )

        model.maximize(objective)
        solver = configured_solver(remaining_seconds)
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
        if all_sessions_scheduled:
            break
        if solver_status != cp_model.OPTIMAL:
            diagnostics = solver_diagnostics(solver, solver_status)
            return OverloadResult(
                KernelStatus.TECHNICAL_FAILURE,
                (),
                (),
                diagnostics,
                "The solver stopped without a proven overload allocation",
            )

        optimum_minutes = sum(
            variable.demand.duration_minutes
            for variable in present_variables
            if variable.demand.task_id == task.task_id
        )
        model.add(objective == optimum_minutes)

    final_solver = cast(cp_model.CpSolver, solver)
    diagnostics = solver_diagnostics(final_solver, solver_status)
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
                    final_solver.value(variable.start),
                    final_solver.value(variable.start) + variable.demand.duration_minutes,
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
