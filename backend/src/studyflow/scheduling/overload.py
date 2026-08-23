"""Overload-aware scheduling policy on top of the exact-minute CP-SAT model."""

from bisect import bisect_right
from collections import defaultdict
from dataclasses import dataclass
from itertools import pairwise
from time import monotonic
from typing import cast

from ortools.graph.python import min_cost_flow  # type: ignore[import-untyped]
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
    PlanningDay,
    ScheduledSession,
    SessionDemand,
    SolverDiagnostics,
    TaskAllocation,
    TaskPriority,
)

_PRIORITY_WEIGHT = {
    TaskPriority.LOW: 0,
    TaskPriority.MEDIUM: 1,
    TaskPriority.HIGH: 2,
}
_SAFE_OBJECTIVE_MAX = cp_model.INT_MAX // 2
_FEASIBILITY_PROBE_SECONDS = 0.1
_MAX_UNIFORM_SLOTS = 1_000


@dataclass(frozen=True, slots=True)
class _TaskInput:
    task_id: str
    deadline_minute: int
    priority: TaskPriority
    allowed_windows: tuple[MinuteWindow, ...]
    sessions: tuple[SessionDemand, ...]
    required_minutes: int
    calendar_capacity_minutes: int


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


@dataclass(frozen=True, slots=True)
class _AllocationObjective:
    task: _TaskDemand
    expression: cp_model.LinearExpr
    maximum_minutes: int


@dataclass(frozen=True, slots=True)
class _DayStartOption:
    day_index: int
    first_start: int
    last_start: int


@dataclass(frozen=True, slots=True)
class _WitnessPlacement:
    demand: SessionDemand
    candidate_intervals: tuple[tuple[int, int], ...]
    witness_start: int
    envelope_start: int
    envelope_end: int


@dataclass(frozen=True, slots=True)
class _UniformAllocation:
    scheduled_counts: dict[str, int]
    starts: dict[str, int]
    slots: tuple[int, ...]
    eligible_slots_by_task: dict[str, int]


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


def _merged_start_intervals(intervals: list[list[int]]) -> tuple[tuple[int, int], ...]:
    merged: list[tuple[int, int]] = []
    for first, last in sorted((interval[0], interval[1]) for interval in intervals):
        if merged and first <= merged[-1][1] + 1:
            merged[-1] = (merged[-1][0], max(merged[-1][1], last))
        else:
            merged.append((first, last))
    return tuple(merged)


def _day_start_options(
    candidate_intervals: list[list[int]], planning_days: tuple[PlanningDay, ...]
) -> tuple[_DayStartOption, ...] | None:
    merged_candidates = _merged_start_intervals(candidate_intervals)
    chronological_days = sorted(planning_days, key=lambda item: item.start_minute)
    covered_segments: list[list[int]] = []
    bounds_by_day: dict[int, list[int]] = {}
    candidate_index = 0
    day_index = 0

    while candidate_index < len(merged_candidates) and day_index < len(chronological_days):
        candidate_first, candidate_last = merged_candidates[candidate_index]
        day = chronological_days[day_index]
        day_last_start = day.end_minute - 1
        first = max(candidate_first, day.start_minute)
        last = min(candidate_last, day_last_start)
        if first <= last:
            covered_segments.append([first, last])
            bounds = bounds_by_day.setdefault(day.day_index, [first, last])
            bounds[0] = min(bounds[0], first)
            bounds[1] = max(bounds[1], last)

        if candidate_last <= day_last_start:
            candidate_index += 1
        else:
            day_index += 1

    if _merged_start_intervals(covered_segments) != merged_candidates:
        return None
    return tuple(
        _DayStartOption(day_index, bounds[0], bounds[1])
        for day_index, bounds in sorted(bounds_by_day.items())
    )


def _break_credit(
    end_minute: int,
    minimum_break_minutes: int,
    availability_windows: tuple[tuple[int, int], ...],
    availability_ends: tuple[int, ...],
) -> int:
    break_end = end_minute + minimum_break_minutes
    available_minutes = 0
    window_index = bisect_right(availability_ends, end_minute)
    while (
        window_index < len(availability_windows)
        and availability_windows[window_index][0] < break_end
    ):
        start, end = availability_windows[window_index]
        available_minutes += max(0, min(break_end, end) - max(end_minute, start))
        window_index += 1
    return minimum_break_minutes - available_minutes


def _candidate_contains(
    candidate_intervals: list[list[int]],
    candidate_firsts: tuple[int, ...],
    start_minute: int,
) -> bool:
    interval_index = bisect_right(candidate_firsts, start_minute) - 1
    return interval_index >= 0 and start_minute <= candidate_intervals[interval_index][1]


def _credit_options(
    duration_minutes: int,
    candidate_intervals: list[list[int]],
    scheduling_windows: tuple[tuple[int, int], ...],
    availability_windows: tuple[tuple[int, int], ...],
    minimum_break_minutes: int,
) -> tuple[tuple[int, int], ...]:
    availability_ends = tuple(end for _, end in availability_windows)
    candidate_firsts = tuple(first for first, _ in candidate_intervals)
    options: list[tuple[int, int]] = []
    for _, window_end in scheduling_windows:
        for end_minute in range(window_end - minimum_break_minutes + 1, window_end + 1):
            start_minute = end_minute - duration_minutes
            if not _candidate_contains(candidate_intervals, candidate_firsts, start_minute):
                continue
            credit = _break_credit(
                end_minute,
                minimum_break_minutes,
                availability_windows,
                availability_ends,
            )
            if credit > 0:
                options.append((start_minute, credit))
    return tuple(options)


def _can_match_credit_windows(
    durations: list[int],
    window_indices: list[int],
    scheduling_windows: tuple[tuple[int, int], ...],
    candidates_by_duration: dict[int, list[list[int]]],
) -> bool:
    matched_session_by_window: dict[int, int] = {}

    def assign(session_index: int, visited_windows: set[int]) -> bool:
        duration = durations[session_index]
        for window_index in window_indices:
            if window_index in visited_windows:
                continue
            window_end = scheduling_windows[window_index][1]
            if not _candidate_contains(
                candidates_by_duration[duration],
                tuple(first for first, _ in candidates_by_duration[duration]),
                window_end - duration,
            ):
                continue
            visited_windows.add(window_index)
            previous_session = matched_session_by_window.get(window_index)
            if previous_session is None or assign(previous_session, visited_windows):
                matched_session_by_window[window_index] = session_index
                return True
        return False

    return all(assign(session_index, set()) for session_index in range(len(durations)))


def _has_zero_break_capacity(
    task: _TaskInput,
    scheduling_windows: tuple[tuple[int, int], ...],
    minimum_break_minutes: int,
) -> bool:
    """Prove that every inter-session break can sit outside availability."""

    durations = [session.duration_minutes for session in task.sessions]
    if len(durations) <= 1:
        return True
    if len(scheduling_windows) < len(durations):
        return False

    candidates_by_duration = {
        session.duration_minutes: candidate_start_intervals(session, scheduling_windows[0][0])
        for session in task.sessions
    }
    credit_window_indices = [
        window_index
        for window_index, ((_, end), (next_start, _)) in enumerate(pairwise(scheduling_windows))
        if next_start - end >= minimum_break_minutes
    ]
    if len(credit_window_indices) < len(durations) - 1:
        return False

    for final_index, (final_start, final_end) in enumerate(scheduling_windows):
        eligible_credit_windows = [
            window_index for window_index in credit_window_indices if window_index < final_index
        ]
        if len(eligible_credit_windows) < len(durations) - 1:
            continue
        for final_duration in set(durations):
            final_candidates = candidates_by_duration[final_duration]
            if not any(
                max(first, final_start) <= min(last, final_end - 1)
                for first, last in final_candidates
            ):
                continue
            remaining_durations = durations.copy()
            remaining_durations.remove(final_duration)
            if _can_match_credit_windows(
                remaining_durations,
                eligible_credit_windows,
                scheduling_windows,
                candidates_by_duration,
            ):
                return True
    return False


def _minimum_break_capacities(
    tasks: tuple[_TaskInput, ...],
    problem: FeasibilityProblem,
    solve_deadline: float,
) -> dict[str, int]:
    """Prove every task's break-adjusted capacity in one independent-component solve."""

    minimum_break = problem.minimum_break_minutes
    capacities = {task.task_id: max(0, len(task.sessions) - 1) * minimum_break for task in tasks}
    if minimum_break == 0:
        return capacities

    model = cp_model.CpModel()
    active_by_task: dict[str, cp_model.IntVar] = {}
    credit_terms_by_task: dict[str, list[tuple[cp_model.IntVar, int]]] = defaultdict(list)
    objective_terms: list[cp_model.LinearExpr] = []

    for task in tasks:
        maximum_break_capacity = capacities[task.task_id]
        if maximum_break_capacity == 0:
            continue

        scheduling_windows = _merged_windows(
            task.allowed_windows,
            problem.planning_start_minute,
            task.deadline_minute,
        )
        if _has_zero_break_capacity(task, scheduling_windows, minimum_break):
            capacities[task.task_id] = 0
            continue
        if len(scheduling_windows) <= 1:
            continue

        candidates_by_duration = {
            session.duration_minutes: candidate_start_intervals(
                session,
                problem.planning_start_minute,
            )
            for session in task.sessions
        }
        if any(not candidates for candidates in candidates_by_duration.values()):
            continue

        availability_windows = _merged_windows(
            task.allowed_windows,
            problem.planning_start_minute,
            task.deadline_minute + minimum_break,
        )
        credit_options_by_duration = {
            duration: _credit_options(
                duration,
                candidates,
                scheduling_windows,
                availability_windows,
                minimum_break,
            )
            for duration, candidates in candidates_by_duration.items()
        }

        active = model.new_bool_var(f"slack_active_{task.task_id}")
        active_by_task[task.task_id] = active
        starts: list[cp_model.IntVar] = []
        intervals: list[cp_model.IntervalVar] = []
        final_session: list[cp_model.IntVar] = []

        for session in task.sessions:
            candidate_intervals = candidates_by_duration[session.duration_minutes]
            start = model.new_int_var_from_domain(
                cp_model.Domain.from_intervals(candidate_intervals),
                f"slack_start_{session.session_id}",
            )
            interval = model.new_optional_fixed_size_interval_var(
                start,
                session.duration_minutes + minimum_break,
                active,
                f"slack_session_with_break_{session.session_id}",
            )
            is_final = model.new_bool_var(f"slack_final_{session.session_id}")
            starts.append(start)
            intervals.append(interval)
            final_session.append(is_final)

            credited_endings: list[cp_model.IntVar] = []
            for start_minute, credit in credit_options_by_duration[session.duration_minutes]:
                ends_here = model.new_bool_var(f"slack_end_{session.session_id}_{start_minute}")
                earns_credit = model.new_bool_var(
                    f"slack_credit_{session.session_id}_{start_minute}"
                )
                model.add(ends_here <= active)
                model.add(start == start_minute).only_enforce_if(ends_here)
                model.add(earns_credit <= ends_here)
                model.add(earns_credit + is_final <= 1)
                model.add(earns_credit >= ends_here - is_final)
                credited_endings.append(ends_here)
                credit_terms_by_task[task.task_id].append((earns_credit, credit))

            if credited_endings:
                model.add(sum(credited_endings) <= 1)

        model.add_no_overlap(intervals)
        model.add(sum(final_session) == active)
        for index, is_final in enumerate(final_session):
            for other_index, other_start in enumerate(starts):
                if other_index != index:
                    model.add(starts[index] >= other_start).only_enforce_if(is_final)

        task_credit = sum(
            variable * credit for variable, credit in credit_terms_by_task[task.task_id]
        )
        objective_terms.append(active * (maximum_break_capacity + 1) + task_credit)

    if not active_by_task:
        return capacities

    model.maximize(cp_model.LinearExpr.sum(objective_terms))
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

    if solver_status != cp_model.OPTIMAL:
        raise _PolicyPreparationError(
            solver.status_name(solver_status),
            "Break-adjusted slack was not proven before the shared solve budget expired",
        )

    for task_id, active in active_by_task.items():
        if not solver.boolean_value(active):
            continue
        earned_credit = sum(
            credit
            for variable, credit in credit_terms_by_task[task_id]
            if solver.boolean_value(variable)
        )
        capacities[task_id] -= earned_credit
    return capacities


def _task_demands(problem: FeasibilityProblem, solve_deadline: float) -> tuple[_TaskDemand, ...]:
    sessions_by_task: dict[str, list[SessionDemand]] = defaultdict(list)
    for session in problem.sessions:
        sessions_by_task[session.task_id].append(session)

    inputs: list[_TaskInput] = []
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
        inputs.append(
            _TaskInput(
                task_id,
                reference.deadline_minute,
                reference.priority,
                reference.allowed_windows,
                tuple(sessions),
                required_minutes,
                _calendar_capacity(
                    reference.allowed_windows,
                    problem.planning_start_minute,
                    reference.deadline_minute,
                ),
            )
        )
    task_inputs = tuple(inputs)
    break_capacities = _minimum_break_capacities(task_inputs, problem, solve_deadline)
    return tuple(
        _TaskDemand(
            task.task_id,
            task.deadline_minute,
            task.priority,
            task.allowed_windows,
            task.required_minutes,
            break_capacities[task.task_id],
            task.calendar_capacity_minutes,
        )
        for task in task_inputs
    )


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


def _lexicographic_weights(maximums: tuple[int, ...], tail_maximum: int) -> tuple[int, ...] | None:
    lower_score_maximum = tail_maximum
    reverse_weights: list[int] = []
    for maximum in reversed(maximums):
        weight = lower_score_maximum + 1
        contribution = maximum * weight
        if contribution > _SAFE_OBJECTIVE_MAX - lower_score_maximum:
            return None
        lower_score_maximum += contribution
        reverse_weights.append(weight)
    return tuple(reversed(reverse_weights))


def _next_allocation_batch(
    objectives: list[_AllocationObjective], start_index: int
) -> tuple[int, cp_model.LinearExpr]:
    best: tuple[int, tuple[int, ...]] | None = None
    for end_index in range(start_index + 1, len(objectives) + 1):
        weights = _lexicographic_weights(
            tuple(objective.maximum_minutes for objective in objectives[start_index:end_index]),
            0,
        )
        if weights is not None:
            best = (end_index, weights)

    if best is None:
        return start_index + 1, objectives[start_index].expression

    end_index, weights = best
    terms = [
        objective.expression * weight
        for objective, weight in zip(
            objectives[start_index:end_index],
            weights,
            strict=True,
        )
    ]
    return end_index, cp_model.LinearExpr.sum(terms)


def _replace_solution_hints(
    model: cp_model.CpModel,
    solver: cp_model.CpSolver,
    variables: list[cp_model.IntVar],
) -> None:
    model.clear_hints()  # type: ignore[no-untyped-call]
    seen_indices: set[int] = set()
    for variable in variables:
        if variable.index in seen_indices:
            continue
        seen_indices.add(variable.index)
        model.add_hint(variable, solver.value(variable))


def _earliest_nonoverlap_start(
    candidate_intervals: list[list[int]],
    interval_size: int,
    occupied: list[tuple[int, int]],
) -> int | None:
    for first, last in candidate_intervals:
        candidate = first
        for occupied_start, occupied_end in occupied:
            if occupied_end <= candidate:
                continue
            if candidate + interval_size <= occupied_start:
                break
            candidate = occupied_end
            if candidate > last:
                break
        if candidate <= last:
            return candidate
    return None


def _greedy_policy_hint(
    ordered_tasks: tuple[_TaskDemand, ...],
    variables: list[_OptionalSessionVariable],
    candidates_by_session: dict[str, list[list[int]]],
    day_options_by_session: dict[str, tuple[_DayStartOption, ...]],
    minimum_break_minutes: int,
    *,
    spread_across_days: bool,
) -> dict[str, int]:
    variables_by_task: dict[str, list[_OptionalSessionVariable]] = defaultdict(list)
    for variable in variables:
        if variable.start is not None:
            variables_by_task[variable.demand.task_id].append(variable)

    occupied: list[tuple[int, int]] = []
    starts: dict[str, int] = {}
    for task in ordered_tasks:
        used_days: set[int] = set()
        task_variables = sorted(
            variables_by_task[task.task_id],
            key=lambda variable: (-variable.demand.duration_minutes, variable.demand.session_id),
        )
        for variable in task_variables:
            interval_size = variable.demand.duration_minutes + minimum_break_minutes
            start: int | None = None
            chosen_day: int | None = None
            if spread_across_days:
                for option in sorted(
                    day_options_by_session[variable.demand.session_id],
                    key=lambda item: item.first_start,
                ):
                    if option.day_index in used_days:
                        continue
                    restricted_candidates = [
                        [max(first, option.first_start), min(last, option.last_start)]
                        for first, last in candidates_by_session[variable.demand.session_id]
                        if max(first, option.first_start) <= min(last, option.last_start)
                    ]
                    start = _earliest_nonoverlap_start(
                        restricted_candidates,
                        interval_size,
                        occupied,
                    )
                    if start is not None:
                        chosen_day = option.day_index
                        break
            if start is None:
                start = _earliest_nonoverlap_start(
                    candidates_by_session[variable.demand.session_id],
                    interval_size,
                    occupied,
                )
            if start is None:
                continue
            if chosen_day is None:
                chosen_day = next(
                    option.day_index
                    for option in day_options_by_session[variable.demand.session_id]
                    if option.first_start <= start <= option.last_start
                )
            used_days.add(chosen_day)
            starts[variable.demand.session_id] = start
            occupied.append((start, start + interval_size))
            occupied.sort()
    return starts


def _uniform_allocation(
    problem: FeasibilityProblem,
    ordered_tasks: tuple[_TaskDemand, ...],
) -> _UniformAllocation | None:
    """Solve equal-session, shared-calendar overload as unit jobs with prefix deadlines."""

    reference = problem.sessions[0]
    if any(
        session.duration_minutes != reference.duration_minutes
        or session.allowed_windows != reference.allowed_windows
        for session in problem.sessions[1:]
    ):
        return None

    latest_session = max(problem.sessions, key=lambda session: session.deadline_minute)
    universal_candidates = candidate_start_intervals(
        latest_session,
        problem.planning_start_minute,
    )
    interval_size = reference.duration_minutes + problem.minimum_break_minutes
    slots: list[int] = []
    next_free = problem.planning_start_minute
    for first, last in universal_candidates:
        next_free = max(next_free, first)
        while next_free <= last:
            slots.append(next_free)
            if len(slots) > _MAX_UNIFORM_SLOTS:
                return None
            next_free += interval_size

    sessions_by_task: dict[str, list[SessionDemand]] = defaultdict(list)
    for session in problem.sessions:
        sessions_by_task[session.task_id].append(session)

    eligible_slots_by_task: dict[str, int] = {}
    for task in ordered_tasks:
        task_sessions = sessions_by_task[task.task_id]
        candidates = candidate_start_intervals(
            task_sessions[0],
            problem.planning_start_minute,
        )
        candidate_firsts = tuple(first for first, _ in candidates)
        eligibility = [_candidate_contains(candidates, candidate_firsts, slot) for slot in slots]
        eligible_count = 0
        for is_eligible in eligibility:
            if not is_eligible:
                break
            eligible_count += 1
        if any(eligibility[eligible_count:]):
            return None
        eligible_slots_by_task[task.task_id] = eligible_count

    selected_deadlines: list[int] = []
    scheduled_counts: dict[str, int] = {}
    for task in ordered_tasks:
        scheduled_count = 0
        eligible_count = eligible_slots_by_task[task.task_id]
        for _ in sessions_by_task[task.task_id]:
            trial_deadlines = sorted([*selected_deadlines, eligible_count])
            if not all(
                slot_number <= deadline_slots
                for slot_number, deadline_slots in enumerate(trial_deadlines, start=1)
            ):
                break
            selected_deadlines.append(eligible_count)
            scheduled_count += 1
        scheduled_counts[task.task_id] = scheduled_count

    selected_jobs: list[tuple[int, int, SessionDemand]] = []
    task_order = {task.task_id: index for index, task in enumerate(ordered_tasks)}
    for task in ordered_tasks:
        selected_jobs.extend(
            (
                eligible_slots_by_task[task.task_id],
                task_order[task.task_id],
                session,
            )
            for session in sorted(
                sessions_by_task[task.task_id],
                key=lambda item: item.session_id,
            )[: scheduled_counts[task.task_id]]
        )

    starts: dict[str, int] = {}
    for slot_index, (eligible_count, _, session) in enumerate(
        sorted(selected_jobs, key=lambda item: (item[0], item[1], item[2].session_id))
    ):
        if slot_index >= eligible_count:
            return None
        starts[session.session_id] = slots[slot_index]
    return _UniformAllocation(
        scheduled_counts,
        starts,
        tuple(slots),
        eligible_slots_by_task,
    )


def _set_greedy_hints(
    model: cp_model.CpModel,
    variables: list[_OptionalSessionVariable],
    candidates_by_session: dict[str, list[list[int]]],
    greedy_starts: dict[str, int],
) -> None:
    model.clear_hints()  # type: ignore[no-untyped-call]
    for variable in variables:
        if variable.start is None or variable.presence is None:
            continue
        scheduled_start = greedy_starts.get(variable.demand.session_id)
        model.add_hint(variable.presence, int(scheduled_start is not None))
        model.add_hint(
            variable.start,
            scheduled_start
            if scheduled_start is not None
            else candidates_by_session[variable.demand.session_id][0][0],
        )


def _add_window_capacity_cuts(
    model: cp_model.CpModel,
    variables: list[_OptionalSessionVariable],
    candidates_by_session: dict[str, list[list[int]]],
    greedy_starts: dict[str, int],
    minimum_break_minutes: int,
    hint_variables: list[cp_model.IntVar],
) -> None:
    choices_by_window: dict[tuple[int, int], list[tuple[cp_model.IntVar, int]]] = defaultdict(list)
    for variable in variables:
        if variable.start is None or variable.presence is None:
            continue
        choices: list[cp_model.IntVar] = []
        hinted_start = greedy_starts.get(variable.demand.session_id)
        interval_size = variable.demand.duration_minutes + minimum_break_minutes
        for window_index, (first, last) in enumerate(
            candidates_by_session[variable.demand.session_id]
        ):
            choice = model.new_bool_var(
                f"allocation_window_{variable.demand.session_id}_{window_index}"
            )
            model.add(variable.start >= first).only_enforce_if(choice)
            model.add(variable.start <= last).only_enforce_if(choice)
            model.add_hint(choice, int(hinted_start is not None and first <= hinted_start <= last))
            choices.append(choice)
            hint_variables.append(choice)
            choices_by_window[(first, last + variable.demand.duration_minutes)].append(
                (choice, interval_size)
            )
        model.add(sum(choices) == variable.presence)

    for (window_start, window_end), window_choices in choices_by_window.items():
        model.add(
            sum(choice * interval_size for choice, interval_size in window_choices)
            <= window_end - window_start + minimum_break_minutes
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


def _witness_uses_maximum_days(
    present_session_ids: set[str],
    witness_starts: dict[str, int],
    day_options_by_session: dict[str, tuple[_DayStartOption, ...]],
    sessions: tuple[SessionDemand, ...],
) -> bool:
    candidate_days_by_task: dict[str, set[int]] = defaultdict(set)
    witness_days_by_task: dict[str, set[int]] = defaultdict(set)
    allocated_sessions_by_task: dict[str, int] = defaultdict(int)

    for session in sessions:
        if session.session_id not in present_session_ids:
            continue
        allocated_sessions_by_task[session.task_id] += 1
        options = day_options_by_session[session.session_id]
        candidate_days_by_task[session.task_id].update(option.day_index for option in options)
        start = witness_starts[session.session_id]
        witness_day = next(
            option.day_index
            for option in options
            if option.first_start <= start <= option.last_start
        )
        witness_days_by_task[session.task_id].add(witness_day)

    return all(
        len(witness_days_by_task[task_id])
        == min(session_count, len(candidate_days_by_task[task_id]))
        for task_id, session_count in allocated_sessions_by_task.items()
    )


def _uniform_witness_is_policy_optimal(
    problem: FeasibilityProblem,
    allocation: _UniformAllocation,
    witness_starts: dict[str, int],
    day_options_by_session: dict[str, tuple[_DayStartOption, ...]],
) -> bool:
    """Prove a uniform-session witness reaches every policy objective's upper bound."""

    witness_counts = dict.fromkeys(allocation.scheduled_counts, 0)
    for session in problem.sessions:
        if session.session_id in witness_starts:
            witness_counts[session.task_id] += 1
    if witness_counts != allocation.scheduled_counts:
        return False

    scheduled_count = len(witness_starts)
    if tuple(sorted(witness_starts.values())) != allocation.slots[:scheduled_count]:
        return False

    present_session_ids = set(witness_starts)
    return _witness_uses_maximum_days(
        present_session_ids,
        witness_starts,
        day_options_by_session,
        problem.sessions,
    )


def _uniform_flow_policy_witness(
    problem: FeasibilityProblem,
    allocation: _UniformAllocation,
) -> dict[str, int] | None:
    """Optimize uniform spread and earliness as an exact min-cost flow."""

    scheduled_count = sum(allocation.scheduled_counts.values())
    slots = allocation.slots
    if len(slots) < scheduled_count:
        return None

    chronological_days = sorted(problem.planning_days, key=lambda day: day.start_minute)
    day_by_slot = {
        slot_index: next(
            day.day_index for day in chronological_days if day.start_minute <= slot < day.end_minute
        )
        for slot_index, slot in enumerate(slots)
    }

    eligible_slots_by_task_day: dict[tuple[str, int], list[int]] = defaultdict(list)
    eligible_days_by_task: dict[str, set[int]] = defaultdict(set)
    for task_id, eligible_slot_count in allocation.eligible_slots_by_task.items():
        for slot_index in range(min(eligible_slot_count, len(slots))):
            day_index = day_by_slot[slot_index]
            eligible_slots_by_task_day[(task_id, day_index)].append(slot_index)
            eligible_days_by_task[task_id].add(day_index)

    maximum_candidate_days = max(
        (
            min(len(eligible_days_by_task[task_id]), task_scheduled_count)
            for task_id, task_scheduled_count in allocation.scheduled_counts.items()
            if task_scheduled_count
        ),
        default=1,
    )
    eligible_tasks_by_day_count = {
        day_count: sum(
            len(eligible_days_by_task[task_id]) >= day_count and task_scheduled_count >= day_count
            for task_id, task_scheduled_count in allocation.scheduled_counts.items()
        )
        for day_count in range(2, maximum_candidate_days + 1)
    }
    extra_day_weights = {
        day_count: maximum_candidate_days - day_count + 1
        for day_count in range(3, maximum_candidate_days + 1)
    }
    maximum_extra_score = sum(
        eligible_tasks_by_day_count[day_count] * weight
        for day_count, weight in extra_day_weights.items()
    )
    second_day_weight = maximum_extra_score + 1
    maximum_spread_score = sum(
        eligible_tasks_by_day_count[day_count]
        * (second_day_weight if day_count == 2 else extra_day_weights[day_count])
        for day_count in range(2, maximum_candidate_days + 1)
    )
    maximum_slot_cost = scheduled_count * max(0, len(slots) - 1)
    policy_weight = maximum_slot_cost + 1
    # The first used day is mandatory but unscored. A dominating constant makes
    # the parallel marginal-cost arcs select day rewards in policy order.
    first_day_weight = maximum_spread_score + 1
    maximum_policy_score = (
        sum(count > 0 for count in allocation.scheduled_counts.values()) * first_day_weight
        + maximum_spread_score
    )
    if maximum_policy_score * policy_weight + maximum_slot_cost > _SAFE_OBJECTIVE_MAX:
        return None

    sink = 0
    next_node = 1

    def new_node() -> int:
        nonlocal next_node
        node = next_node
        next_node += 1
        return node

    flow = min_cost_flow.SimpleMinCostFlow()
    slot_nodes = {slot_index: new_node() for slot_index in range(len(slots))}
    for slot_node in slot_nodes.values():
        flow.add_arc_with_capacity_and_unit_cost(slot_node, sink, 1, 0)

    assignment_by_arc: dict[int, tuple[str, int]] = {}
    for task_id, task_scheduled_count in sorted(allocation.scheduled_counts.items()):
        if task_scheduled_count == 0:
            continue
        task_node = new_node()
        distinct_node = new_node()
        repeat_node = new_node()
        flow.set_node_supply(task_node, task_scheduled_count)

        maximum_task_days = min(
            task_scheduled_count,
            len(eligible_days_by_task[task_id]),
        )
        for day_count in range(1, maximum_task_days + 1):
            if day_count == 1:
                day_weight = first_day_weight
            elif day_count == 2:
                day_weight = second_day_weight
            else:
                day_weight = extra_day_weights[day_count]
            flow.add_arc_with_capacity_and_unit_cost(
                task_node,
                distinct_node,
                1,
                -day_weight * policy_weight,
            )
        flow.add_arc_with_capacity_and_unit_cost(
            task_node,
            repeat_node,
            task_scheduled_count,
            0,
        )

        for day_index in sorted(eligible_days_by_task[task_id]):
            task_day_node = new_node()
            # One distinct unit earns this day; repeat units may share it.
            flow.add_arc_with_capacity_and_unit_cost(
                distinct_node,
                task_day_node,
                1,
                0,
            )
            flow.add_arc_with_capacity_and_unit_cost(
                repeat_node,
                task_day_node,
                task_scheduled_count,
                0,
            )
            for slot_index in eligible_slots_by_task_day[(task_id, day_index)]:
                arc = flow.add_arc_with_capacity_and_unit_cost(
                    task_day_node,
                    slot_nodes[slot_index],
                    1,
                    slot_index,
                )
                assignment_by_arc[arc] = (task_id, slot_index)

    flow.set_node_supply(sink, -scheduled_count)
    if flow.solve() != flow.OPTIMAL:
        return None

    starts_by_task: dict[str, list[int]] = defaultdict(list)
    for arc, (task_id, slot_index) in assignment_by_arc.items():
        if flow.flow(arc):
            starts_by_task[task_id].append(slots[slot_index])

    sessions_by_task: dict[str, list[SessionDemand]] = defaultdict(list)
    for session in problem.sessions:
        sessions_by_task[session.task_id].append(session)

    witness_starts: dict[str, int] = {}
    for task_id, starts in sorted(starts_by_task.items()):
        selected_sessions = sorted(
            sessions_by_task[task_id],
            key=lambda session: session.session_id,
        )[: allocation.scheduled_counts[task_id]]
        for session, start in zip(selected_sessions, sorted(starts), strict=True):
            witness_starts[session.session_id] = start
    return witness_starts


def _solve_witness_day_placement(
    problem: FeasibilityProblem,
    tasks: tuple[_TaskDemand, ...],
    status: KernelStatus,
    present_session_ids: set[str],
    candidates_by_session: dict[str, list[list[int]]],
    day_options_by_session: dict[str, tuple[_DayStartOption, ...]],
    witness_starts: dict[str, int],
    solve_deadline: float,
) -> OverloadResult:
    """Optimize exact minutes after a constructive maximum-spread day assignment."""

    placements: list[_WitnessPlacement] = []
    for demand in problem.sessions:
        if demand.session_id not in present_session_ids:
            continue
        witness_start = witness_starts[demand.session_id]
        day_option = next(
            option
            for option in day_options_by_session[demand.session_id]
            if option.first_start <= witness_start <= option.last_start
        )
        restricted_candidates = tuple(
            (max(first, day_option.first_start), min(last, day_option.last_start))
            for first, last in candidates_by_session[demand.session_id]
            if max(first, day_option.first_start) <= min(last, day_option.last_start)
        )
        placements.append(
            _WitnessPlacement(
                demand,
                restricted_candidates,
                witness_start,
                restricted_candidates[0][0],
                restricted_candidates[-1][1]
                + demand.duration_minutes
                + problem.minimum_break_minutes,
            )
        )

    components: list[list[_WitnessPlacement]] = []
    component_end = 0
    for placement in sorted(
        placements,
        key=lambda item: (item.envelope_start, item.envelope_end, item.demand.session_id),
    ):
        if not components or placement.envelope_start >= component_end:
            components.append([placement])
            component_end = placement.envelope_end
        else:
            components[-1].append(placement)
            component_end = max(component_end, placement.envelope_end)

    scheduled_items: list[ScheduledSession] = []
    total_wall_time = 0.0
    total_conflicts = 0
    total_branches = 0
    for component in components:
        if len(component) == 1:
            placement = component[0]
            start_minute = placement.candidate_intervals[0][0]
            scheduled_items.append(
                ScheduledSession(
                    placement.demand.session_id,
                    placement.demand.task_id,
                    start_minute,
                    start_minute + placement.demand.duration_minutes,
                )
            )
            continue

        model = cp_model.CpModel()
        placement_variables: list[tuple[_WitnessPlacement, cp_model.IntVar]] = []
        intervals: list[cp_model.IntervalVar] = []
        for placement in component:
            start = model.new_int_var_from_domain(
                cp_model.Domain.from_intervals(placement.candidate_intervals),
                f"placed_start_{placement.demand.session_id}",
            )
            intervals.append(
                model.new_fixed_size_interval_var(
                    start,
                    placement.demand.duration_minutes + problem.minimum_break_minutes,
                    f"placed_session_with_break_{placement.demand.session_id}",
                )
            )
            model.add_hint(start, placement.witness_start)
            placement_variables.append((placement, start))

        model.add_no_overlap(intervals)
        model.minimize(cp_model.LinearExpr.sum([start for _, start in placement_variables]))
        validation_error = model.validate()
        if validation_error:
            return OverloadResult(
                KernelStatus.TECHNICAL_FAILURE,
                (),
                (),
                empty_diagnostics("MODEL_INVALID"),
                validation_error,
            )

        remaining_seconds = solve_deadline - monotonic()
        if remaining_seconds <= 0:
            return OverloadResult(
                KernelStatus.TECHNICAL_FAILURE,
                (),
                (),
                empty_diagnostics("TIME_LIMIT"),
                "The placement policy exhausted its shared solve budget",
            )
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
        if solver_status != cp_model.OPTIMAL:
            return OverloadResult(
                KernelStatus.TECHNICAL_FAILURE,
                (),
                (),
                solver_diagnostics(solver, solver_status),
                "The earliness placement objective was not proven optimal",
            )

        total_wall_time += solver.wall_time
        total_conflicts += solver.num_conflicts
        total_branches += solver.num_branches
        scheduled_items.extend(
            ScheduledSession(
                placement.demand.session_id,
                placement.demand.task_id,
                solver.value(start),
                solver.value(start) + placement.demand.duration_minutes,
            )
            for placement, start in placement_variables
        )

    scheduled = tuple(
        sorted(scheduled_items, key=lambda session: (session.start_minute, session.session_id))
    )
    scheduled_ids = {session.session_id for session in scheduled}
    return OverloadResult(
        status,
        scheduled,
        _allocations(tasks, scheduled_ids, problem),
        SolverDiagnostics("OPTIMAL", total_wall_time, total_conflicts, total_branches),
        "Some work could not fit before its deadline" if status is KernelStatus.OVERLOAD else None,
    )


def _solve_uniform_spread_placement(
    problem: FeasibilityProblem,
    tasks: tuple[_TaskDemand, ...],
    allocation: _UniformAllocation,
    candidates_by_session: dict[str, list[list[int]]],
    day_options_by_session: dict[str, tuple[_DayStartOption, ...]],
    solve_deadline: float,
) -> OverloadResult:
    """Optimize day spread for an analytically proven uniform-session allocation."""

    status = (
        KernelStatus.FEASIBLE
        if sum(allocation.scheduled_counts.values()) == len(problem.sessions)
        else KernelStatus.OVERLOAD
    )
    day_by_slot: dict[int, int] = {}
    chronological_days = sorted(problem.planning_days, key=lambda day: day.start_minute)
    for slot_index, slot in enumerate(allocation.slots):
        day_by_slot[slot_index] = next(
            day.day_index for day in chronological_days if day.start_minute <= slot < day.end_minute
        )

    model = cp_model.CpModel()
    assignments_by_task: dict[str, list[tuple[int, cp_model.IntVar]]] = defaultdict(list)
    assignments_by_slot: dict[int, list[cp_model.IntVar]] = defaultdict(list)
    assignments_by_task_day: dict[tuple[str, int], list[cp_model.IntVar]] = defaultdict(list)
    policy_hint_variables: list[cp_model.IntVar] = []
    for task in tasks:
        scheduled_count = allocation.scheduled_counts[task.task_id]
        if scheduled_count == 0:
            continue
        for slot_index in range(allocation.eligible_slots_by_task[task.task_id]):
            assignment = model.new_bool_var(f"slot_{task.task_id}_{slot_index}")
            policy_hint_variables.append(assignment)
            assignments_by_task[task.task_id].append((slot_index, assignment))
            assignments_by_slot[slot_index].append(assignment)
            assignments_by_task_day[(task.task_id, day_by_slot[slot_index])].append(assignment)
        model.add(
            sum(variable for _, variable in assignments_by_task[task.task_id]) == scheduled_count
        )

    for assignments in assignments_by_slot.values():
        model.add(sum(assignments) <= 1)

    used_days_by_task: dict[str, list[cp_model.IntVar]] = defaultdict(list)
    for (task_id, day_index), assignments in sorted(assignments_by_task_day.items()):
        used_day = model.new_bool_var(f"slot_day_{task_id}_{day_index}")
        model.add_max_equality(used_day, assignments)
        used_days_by_task[task_id].append(used_day)
        policy_hint_variables.append(used_day)

    maximum_candidate_days = max(
        (
            min(len(used_days), allocation.scheduled_counts[task_id])
            for task_id, used_days in used_days_by_task.items()
        ),
        default=1,
    )
    spread_variables_by_day_count: dict[int, list[cp_model.IntVar]] = {}
    for day_count in range(2, maximum_candidate_days + 1):
        reaches_day_count: list[cp_model.IntVar] = []
        for task_id, used_days in sorted(used_days_by_task.items()):
            if len(used_days) < day_count or allocation.scheduled_counts[task_id] < day_count:
                continue
            reaches = model.new_bool_var(f"slot_task_{task_id}_uses_{day_count}_days")
            model.add(sum(used_days) >= day_count).only_enforce_if(reaches)
            model.add(sum(used_days) <= day_count - 1).only_enforce_if(reaches.negated())
            reaches_day_count.append(reaches)
            policy_hint_variables.append(reaches)
        if reaches_day_count:
            spread_variables_by_day_count[day_count] = reaches_day_count

    assignment_solver: cp_model.CpSolver | None = None
    policy_wall_time = 0.0
    policy_conflicts = 0
    policy_branches = 0
    if spread_variables_by_day_count:
        extra_day_weights = {
            day_count: maximum_candidate_days - day_count + 1
            for day_count in spread_variables_by_day_count
            if day_count >= 3
        }
        maximum_extra_score = sum(
            len(spread_variables_by_day_count[day_count]) * weight
            for day_count, weight in extra_day_weights.items()
        )
        second_day_weight = maximum_extra_score + 1
        spread_objective = cp_model.LinearExpr.sum(
            [
                variable * (second_day_weight if day_count == 2 else extra_day_weights[day_count])
                for day_count, reaches_variables in sorted(spread_variables_by_day_count.items())
                for variable in reaches_variables
            ]
        )
        slot_earliness_objective = cp_model.LinearExpr.sum(
            [
                assignment * slot_index
                for task_assignments in assignments_by_task.values()
                for slot_index, assignment in task_assignments
            ]
        )
        maximum_spread_score = sum(
            len(reaches_variables)
            * (second_day_weight if day_count == 2 else extra_day_weights[day_count])
            for day_count, reaches_variables in spread_variables_by_day_count.items()
        )
        maximum_slot_cost = sum(allocation.scheduled_counts.values()) * max(
            0, len(allocation.slots) - 1
        )
        policy_weight = maximum_slot_cost + 1
        combined_objective_is_safe = (
            maximum_spread_score * policy_weight + maximum_slot_cost <= _SAFE_OBJECTIVE_MAX
        )
        if combined_objective_is_safe:
            model.maximize(spread_objective * policy_weight - slot_earliness_objective)
        else:
            model.maximize(spread_objective)
        validation_error = model.validate()
        if validation_error:
            return OverloadResult(
                KernelStatus.TECHNICAL_FAILURE,
                (),
                (),
                empty_diagnostics("MODEL_INVALID"),
                validation_error,
            )
        remaining_seconds = solve_deadline - monotonic()
        if remaining_seconds <= 0:
            return OverloadResult(
                KernelStatus.TECHNICAL_FAILURE,
                (),
                (),
                empty_diagnostics("TIME_LIMIT"),
                "The placement policy exhausted its shared solve budget",
            )
        spread_solver = configured_solver(remaining_seconds)
        try:
            spread_status = spread_solver.solve(model)
        except (RuntimeError, ValueError) as error:
            return OverloadResult(
                KernelStatus.TECHNICAL_FAILURE,
                (),
                (),
                empty_diagnostics("EXCEPTION"),
                str(error),
            )
        if spread_status != cp_model.OPTIMAL:
            return OverloadResult(
                KernelStatus.TECHNICAL_FAILURE,
                (),
                (),
                solver_diagnostics(spread_solver, spread_status),
                "The spread placement objective was not proven optimal",
            )

        policy_wall_time += spread_solver.wall_time
        policy_conflicts += spread_solver.num_conflicts
        policy_branches += spread_solver.num_branches
        if combined_objective_is_safe:
            assignment_solver = spread_solver
        else:
            model.add(spread_objective == spread_solver.value(spread_objective))
            _replace_solution_hints(model, spread_solver, policy_hint_variables)
            model.minimize(slot_earliness_objective)
            validation_error = model.validate()
            if validation_error:
                return OverloadResult(
                    KernelStatus.TECHNICAL_FAILURE,
                    (),
                    (),
                    empty_diagnostics("MODEL_INVALID"),
                    validation_error,
                )
            remaining_seconds = solve_deadline - monotonic()
            if remaining_seconds <= 0:
                return OverloadResult(
                    KernelStatus.TECHNICAL_FAILURE,
                    (),
                    (),
                    empty_diagnostics("TIME_LIMIT"),
                    "The placement policy exhausted its shared solve budget",
                )
            assignment_solver = configured_solver(remaining_seconds)
            try:
                earliness_status = assignment_solver.solve(model)
            except (RuntimeError, ValueError) as error:
                return OverloadResult(
                    KernelStatus.TECHNICAL_FAILURE,
                    (),
                    (),
                    empty_diagnostics("EXCEPTION"),
                    str(error),
                )
            if earliness_status != cp_model.OPTIMAL:
                return OverloadResult(
                    KernelStatus.TECHNICAL_FAILURE,
                    (),
                    (),
                    solver_diagnostics(assignment_solver, earliness_status),
                    "The earliness placement objective was not proven optimal",
                )
            policy_wall_time += assignment_solver.wall_time
            policy_conflicts += assignment_solver.num_conflicts
            policy_branches += assignment_solver.num_branches

    starts_by_task: dict[str, list[int]] = defaultdict(list)
    if assignment_solver is None:
        for session in problem.sessions:
            start = allocation.starts.get(session.session_id)
            if start is not None:
                starts_by_task[session.task_id].append(start)
    else:
        for task_id, task_assignments in assignments_by_task.items():
            starts_by_task[task_id].extend(
                allocation.slots[slot_index]
                for slot_index, assignment in task_assignments
                if assignment_solver.boolean_value(assignment)
            )

    witness_starts: dict[str, int] = {}
    sessions_by_task: dict[str, list[SessionDemand]] = defaultdict(list)
    for session in problem.sessions:
        sessions_by_task[session.task_id].append(session)
    for task_id, starts in starts_by_task.items():
        selected_sessions = sorted(
            sessions_by_task[task_id],
            key=lambda session: session.session_id,
        )[: allocation.scheduled_counts[task_id]]
        for session, start in zip(selected_sessions, sorted(starts), strict=True):
            witness_starts[session.session_id] = start

    placement = _solve_witness_day_placement(
        problem,
        tasks,
        status,
        set(witness_starts),
        candidates_by_session,
        day_options_by_session,
        witness_starts,
        solve_deadline,
    )
    if placement.status is KernelStatus.TECHNICAL_FAILURE or assignment_solver is None:
        return placement
    return OverloadResult(
        placement.status,
        placement.sessions,
        placement.allocations,
        SolverDiagnostics(
            "OPTIMAL",
            policy_wall_time + placement.diagnostics.wall_time_seconds,
            policy_conflicts + placement.diagnostics.conflicts,
            policy_branches + placement.diagnostics.branches,
        ),
        placement.detail,
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
    if not problem.planning_days:
        return OverloadResult(
            KernelStatus.TECHNICAL_FAILURE,
            (),
            (),
            empty_diagnostics("DAY_DOMAIN_REQUIRED"),
            "Local planning-day metadata is required for schedule policy",
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
    objective_terms_by_task: dict[str, list[tuple[cp_model.IntVar, int]]] = defaultdict(list)
    schedulable_sessions_by_task: dict[str, int] = defaultdict(int)
    hint_variables: list[cp_model.IntVar] = []
    symmetry_groups: dict[
        tuple[str, int, tuple[tuple[int, int], ...]], list[_OptionalSessionVariable]
    ] = defaultdict(list)
    maximum_delay_by_session: dict[str, int] = {}
    candidates_by_session: dict[str, list[list[int]]] = {}
    day_options_by_session: dict[str, tuple[_DayStartOption, ...]] = {}
    day_options_cache: dict[tuple[tuple[int, int], ...], tuple[_DayStartOption, ...] | None] = {}

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
        hint_variables.extend((start, presence))
        objective_terms_by_task[demand.task_id].append((presence, demand.duration_minutes))
        schedulable_sessions_by_task[demand.task_id] += 1
        candidates_by_session[demand.session_id] = candidate_intervals
        maximum_delay_by_session[demand.session_id] = (
            max(last for _, last in candidate_intervals) - problem.planning_start_minute
        )
        candidate_key = tuple((first, last) for first, last in candidate_intervals)
        symmetry_groups[(demand.task_id, demand.duration_minutes, candidate_key)].append(
            variables[-1]
        )

        if candidate_key not in day_options_cache:
            day_options_cache[candidate_key] = _day_start_options(
                candidate_intervals,
                problem.planning_days,
            )
        day_options = day_options_cache[candidate_key]
        if day_options is None:
            return OverloadResult(
                KernelStatus.TECHNICAL_FAILURE,
                (),
                (),
                empty_diagnostics("DAY_DOMAIN_INCOMPLETE"),
                f"Planning days do not cover every start for session {demand.session_id!r}",
            )
        day_options_by_session[demand.session_id] = day_options

    for group in symmetry_groups.values():
        ordered_group = sorted(group, key=lambda variable: variable.demand.session_id)
        for previous, following in pairwise(ordered_group):
            previous_start = cast(cp_model.IntVar, previous.start)
            previous_presence = cast(cp_model.IntVar, previous.presence)
            following_start = cast(cp_model.IntVar, following.start)
            following_presence = cast(cp_model.IntVar, following.presence)
            model.add(previous_presence >= following_presence)
            model.add(previous_start <= following_start).only_enforce_if(following_presence)

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
        _AllocationObjective(
            task,
            cp_model.LinearExpr.sum(
                [
                    variable * duration
                    for variable, duration in objective_terms_by_task[task.task_id]
                ]
            ),
            sum(duration for _, duration in objective_terms_by_task[task.task_id]),
        )
        for task in ordered_tasks
        if objective_terms_by_task[task.task_id]
    ]
    if not objectives:
        return OverloadResult(
            KernelStatus.OVERLOAD,
            (),
            _allocations(tasks, set(), problem),
            empty_diagnostics("EMPTY_DOMAIN"),
            "Some work could not fit before its deadline",
        )

    solver: cp_model.CpSolver | None = None
    solver_status = cp_model.UNKNOWN
    present_variables: list[_OptionalSessionVariable] = []
    objective_index = 0

    schedulable_variables = [variable for variable in variables if variable.presence is not None]
    spread_greedy_starts = _greedy_policy_hint(
        ordered_tasks,
        variables,
        candidates_by_session,
        day_options_by_session,
        problem.minimum_break_minutes,
        spread_across_days=True,
    )
    greedy_starts = spread_greedy_starts
    if len(greedy_starts) != len(problem.sessions):
        packed_greedy_starts = _greedy_policy_hint(
            ordered_tasks,
            variables,
            candidates_by_session,
            day_options_by_session,
            problem.minimum_break_minutes,
            spread_across_days=False,
        )
        if len(packed_greedy_starts) > len(greedy_starts):
            greedy_starts = packed_greedy_starts
    uniform_allocation = _uniform_allocation(problem, ordered_tasks)
    if uniform_allocation is not None:
        if _uniform_witness_is_policy_optimal(
            problem,
            uniform_allocation,
            spread_greedy_starts,
            day_options_by_session,
        ):
            uniform_status = (
                KernelStatus.FEASIBLE
                if len(spread_greedy_starts) == len(problem.sessions)
                else KernelStatus.OVERLOAD
            )
            return _solve_witness_day_placement(
                problem,
                tasks,
                uniform_status,
                set(spread_greedy_starts),
                candidates_by_session,
                day_options_by_session,
                spread_greedy_starts,
                solve_deadline,
            )
        flow_policy_starts = _uniform_flow_policy_witness(problem, uniform_allocation)
        if flow_policy_starts is not None:
            uniform_status = (
                KernelStatus.FEASIBLE
                if len(flow_policy_starts) == len(problem.sessions)
                else KernelStatus.OVERLOAD
            )
            return _solve_witness_day_placement(
                problem,
                tasks,
                uniform_status,
                set(flow_policy_starts),
                candidates_by_session,
                day_options_by_session,
                flow_policy_starts,
                solve_deadline,
            )
        return _solve_uniform_spread_placement(
            problem,
            tasks,
            uniform_allocation,
            candidates_by_session,
            day_options_by_session,
            solve_deadline,
        )
    _set_greedy_hints(model, variables, candidates_by_session, greedy_starts)

    if len(greedy_starts) != len(problem.sessions):
        _add_window_capacity_cuts(
            model,
            variables,
            candidates_by_session,
            greedy_starts,
            problem.minimum_break_minutes,
            hint_variables,
        )
        validation_error = model.validate()
        if validation_error:
            return OverloadResult(
                KernelStatus.TECHNICAL_FAILURE,
                (),
                (),
                empty_diagnostics("MODEL_INVALID"),
                validation_error,
            )

    greedy_minutes_by_task: dict[str, int] = defaultdict(int)
    for session in problem.sessions:
        if session.session_id in greedy_starts:
            greedy_minutes_by_task[session.task_id] += session.duration_minutes
    while (
        objective_index < len(objectives)
        and greedy_minutes_by_task[objectives[objective_index].task.task_id]
        == objectives[objective_index].maximum_minutes
    ):
        model.add(
            objectives[objective_index].expression == objectives[objective_index].maximum_minutes
        )
        objective_index += 1

    if len(greedy_starts) == len(problem.sessions):
        present_variables = schedulable_variables
        objective_index = len(objectives)
    elif objective_index == len(objectives):
        present_variables = [
            variable
            for variable in schedulable_variables
            if variable.demand.session_id in greedy_starts
        ]
    elif len(schedulable_variables) == len(problem.sessions):
        remaining_seconds = solve_deadline - monotonic()
        if remaining_seconds <= 0:
            return OverloadResult(
                KernelStatus.TECHNICAL_FAILURE,
                (),
                (),
                empty_diagnostics("TIME_LIMIT"),
                "The overload policy exhausted its shared solve budget",
            )
        model.add_assumptions(
            [cast(cp_model.IntVar, variable.presence) for variable in schedulable_variables]
        )
        solver = configured_solver(min(_FEASIBILITY_PROBE_SECONDS, remaining_seconds))
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
        finally:
            model.clear_assumptions()

        if solver_status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            present_variables = schedulable_variables
            _replace_solution_hints(model, solver, hint_variables)
            objective_index = len(objectives)
        elif solver_status not in (cp_model.INFEASIBLE, cp_model.UNKNOWN):
            return OverloadResult(
                KernelStatus.TECHNICAL_FAILURE,
                (),
                (),
                solver_diagnostics(solver, solver_status),
                "The solver stopped without a usable feasibility result",
            )

    while objective_index < len(objectives):
        batch_end, objective = _next_allocation_batch(objectives, objective_index)
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
        lower_task_ids = {task_objective.task.task_id for task_objective in objectives[batch_end:]}
        model.add_assumptions(
            [
                cast(cp_model.IntVar, variable.presence).negated()
                for variable in schedulable_variables
                if variable.demand.task_id in lower_task_ids
            ]
        )
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
        finally:
            model.clear_assumptions()

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
            _replace_solution_hints(model, solver, hint_variables)
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

        for task_objective in objectives[objective_index:batch_end]:
            optimum_minutes = solver.value(task_objective.expression)
            model.add(task_objective.expression == optimum_minutes)
        objective_index = batch_end
        _replace_solution_hints(model, solver, hint_variables)

    all_sessions_scheduled = len(present_variables) == len(problem.sessions)
    status = KernelStatus.FEASIBLE if all_sessions_scheduled else KernelStatus.OVERLOAD
    if all_sessions_scheduled:
        for variable in variables:
            if variable.presence is not None:
                model.add(variable.presence == 1)

    present_session_ids = {variable.demand.session_id for variable in present_variables}
    has_spread_witness = set(spread_greedy_starts) == present_session_ids
    if has_spread_witness:
        _set_greedy_hints(
            model,
            variables,
            candidates_by_session,
            spread_greedy_starts,
        )

    earliness_terms: list[cp_model.IntVar] = []
    day_choices_by_task: dict[tuple[str, int], list[cp_model.IntVar]] = defaultdict(list)
    hinted_used_days_by_task: dict[str, set[int]] = defaultdict(set)
    for variable in schedulable_variables:
        start = cast(cp_model.IntVar, variable.start)
        presence = cast(cp_model.IntVar, variable.presence)
        delay = model.new_int_var(
            0,
            maximum_delay_by_session[variable.demand.session_id],
            f"delay_{variable.demand.session_id}",
        )
        model.add(delay == start - problem.planning_start_minute).only_enforce_if(presence)
        model.add(delay == 0).only_enforce_if(presence.negated())
        earliness_terms.append(delay)
        hint_variables.append(delay)
        scheduled_start = spread_greedy_starts.get(variable.demand.session_id)
        if has_spread_witness:
            model.add_hint(
                delay,
                scheduled_start - problem.planning_start_minute
                if scheduled_start is not None
                else 0,
            )

        day_choices: list[cp_model.IntVar] = []
        for option in day_options_by_session[variable.demand.session_id]:
            choice = model.new_bool_var(f"day_{variable.demand.session_id}_{option.day_index}")
            model.add(start >= option.first_start).only_enforce_if(choice)
            model.add(start <= option.last_start).only_enforce_if(choice)
            day_choices.append(choice)
            hint_variables.append(choice)
            day_choices_by_task[(variable.demand.task_id, option.day_index)].append(choice)
            if has_spread_witness:
                uses_option = scheduled_start is not None and (
                    option.first_start <= scheduled_start <= option.last_start
                )
                choice_value = int(uses_option)
                model.add_hint(choice, choice_value)
                if uses_option:
                    hinted_used_days_by_task[variable.demand.task_id].add(option.day_index)
        model.add(sum(day_choices) == presence)

    used_days_by_task: dict[str, list[cp_model.IntVar]] = defaultdict(list)
    for (task_id, day_index), day_choices in sorted(day_choices_by_task.items()):
        used_day = model.new_bool_var(f"used_day_{task_id}_{day_index}")
        model.add_max_equality(used_day, day_choices)
        used_days_by_task[task_id].append(used_day)
        hint_variables.append(used_day)
        if has_spread_witness:
            model.add_hint(used_day, int(day_index in hinted_used_days_by_task[task_id]))

    spread_variables_by_day_count: dict[int, list[cp_model.IntVar]] = {}
    maximum_candidate_days = max(
        (
            min(len(used_days), schedulable_sessions_by_task[task_id])
            for task_id, used_days in used_days_by_task.items()
        ),
        default=1,
    )
    for day_count in range(2, maximum_candidate_days + 1):
        reaches_day_count: list[cp_model.IntVar] = []
        for task_id, used_days in sorted(used_days_by_task.items()):
            if len(used_days) < day_count or schedulable_sessions_by_task[task_id] < day_count:
                continue
            reaches = model.new_bool_var(f"task_{task_id}_uses_{day_count}_days")
            model.add(sum(used_days) >= day_count).only_enforce_if(reaches)
            model.add(sum(used_days) <= day_count - 1).only_enforce_if(reaches.negated())
            reaches_day_count.append(reaches)
            hint_variables.append(reaches)
            if has_spread_witness:
                reaches_hint = len(hinted_used_days_by_task[task_id]) >= day_count
                model.add_hint(reaches, int(reaches_hint))
        if reaches_day_count:
            spread_variables_by_day_count[day_count] = reaches_day_count

    spread_objective: cp_model.LinearExpr | None = None
    if spread_variables_by_day_count:
        extra_day_weights = {
            day_count: maximum_candidate_days - day_count + 1
            for day_count in spread_variables_by_day_count
            if day_count >= 3
        }
        maximum_extra_score = sum(
            len(spread_variables_by_day_count[day_count]) * weight
            for day_count, weight in extra_day_weights.items()
        )
        second_day_weight = maximum_extra_score + 1
        spread_terms: list[cp_model.LinearExpr] = []
        for day_count, reaches_variables in sorted(spread_variables_by_day_count.items()):
            weight = second_day_weight if day_count == 2 else extra_day_weights[day_count]
            spread_terms.extend(variable * weight for variable in reaches_variables)
        spread_objective = cp_model.LinearExpr.sum(spread_terms)

    validation_error = model.validate()
    if validation_error:
        return OverloadResult(
            KernelStatus.TECHNICAL_FAILURE,
            (),
            (),
            empty_diagnostics("MODEL_INVALID"),
            validation_error,
        )

    placement_objectives: list[tuple[str, cp_model.LinearExpr]] = []
    if spread_objective is not None:
        placement_objectives.append(("spread", spread_objective))
    if earliness_terms:
        placement_objectives.append(("earliness", cp_model.LinearExpr.sum(earliness_terms)))

    for objective_name, objective in placement_objectives:
        remaining_seconds = solve_deadline - monotonic()
        if remaining_seconds <= 0:
            return OverloadResult(
                KernelStatus.TECHNICAL_FAILURE,
                (),
                (),
                empty_diagnostics("TIME_LIMIT"),
                "The placement policy exhausted its shared solve budget",
            )

        if objective_name == "spread":
            model.maximize(objective)
        else:
            model.minimize(objective)
        placement_solver = configured_solver(remaining_seconds)
        try:
            placement_status = placement_solver.solve(model)
        except (RuntimeError, ValueError) as error:
            return OverloadResult(
                KernelStatus.TECHNICAL_FAILURE,
                (),
                (),
                empty_diagnostics("EXCEPTION"),
                str(error),
            )

        if placement_status != cp_model.OPTIMAL:
            return OverloadResult(
                KernelStatus.TECHNICAL_FAILURE,
                (),
                (),
                solver_diagnostics(placement_solver, placement_status),
                f"The {objective_name} placement objective was not proven optimal",
            )

        solver = placement_solver
        solver_status = placement_status
        present_variables = [
            variable
            for variable in variables
            if variable.presence is not None and placement_solver.boolean_value(variable.presence)
        ]
        if objective_name == "spread":
            achieved_spread = round(placement_solver.objective_value)
            model.add(objective == achieved_spread)
        _replace_solution_hints(model, placement_solver, hint_variables)

    final_solver = cast(cp_model.CpSolver, solver)
    diagnostics = solver_diagnostics(final_solver, solver_status)

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
