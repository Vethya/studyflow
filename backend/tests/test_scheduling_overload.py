from __future__ import annotations

from itertools import pairwise
from time import monotonic
from typing import Any, cast

import pytest
from ortools.graph.python import min_cost_flow  # type: ignore[import-untyped]
from ortools.sat.python import cp_model

from studyflow.scheduling import (
    FeasibilityProblem,
    KernelStatus,
    MinuteWindow,
    PlanningDay,
    SessionDemand,
    SolverDiagnostics,
    TaskPriority,
    classify_overload_status,
    solve_with_overload,
)
from studyflow.scheduling.overload import _DayStartOption

DEFAULT_PLANNING_DAYS = (PlanningDay(0, -1_000_000, 1_000_000),)


def overload_problem(
    sessions: tuple[SessionDemand, ...],
    planning_start_minute: int,
    minimum_break_minutes: int = 0,
    max_solve_seconds: float = 4.0,
) -> FeasibilityProblem:
    return FeasibilityProblem(
        sessions,
        planning_start_minute,
        minimum_break_minutes,
        max_solve_seconds,
        DEFAULT_PLANNING_DAYS,
    )


def demand(
    session_id: str,
    task_id: str,
    duration: int,
    *windows: tuple[int, int],
    deadline: int = 1_000,
    priority: TaskPriority = TaskPriority.MEDIUM,
) -> SessionDemand:
    return SessionDemand(
        session_id,
        task_id,
        duration,
        deadline,
        tuple(MinuteWindow(start, end) for start, end in windows),
        priority,
    )


def assert_valid_subset(problem: FeasibilityProblem) -> None:
    result = solve_with_overload(problem)
    assert result.status in (KernelStatus.FEASIBLE, KernelStatus.OVERLOAD)

    by_id = {item.session_id: item for item in problem.sessions}
    for scheduled in result.sessions:
        requested = by_id[scheduled.session_id]
        assert scheduled.end_minute - scheduled.start_minute == requested.duration_minutes
        assert scheduled.start_minute >= problem.planning_start_minute
        assert scheduled.end_minute <= requested.deadline_minute
        assert any(
            window.start <= scheduled.start_minute and scheduled.end_minute <= window.end
            for window in requested.allowed_windows
        )

    for previous, following in pairwise(result.sessions):
        assert following.start_minute >= previous.end_minute + problem.minimum_break_minutes


def allocation_by_task(problem: FeasibilityProblem) -> dict[str, tuple[int, int, int]]:
    result = solve_with_overload(problem)
    return {
        item.task_id: (
            item.scheduled_minutes,
            item.unscheduled_minutes,
            item.shortfall_minutes,
        )
        for item in result.allocations
    }


def test_empty_problem_is_feasible() -> None:
    result = solve_with_overload(overload_problem((), planning_start_minute=0))

    assert result.status is KernelStatus.FEASIBLE
    assert result.sessions == ()
    assert result.allocations == ()
    assert result.diagnostics.solver_status == "EMPTY"


def test_returns_every_session_when_all_work_fits() -> None:
    problem = overload_problem(
        (
            demand("a", "alpha", 3, (0, 10), deadline=10),
            demand("b", "beta", 2, (0, 10), deadline=10),
        ),
        planning_start_minute=0,
        minimum_break_minutes=1,
    )

    result = solve_with_overload(problem)

    assert result.status is KernelStatus.FEASIBLE
    assert len(result.sessions) == 2
    assert allocation_by_task(problem) == {
        "alpha": (3, 0, 0),
        "beta": (2, 0, 0),
    }
    assert_valid_subset(problem)


def test_returns_proven_overload_with_exact_per_task_shortfall() -> None:
    problem = overload_problem(
        (
            demand(
                "important",
                "alpha",
                4,
                (0, 6),
                deadline=6,
                priority=TaskPriority.HIGH,
            ),
            demand(
                "other",
                "beta",
                4,
                (0, 6),
                deadline=6,
                priority=TaskPriority.LOW,
            ),
        ),
        planning_start_minute=0,
    )

    result = solve_with_overload(problem)

    assert result.status is KernelStatus.OVERLOAD
    assert {session.session_id for session in result.sessions} == {"important"}
    assert allocation_by_task(problem) == {
        "alpha": (4, 0, 0),
        "beta": (0, 4, 4),
    }
    assert result.detail == "Some work could not fit before its deadline"
    assert_valid_subset(problem)


def test_session_with_no_valid_domain_stays_unscheduled_without_blocking_other_work() -> None:
    problem = overload_problem(
        (
            demand("too-long", "alpha", 7, (0, 6), deadline=6),
            demand("fits", "beta", 4, (0, 6), deadline=6),
        ),
        planning_start_minute=0,
    )

    result = solve_with_overload(problem)

    assert result.status is KernelStatus.OVERLOAD
    assert {session.session_id for session in result.sessions} == {"fits"}
    assert allocation_by_task(problem) == {
        "alpha": (0, 7, 7),
        "beta": (4, 0, 0),
    }


def test_all_empty_domains_are_proven_overload() -> None:
    problem = overload_problem(
        (demand("past", "task", 2, (0, 5), deadline=5),),
        planning_start_minute=10,
    )

    result = solve_with_overload(problem)

    assert result.status is KernelStatus.OVERLOAD
    assert result.sessions == ()
    assert result.allocations[0].raw_calendar_capacity_minutes == 0
    assert result.allocations[0].shortfall_minutes == 2


@pytest.mark.parametrize(
    ("solver_status", "all_scheduled", "expected"),
    [
        (cp_model.OPTIMAL, True, KernelStatus.FEASIBLE),
        (cp_model.OPTIMAL, False, KernelStatus.OVERLOAD),
        (cp_model.FEASIBLE, True, KernelStatus.FEASIBLE),
        (cp_model.FEASIBLE, False, KernelStatus.TECHNICAL_FAILURE),
        (cp_model.UNKNOWN, True, KernelStatus.TECHNICAL_FAILURE),
        (cp_model.UNKNOWN, False, KernelStatus.TECHNICAL_FAILURE),
        (cp_model.INFEASIBLE, False, KernelStatus.TECHNICAL_FAILURE),
        (cp_model.MODEL_INVALID, False, KernelStatus.TECHNICAL_FAILURE),
    ],
)
def test_classifies_partial_solutions_only_when_overload_is_proven(
    solver_status: cp_model.CpSolverStatus,
    all_scheduled: bool,
    expected: KernelStatus,
) -> None:
    assert classify_overload_status(solver_status, all_sessions_scheduled=all_scheduled) is expected


def test_low_priority_due_soon_beats_high_priority_due_much_later() -> None:
    problem = overload_problem(
        (
            demand(
                "soon",
                "soon-task",
                60,
                (0, 60),
                deadline=1_440,
                priority=TaskPriority.LOW,
            ),
            demand(
                "later",
                "later-task",
                60,
                (0, 60),
                deadline=43_200,
                priority=TaskPriority.HIGH,
            ),
        ),
        planning_start_minute=0,
    )

    result = solve_with_overload(problem)

    assert result.status is KernelStatus.OVERLOAD
    assert {session.session_id for session in result.sessions} == {"soon"}


def test_least_calendar_slack_wins_before_priority() -> None:
    problem = overload_problem(
        (
            demand(
                "tight",
                "tight-task",
                4,
                (0, 4),
                deadline=10,
                priority=TaskPriority.LOW,
            ),
            demand(
                "loose",
                "loose-task",
                4,
                (0, 6),
                deadline=10,
                priority=TaskPriority.HIGH,
            ),
        ),
        planning_start_minute=0,
    )

    result = solve_with_overload(problem)

    assert result.status is KernelStatus.OVERLOAD
    assert {session.session_id for session in result.sessions} == {"tight"}


def test_least_slack_strictly_dominates_a_larger_lower_ranked_task() -> None:
    problem = overload_problem(
        (
            demand(
                "tight",
                "tight-task",
                2,
                (0, 2),
                deadline=10,
                priority=TaskPriority.LOW,
            ),
            demand(
                "larger",
                "larger-task",
                5,
                (0, 6),
                deadline=10,
                priority=TaskPriority.HIGH,
            ),
        ),
        planning_start_minute=0,
    )

    result = solve_with_overload(problem)

    assert result.status is KernelStatus.OVERLOAD
    assert {session.session_id for session in result.sessions} == {"tight"}


def test_minimum_break_capacity_is_included_in_slack() -> None:
    shared_window = ((0, 10),)
    problem = overload_problem(
        (
            demand(
                "tight-a",
                "tight-task",
                4,
                *shared_window,
                deadline=10,
                priority=TaskPriority.LOW,
            ),
            demand(
                "tight-b",
                "tight-task",
                4,
                *shared_window,
                deadline=10,
                priority=TaskPriority.LOW,
            ),
            demand(
                "apparently-tighter",
                "other-task",
                9,
                *shared_window,
                deadline=10,
                priority=TaskPriority.HIGH,
            ),
        ),
        planning_start_minute=0,
        minimum_break_minutes=2,
    )

    result = solve_with_overload(problem)

    assert result.status is KernelStatus.OVERLOAD
    assert {session.session_id for session in result.sessions} == {"tight-a", "tight-b"}


def test_unavailable_gap_can_satisfy_the_entire_minimum_break() -> None:
    problem = overload_problem(
        (
            demand("gapped-a", "gapped-task", 4, (0, 5), (10, 15), deadline=15),
            demand("gapped-b", "gapped-task", 4, (0, 5), (10, 15), deadline=15),
            demand("tighter", "other-task", 8, (0, 9), deadline=15),
        ),
        planning_start_minute=0,
        minimum_break_minutes=2,
    )

    result = solve_with_overload(problem)

    assert result.status is KernelStatus.OVERLOAD
    assert "tighter" in {session.session_id for session in result.sessions}


def test_unavailable_gap_can_satisfy_part_of_the_minimum_break() -> None:
    problem = overload_problem(
        (
            demand("gapped-a", "gapped-task", 4, (0, 5), (6, 11), deadline=11),
            demand("gapped-b", "gapped-task", 4, (0, 5), (6, 11), deadline=11),
            demand("tighter", "other-task", 4, (0, 4), deadline=11),
        ),
        planning_start_minute=0,
        minimum_break_minutes=2,
    )

    result = solve_with_overload(problem)

    assert result.status is KernelStatus.OVERLOAD
    assert "tighter" in {session.session_id for session in result.sessions}


def test_larger_remaining_work_wins_before_priority_when_slack_and_deadline_match() -> None:
    problem = overload_problem(
        (
            demand(
                "larger",
                "larger-task",
                6,
                (0, 8),
                deadline=10,
                priority=TaskPriority.LOW,
            ),
            demand(
                "smaller",
                "smaller-task",
                4,
                (0, 6),
                deadline=10,
                priority=TaskPriority.HIGH,
            ),
        ),
        planning_start_minute=0,
    )

    result = solve_with_overload(problem)

    assert result.status is KernelStatus.OVERLOAD
    assert {session.session_id for session in result.sessions} == {"larger"}


def test_priority_breaks_an_otherwise_equal_case() -> None:
    problem = overload_problem(
        (
            demand(
                "low",
                "low-task",
                4,
                (0, 6),
                deadline=10,
                priority=TaskPriority.LOW,
            ),
            demand(
                "high",
                "high-task",
                4,
                (0, 6),
                deadline=10,
                priority=TaskPriority.HIGH,
            ),
        ),
        planning_start_minute=0,
    )

    result = solve_with_overload(problem)

    assert result.status is KernelStatus.OVERLOAD
    assert {session.session_id for session in result.sessions} == {"high"}


def test_objective_maximizes_minutes_instead_of_session_count() -> None:
    shared_windows = ((0, 6),)
    problem = overload_problem(
        (
            demand("full", "task", 6, *shared_windows, deadline=6),
            demand("remainder", "task", 2, *shared_windows, deadline=6),
        ),
        planning_start_minute=0,
    )

    result = solve_with_overload(problem)

    assert result.status is KernelStatus.OVERLOAD
    assert {session.session_id for session in result.sessions} == {"full"}
    assert allocation_by_task(problem) == {"task": (6, 2, 2)}


def test_calendar_capacity_clips_and_merges_windows() -> None:
    problem = overload_problem(
        (demand("session", "task", 1, (-5, 5), (3, 12), (20, 30), deadline=10),),
        planning_start_minute=0,
    )

    result = solve_with_overload(problem)

    assert result.status is KernelStatus.FEASIBLE
    assert result.allocations[0].raw_calendar_capacity_minutes == 10


def test_available_minutes_and_shortfall_come_from_the_feasible_allocation() -> None:
    problem = overload_problem(
        (
            demand(
                "winner",
                "winner-task",
                2,
                (0, 2),
                deadline=2,
                priority=TaskPriority.HIGH,
            ),
            demand(
                "blocked",
                "blocked-task",
                2,
                (0, 2),
                deadline=2,
                priority=TaskPriority.LOW,
            ),
        ),
        planning_start_minute=0,
    )

    result = solve_with_overload(problem)
    blocked = next(item for item in result.allocations if item.task_id == "blocked-task")

    assert blocked.required_minutes == 2
    assert blocked.raw_calendar_capacity_minutes == 2
    assert blocked.available_minutes_before_deadline == 0
    assert blocked.shortfall_minutes == 2


def test_rejects_inconsistent_metadata_for_sessions_of_one_task() -> None:
    problem = overload_problem(
        (
            demand("a", "task", 2, (0, 6), deadline=6),
            demand("b", "task", 2, (0, 6), deadline=5),
        ),
        planning_start_minute=0,
    )

    with pytest.raises(ValueError, match="must share deadline"):
        solve_with_overload(problem)


def test_rejects_untyped_priority() -> None:
    with pytest.raises(TypeError, match="TaskPriority"):
        demand("session", "task", 1, (0, 2), priority=cast(Any, "high"))


def test_invalid_model_becomes_a_typed_technical_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "studyflow.scheduling.overload.cp_model.CpModel.validate",
        lambda _model: "injected invalid model",
    )

    result = solve_with_overload(
        overload_problem(
            (
                demand("a", "task", 2, (0, 2)),
                demand("b", "task", 1, (0, 2)),
            ),
            planning_start_minute=0,
        )
    )

    assert result.status is KernelStatus.TECHNICAL_FAILURE
    assert result.diagnostics.solver_status == "MODEL_INVALID"
    assert result.detail == "injected invalid model"


def test_solver_exception_becomes_a_typed_technical_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fail_solve(_solver: object, _model: object) -> object:
        raise RuntimeError("injected solver failure")

    monkeypatch.setattr(
        "studyflow.scheduling.overload.cp_model.CpSolver.solve",
        fail_solve,
    )

    result = solve_with_overload(
        overload_problem(
            (
                demand("a", "task", 2, (0, 2)),
                demand("b", "task", 1, (0, 2)),
            ),
            planning_start_minute=0,
        )
    )

    assert result.status is KernelStatus.TECHNICAL_FAILURE
    assert result.diagnostics.solver_status == "EXCEPTION"
    assert result.detail == "injected solver failure"


def test_unproven_solver_result_discards_the_partial_schedule(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "studyflow.scheduling.overload.cp_model.CpSolver.solve",
        lambda _solver, _model: cp_model.UNKNOWN,
    )
    monkeypatch.setattr(
        "studyflow.scheduling.overload.solver_diagnostics",
        lambda _solver, _status: SolverDiagnostics("UNKNOWN", 0.0, 0, 0),
    )

    result = solve_with_overload(
        overload_problem(
            (
                demand("a", "task", 2, (0, 2)),
                demand("b", "task", 1, (0, 2)),
            ),
            planning_start_minute=0,
        )
    )

    assert result.status is KernelStatus.TECHNICAL_FAILURE
    assert result.sessions == ()
    assert result.allocations == ()
    assert result.detail == "The solver stopped without a proven overload allocation"


def test_staged_policy_uses_one_shared_time_budget(monkeypatch: pytest.MonkeyPatch) -> None:
    times = iter((0.0, 1.0))
    monkeypatch.setattr(
        "studyflow.scheduling.overload.monotonic",
        lambda: next(times),
    )

    result = solve_with_overload(
        overload_problem(
            (
                demand("a", "task", 2, (0, 2)),
                demand("b", "task", 1, (0, 2)),
            ),
            planning_start_minute=0,
            max_solve_seconds=0.5,
        )
    )

    assert result.status is KernelStatus.TECHNICAL_FAILURE
    assert result.diagnostics.solver_status == "TIME_LIMIT"
    assert result.detail == "The overload policy exhausted its shared solve budget"


def test_overload_policy_preparation_error() -> None:
    from studyflow.scheduling.overload import _PolicyPreparationError

    err = _PolicyPreparationError("MODEL_INVALID", "Validation error detail")
    assert err.solver_status == "MODEL_INVALID"
    assert str(err) == "Validation error detail"


def test_overload_policy_preparation_error_handling(monkeypatch: pytest.MonkeyPatch) -> None:
    from studyflow.scheduling.overload import _PolicyPreparationError

    def mock_task_demands(*args: object, **kwargs: object) -> object:
        raise _PolicyPreparationError("TIME_LIMIT", "prep timeout")

    monkeypatch.setattr("studyflow.scheduling.overload._task_demands", mock_task_demands)
    result = solve_with_overload(
        overload_problem(
            (demand("a", "task", 2, (0, 2)),),
            planning_start_minute=0,
        )
    )
    assert result.status is KernelStatus.TECHNICAL_FAILURE
    assert result.diagnostics.solver_status == "TIME_LIMIT"
    assert result.detail == "prep timeout"


def test_overload_phase1_nonstandard_status(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "studyflow.scheduling.overload.cp_model.CpSolver.solve",
        lambda _solver, _model: cp_model.MODEL_INVALID,
    )
    monkeypatch.setattr(
        "studyflow.scheduling.overload.solver_diagnostics",
        lambda _solver, _status: SolverDiagnostics("MODEL_INVALID", 0.0, 0, 0),
    )

    # 2 conflicting sessions with distinct durations bypass uniform allocation
    # and force probe solver
    result = solve_with_overload(
        overload_problem(
            (
                demand("a", "task_a", 2, (0, 2)),
                demand("b", "task_b", 1, (0, 2)),
            ),
            planning_start_minute=0,
        )
    )
    assert result.status is KernelStatus.TECHNICAL_FAILURE
    assert result.detail == "The solver stopped without a usable feasibility result"


def test_overload_phase2_solver_exception(monkeypatch: pytest.MonkeyPatch) -> None:
    solve_call_count = 0

    def mock_solve(_solver: object, _model: object) -> int:
        nonlocal solve_call_count
        solve_call_count += 1
        if solve_call_count == 1:
            # Phase 1 probe: report infeasible so it proceeds to Phase 2 batch allocation
            return int(cp_model.INFEASIBLE)
        # Phase 2 allocation: raise exception
        raise RuntimeError("allocation failure")

    monkeypatch.setattr("studyflow.scheduling.overload.cp_model.CpSolver.solve", mock_solve)

    result = solve_with_overload(
        overload_problem(
            (
                demand("a", "task_a", 2, (0, 2)),
                demand("b", "task_b", 1, (0, 2)),
            ),
            planning_start_minute=0,
        )
    )
    assert result.status is KernelStatus.TECHNICAL_FAILURE
    assert result.diagnostics.solver_status == "EXCEPTION"
    assert result.detail == "allocation failure"


def test_overload_placement_exceptions_and_budget_exhaustion(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # 1. Placement model validation failure (line 1991)
    monkeypatch.setattr(
        "studyflow.scheduling.overload.cp_model.CpModel.validate",
        lambda _self: "Placement model invalid",
    )
    result = solve_with_overload(
        overload_problem(
            (
                demand("a", "task_a", 2, (0, 10)),
                demand("b", "task_b", 3, (0, 10)),
            ),
            planning_start_minute=0,
        )
    )
    assert result.status is KernelStatus.TECHNICAL_FAILURE
    assert result.diagnostics.solver_status == "MODEL_INVALID"
    assert result.detail == "Placement model invalid"

    # 2. Placement solve exception (lines 2023-2024)
    monkeypatch.undo()

    def mock_solve_placement(_solver: object, _model: object) -> int:
        raise ValueError("placement solver crash")

    monkeypatch.setattr(
        "studyflow.scheduling.overload.cp_model.CpSolver.solve", mock_solve_placement
    )
    result2 = solve_with_overload(
        overload_problem(
            (
                demand("a", "task_a", 2, (0, 10)),
                demand("b", "task_b", 3, (0, 10)),
            ),
            planning_start_minute=0,
        )
    )
    assert result2.status is KernelStatus.TECHNICAL_FAILURE
    assert result2.diagnostics.solver_status == "EXCEPTION"
    assert result2.detail == "placement solver crash"

    # 3. Placement non-optimal status (line 2033)
    monkeypatch.undo()
    monkeypatch.setattr(
        "studyflow.scheduling.overload.cp_model.CpSolver.solve",
        lambda _solver, _model: cp_model.FEASIBLE,
    )
    monkeypatch.setattr(
        "studyflow.scheduling.overload.solver_diagnostics",
        lambda _solver, _status: SolverDiagnostics("FEASIBLE", 0.0, 0, 0),
    )
    result3 = solve_with_overload(
        overload_problem(
            (
                demand("a", "task_a", 2, (0, 10)),
                demand("b", "task_b", 3, (0, 10)),
            ),
            planning_start_minute=0,
        )
    )
    assert result3.status is KernelStatus.TECHNICAL_FAILURE
    assert "placement objective was not proven optimal" in str(result3.detail)

    # 4. Placement solve budget exhaustion (line 2008)
    monkeypatch.undo()
    clock = [100.0]

    def mock_monotonic() -> float:
        clock[0] += 100.0
        return clock[0]

    monkeypatch.setattr("studyflow.scheduling.overload.monotonic", mock_monotonic)
    result4 = solve_with_overload(
        overload_problem(
            (
                demand("a", "task_a", 2, (0, 10)),
                demand("b", "task_b", 3, (0, 10)),
            ),
            planning_start_minute=0,
            max_solve_seconds=1.0,
        )
    )
    assert result4.status is KernelStatus.TECHNICAL_FAILURE
    assert result4.diagnostics.solver_status == "TIME_LIMIT"
    assert "exhausted its shared solve budget" in str(result4.detail)


def test_overload_break_credit_and_zero_break_capacity_branches(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from studyflow.scheduling.overload import (
        _credit_options,
        _has_zero_break_capacity,
        _TaskInput,
    )

    # 1. _credit_options when start_minute is outside candidates (line 228)
    options = _credit_options(
        duration_minutes=10,
        candidate_intervals=[[100, 200]],
        scheduling_windows=((0, 50),),
        availability_windows=((0, 50),),
        minimum_break_minutes=5,
    )
    assert options == ()

    assert _credit_options(
        duration_minutes=1,
        candidate_intervals=[[0, 10]],
        scheduling_windows=((0, 5),),
        availability_windows=((0, 10),),
        minimum_break_minutes=5,
    ) == ()

    # 2. _has_zero_break_capacity when durations <= 1 (line 279)
    single_session_task = _TaskInput(
        task_id="t1",
        deadline_minute=100,
        priority=TaskPriority.MEDIUM,
        allowed_windows=(MinuteWindow(0, 100),),
        sessions=(demand("s1", "t1", 30, (0, 100)),),
        required_minutes=30,
        calendar_capacity_minutes=100,
    )
    assert _has_zero_break_capacity(single_session_task, ((0, 100),), 10) is True

    # 3. _has_zero_break_capacity when len(scheduling_windows) < len(durations) (line 281)
    multi_session_task = _TaskInput(
        task_id="t2",
        deadline_minute=100,
        priority=TaskPriority.MEDIUM,
        allowed_windows=(MinuteWindow(0, 100),),
        sessions=(
            demand("s1", "t2", 30, (0, 100)),
            demand("s2", "t2", 30, (0, 100)),
        ),
        required_minutes=60,
        calendar_capacity_minutes=100,
    )
    assert _has_zero_break_capacity(multi_session_task, ((0, 100),), 10) is False

    no_final_fit_task = _TaskInput(
        task_id="t3",
        deadline_minute=30,
        priority=TaskPriority.MEDIUM,
        allowed_windows=(MinuteWindow(0, 10), MinuteWindow(20, 30)),
        sessions=(
            demand("s1", "t3", 2, (0, 10), (20, 30), deadline=30),
            demand("s2", "t3", 2, (0, 10), (20, 30), deadline=30),
        ),
        required_minutes=4,
        calendar_capacity_minutes=20,
    )
    import studyflow.scheduling.overload as overload_module

    monkeypatch.setattr(overload_module, "candidate_start_intervals", lambda *_args: [[0, 1]])
    assert _has_zero_break_capacity(no_final_fit_task, ((0, 10), (20, 30)), 5) is False


def test_overload_policy_helper_fallbacks_and_uniform_guards(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from studyflow.scheduling import overload as overload_module

    task = overload_module._TaskDemand(
        "task",
        100,
        TaskPriority.MEDIUM,
        (MinuteWindow(0, 100),),
        1,
        0,
        100,
    )
    model = cp_model.CpModel()
    variable = model.new_int_var(0, 1, "objective")
    objective = overload_module._AllocationObjective(task, variable, cp_model.INT_MAX)
    assert overload_module._lexicographic_weights((cp_model.INT_MAX,), 0) is None
    monkeypatch.setattr(overload_module, "_lexicographic_weights", lambda *_args: None)
    assert overload_module._next_allocation_batch([objective], 0) == (1, variable)

    solver = cast(Any, type("ValueSolver", (), {"value": lambda _self, _value: 1})())
    overload_module._replace_solution_hints(model, solver, [variable, variable])

    huge_problem = overload_problem((demand("s", "task", 1, (0, 2_001), deadline=2_001),), 0)
    assert overload_module._uniform_allocation(huge_problem, (task,)) is None

    early = demand("early", "early", 1, (0, 2), deadline=2)
    latest = demand("latest", "latest", 1, (0, 2), deadline=10)
    discontinuous_tasks = (
        overload_module._TaskDemand(
            "early", 2, TaskPriority.MEDIUM, early.allowed_windows, 1, 0, 2
        ),
        overload_module._TaskDemand(
            "latest", 10, TaskPriority.MEDIUM, latest.allowed_windows, 1, 0, 10
        ),
    )

    def discontinuous_candidates(session: SessionDemand, _planning_start: int) -> list[list[int]]:
        return [[0, 2]] if session.session_id == "latest" else [[0, 0], [2, 2]]

    monkeypatch.setattr(overload_module, "candidate_start_intervals", discontinuous_candidates)
    assert overload_module._uniform_allocation(
        overload_problem((early, latest), 0), discontinuous_tasks
    ) is None

    import builtins

    first = demand("first", "first", 1, (0, 2), deadline=1)
    second = demand("second", "second", 1, (0, 2), deadline=2)
    duplicate_problem = overload_problem((first, second), 0)
    duplicate_tasks = (
        overload_module._TaskDemand(
            "first", 1, TaskPriority.MEDIUM, first.allowed_windows, 1, 0, 2
        ),
        overload_module._TaskDemand(
            "second", 2, TaskPriority.MEDIUM, second.allowed_windows, 1, 0, 2
        ),
    )
    original_sorted = builtins.sorted

    def reverse_selected_jobs(iterable: object, *args: object, **kwargs: object) -> list[object]:
        result = original_sorted(iterable, *args, **kwargs)  # type: ignore[call-overload]
        if result and all(
            isinstance(item, tuple)
            and len(item) == 3
            and isinstance(item[2], SessionDemand)
            for item in result
        ):
            result.reverse()
        return cast(list[object], result)

    def duplicate_candidates(session: SessionDemand, _planning_start: int) -> list[list[int]]:
        return [[0, 0]] if session.session_id == "first" else [[0, 2]]

    monkeypatch.setattr(overload_module, "candidate_start_intervals", duplicate_candidates)
    monkeypatch.setattr(overload_module, "sorted", reverse_selected_jobs, raising=False)
    assert overload_module._uniform_allocation(duplicate_problem, duplicate_tasks) is None


def test_overload_break_capacity_preparation_failures(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from studyflow.scheduling import overload as overload_module

    sessions = (
        demand("a", "task", 2, (0, 4), (10, 14), deadline=14),
        demand("b", "task", 2, (0, 4), (10, 14), deadline=14),
    )
    task = overload_module._TaskInput(
        "task",
        14,
        TaskPriority.MEDIUM,
        sessions[0].allowed_windows,
        sessions,
        4,
        8,
    )
    problem = overload_problem(sessions, 0, minimum_break_minutes=5)

    monkeypatch.setattr(overload_module, "_has_zero_break_capacity", lambda *_args: False)
    monkeypatch.setattr(overload_module, "_credit_options", lambda *_args: ())
    assert overload_module._minimum_break_capacity(task, problem, monotonic() + 10_000.0) == 5

    def empty_candidates(session: SessionDemand, _start: int) -> list[list[int]]:
        return [] if session.session_id == "b" else [[0, 2]]

    monkeypatch.setattr(overload_module, "candidate_start_intervals", empty_candidates)
    assert overload_module._minimum_break_capacity(task, problem, monotonic() + 10_000.0) == 5

    monkeypatch.setattr(overload_module, "candidate_start_intervals", lambda *_args: [[0, 2]])
    monkeypatch.setattr(
        cp_model.CpModel,
        "validate",
        lambda _self: "invalid break model",
    )
    with pytest.raises(overload_module._PolicyPreparationError, match="invalid break model"):
        overload_module._minimum_break_capacity(task, problem, monotonic() + 10_000.0)

    monkeypatch.undo()
    monkeypatch.setattr(overload_module, "_has_zero_break_capacity", lambda *_args: False)
    monkeypatch.setattr(overload_module, "_credit_options", lambda *_args: ())
    monkeypatch.setattr(overload_module, "monotonic", lambda: 20.0)
    with pytest.raises(overload_module._PolicyPreparationError, match="shared solve budget"):
        overload_module._minimum_break_capacity(task, problem, 10.0)

    class FailingSolver:
        def solve(self, _model: object) -> int:
            raise RuntimeError("break solver failed")

    monkeypatch.undo()
    monkeypatch.setattr(overload_module, "_has_zero_break_capacity", lambda *_args: False)
    monkeypatch.setattr(overload_module, "_credit_options", lambda *_args: ())
    monkeypatch.setattr(overload_module, "configured_solver", lambda _seconds: FailingSolver())
    with pytest.raises(overload_module._PolicyPreparationError, match="break solver failed"):
        overload_module._minimum_break_capacity(task, problem, monotonic() + 10_000.0)

    class NonOptimalSolver:
        def solve(self, _model: object) -> int:
            return int(cp_model.FEASIBLE)

        def status_name(self, _status: int) -> str:
            return "FEASIBLE"

    monkeypatch.setattr(overload_module, "configured_solver", lambda _seconds: NonOptimalSolver())
    with pytest.raises(overload_module._PolicyPreparationError, match="not proven"):
        overload_module._minimum_break_capacity(task, problem, monotonic() + 10_000.0)


def test_overload_flow_and_witness_placement_failures(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from studyflow.scheduling import overload as overload_module

    session = demand("s", "task", 1, (0, 10), deadline=10)
    problem = overload_problem((session,), 0)
    allocation = overload_module._UniformAllocation({"task": 1}, {}, (), {"task": 0})
    assert overload_module._uniform_flow_policy_witness(problem, allocation) is None
    witness_day_options: dict[str, tuple[_DayStartOption, ...]] = {
        "s": (_DayStartOption(0, 0, 10),)
    }
    assert not overload_module._uniform_witness_is_policy_optimal(
        problem,
        overload_module._UniformAllocation({"task": 1}, {}, (0,), {"task": 1}),
        {},
        witness_day_options,
    )

    class InfeasibleFlow:
        OPTIMAL = 1

        def add_arc_with_capacity_and_unit_cost(self, *_args: object) -> int:
            return 0

        def set_node_supply(self, *_args: object) -> None:
            return None

        def solve(self) -> int:
            return 0

    monkeypatch.setattr(min_cost_flow, "SimpleMinCostFlow", InfeasibleFlow)
    assert overload_module._uniform_flow_policy_witness(
        problem,
        overload_module._UniformAllocation({"task": 1}, {}, (0,), {"task": 1}),
    ) is None

    sessions = (
        demand("a", "task", 2, (0, 8), deadline=10),
        demand("b", "task", 2, (0, 8), deadline=10),
    )
    placement_problem = overload_problem(sessions, 0)
    placement_tasks = (overload_module._TaskDemand(
        "task", 10, TaskPriority.MEDIUM, sessions[0].allowed_windows, 4, 0, 10
    ),)
    candidates = {"a": [[0, 8]], "b": [[0, 8]]}
    day_options: dict[str, tuple[_DayStartOption, ...]] = {
        "a": (_DayStartOption(0, 0, 8),),
        "b": (_DayStartOption(0, 0, 8),),
    }
    witness = {"a": 0, "b": 1}

    monkeypatch.setattr(cp_model.CpModel, "validate", lambda _self: "bad placement")
    invalid = overload_module._solve_witness_day_placement(
        placement_problem,
        placement_tasks,
        KernelStatus.OVERLOAD,
        set(witness),
        candidates,
        day_options,
        witness,
        monotonic() + 10_000.0,
    )
    assert invalid.diagnostics.solver_status == "MODEL_INVALID"

    monkeypatch.undo()
    monkeypatch.setattr(overload_module, "monotonic", lambda: 20.0)
    timed_out = overload_module._solve_witness_day_placement(
        placement_problem,
        placement_tasks,
        KernelStatus.OVERLOAD,
        set(witness),
        candidates,
        day_options,
        witness,
        10.0,
    )
    assert timed_out.diagnostics.solver_status == "TIME_LIMIT"

    class FailingSolver:
        wall_time = 0.0
        num_conflicts = 0
        num_branches = 0

        def solve(self, _model: object) -> int:
            raise ValueError("placement failed")

    monkeypatch.undo()
    monkeypatch.setattr(overload_module, "configured_solver", lambda _seconds: FailingSolver())
    failed = overload_module._solve_witness_day_placement(
        placement_problem,
        placement_tasks,
        KernelStatus.OVERLOAD,
        set(witness),
        candidates,
        day_options,
        witness,
        monotonic() + 10_000.0,
    )
    assert failed.diagnostics.solver_status == "EXCEPTION"


def test_overload_uniform_spread_placement_failures(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from studyflow.scheduling import overload as overload_module

    sessions = (
        demand("a", "task", 1, (0, 99), deadline=99),
        demand("b", "task", 1, (0, 99), deadline=99),
    )
    planning_days = (PlanningDay(0, 0, 50), PlanningDay(1, 50, 100))
    problem = FeasibilityProblem(sessions, 0, 0, 4.0, planning_days)
    tasks = (overload_module._TaskDemand(
        "task", 99, TaskPriority.MEDIUM, sessions[0].allowed_windows, 2, 0, 99
    ),)
    allocation = overload_module._UniformAllocation({"task": 2}, {}, (0, 50), {"task": 2})
    candidates = {"a": [[0, 99]], "b": [[0, 99]]}
    day_options: dict[str, tuple[_DayStartOption, ...]] = {
        "a": (
            _DayStartOption(0, 0, 49),
            _DayStartOption(1, 50, 99),
        ),
        "b": (
            _DayStartOption(0, 0, 49),
            _DayStartOption(1, 50, 99),
        ),
    }

    monkeypatch.setattr(cp_model.CpModel, "validate", lambda _self: "bad spread")
    invalid = overload_module._solve_uniform_spread_placement(
        problem, tasks, allocation, candidates, day_options, monotonic() + 10_000.0
    )
    assert invalid.diagnostics.solver_status == "MODEL_INVALID"

    monkeypatch.undo()
    monkeypatch.setattr(overload_module, "monotonic", lambda: 20.0)
    timed_out = overload_module._solve_uniform_spread_placement(
        problem, tasks, allocation, candidates, day_options, 10.0
    )
    assert timed_out.diagnostics.solver_status == "TIME_LIMIT"

    class FailingSolver:
        wall_time = 0.0
        num_conflicts = 0
        num_branches = 0

        def solve(self, _model: object) -> int:
            raise RuntimeError("spread failed")

    monkeypatch.undo()
    monkeypatch.setattr(overload_module, "configured_solver", lambda _seconds: FailingSolver())
    failed = overload_module._solve_uniform_spread_placement(
        problem, tasks, allocation, candidates, day_options, monotonic() + 10_000.0
    )
    assert failed.diagnostics.solver_status == "EXCEPTION"

    class Solver:
        wall_time = 0.0
        num_conflicts = 0
        num_branches = 0

        def __init__(self, status: int) -> None:
            self.status = status

        def solve(self, _model: object) -> int:
            return self.status

        def value(self, _expression: object) -> int:
            return 1

        def boolean_value(self, _variable: object) -> bool:
            return True

    monkeypatch.undo()
    monkeypatch.setattr(overload_module, "_SAFE_OBJECTIVE_MAX", 0)
    monkeypatch.setattr(
        overload_module,
        "configured_solver",
        lambda _seconds: Solver(int(cp_model.OPTIMAL)),
    )
    monkeypatch.setattr(
        cp_model.CpModel,
        "validate",
        iter(("", "bad assignment")).__next__,
    )
    second_invalid = overload_module._solve_uniform_spread_placement(
        problem, tasks, allocation, candidates, day_options, monotonic() + 10_000.0
    )
    assert second_invalid.diagnostics.solver_status == "MODEL_INVALID"

    monkeypatch.undo()
    monkeypatch.setattr(overload_module, "_SAFE_OBJECTIVE_MAX", 0)
    monkeypatch.setattr(
        overload_module,
        "configured_solver",
        lambda _seconds: Solver(int(cp_model.OPTIMAL)),
    )
    clock = iter((0.0, 20.0))
    monkeypatch.setattr(overload_module, "monotonic", lambda: next(clock))
    second_timeout = overload_module._solve_uniform_spread_placement(
        problem, tasks, allocation, candidates, day_options, 10.0
    )
    assert second_timeout.diagnostics.solver_status == "TIME_LIMIT"

    class TwoStageExceptionSolver(Solver):
        calls = 0

        def solve(self, _model: object) -> int:
            self.calls += 1
            if self.calls == 1:
                return int(cp_model.OPTIMAL)
            raise ValueError("assignment failed")

    monkeypatch.undo()
    monkeypatch.setattr(overload_module, "_SAFE_OBJECTIVE_MAX", 0)
    exception_solver = TwoStageExceptionSolver(0)
    monkeypatch.setattr(overload_module, "configured_solver", lambda _seconds: exception_solver)
    second_failed = overload_module._solve_uniform_spread_placement(
        problem, tasks, allocation, candidates, day_options, monotonic() + 10_000.0
    )
    assert second_failed.diagnostics.solver_status == "EXCEPTION"

    class TwoStageNonOptimalSolver(TwoStageExceptionSolver):
        def solve(self, _model: object) -> int:
            self.calls += 1
            return int(cp_model.OPTIMAL if self.calls == 1 else cp_model.FEASIBLE)

    monkeypatch.undo()
    monkeypatch.setattr(overload_module, "_SAFE_OBJECTIVE_MAX", 0)
    nonoptimal_solver = TwoStageNonOptimalSolver(0)
    monkeypatch.setattr(overload_module, "configured_solver", lambda _seconds: nonoptimal_solver)
    monkeypatch.setattr(
        overload_module,
        "solver_diagnostics",
        lambda _solver, _status: SolverDiagnostics("FEASIBLE", 0.0, 0, 0),
    )
    second_nonoptimal = overload_module._solve_uniform_spread_placement(
        problem, tasks, allocation, candidates, day_options, monotonic() + 10_000.0
    )
    assert second_nonoptimal.diagnostics.solver_status == "FEASIBLE"


def test_overload_main_policy_uses_packed_greedy_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from studyflow.scheduling import overload as overload_module

    problem = overload_problem(
        (demand("a", "a", 2, (0, 10)), demand("b", "b", 1, (0, 10))), 0
    )

    def greedy_hint(*_args: object, spread_across_days: bool) -> dict[str, int]:
        return {"a": 0} if spread_across_days else {"a": 0, "b": 2}

    monkeypatch.setattr(overload_module, "_greedy_policy_hint", greedy_hint)
    monkeypatch.setattr(overload_module, "_uniform_allocation", lambda *_args: None)

    result = solve_with_overload(problem)

    assert result.status is KernelStatus.FEASIBLE
    assert {item.session_id for item in result.sessions} == {"a", "b"}


def test_overload_main_policy_reports_invalid_capacity_cut_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from studyflow.scheduling import overload as overload_module

    problem = overload_problem(
        (demand("a", "a", 2, (0, 10)), demand("b", "b", 1, (0, 10))), 0
    )
    monkeypatch.setattr(overload_module, "_greedy_policy_hint", lambda *_args, **_kwargs: {})
    monkeypatch.setattr(overload_module, "_uniform_allocation", lambda *_args: None)
    validations = iter(("", "invalid capacity cuts"))
    monkeypatch.setattr(
        cp_model.CpModel,
        "validate",
        lambda _self: next(validations),
    )

    result = solve_with_overload(problem)

    assert result.diagnostics.solver_status == "MODEL_INVALID"
    assert result.detail == "invalid capacity cuts"


def test_overload_main_policy_probe_and_allocation_completion(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from studyflow.scheduling import overload as overload_module

    problem = overload_problem(
        (demand("a", "a", 2, (0, 10)), demand("b", "b", 1, (0, 10))), 0
    )
    monkeypatch.setattr(overload_module, "_greedy_policy_hint", lambda *_args, **_kwargs: {})
    monkeypatch.setattr(overload_module, "_uniform_allocation", lambda *_args: None)
    monkeypatch.setattr(overload_module, "_replace_solution_hints", lambda *_args: None)

    class Solver:
        wall_time = 0.0
        num_conflicts = 0
        num_branches = 0

        def __init__(self, statuses: list[int]) -> None:
            self.statuses = statuses

        def solve(self, _model: object) -> int:
            return self.statuses.pop(0)

        def boolean_value(self, _variable: object) -> bool:
            return True

        def value(self, _expression: object) -> int:
            return 0

        def status_name(self, _status: int) -> str:
            return "OPTIMAL"

    solver = Solver([int(cp_model.OPTIMAL), int(cp_model.OPTIMAL)])
    monkeypatch.setattr(overload_module, "configured_solver", lambda _seconds: solver)
    result = solve_with_overload(problem)

    assert result.status is KernelStatus.FEASIBLE
    assert len(result.sessions) == 2


def test_overload_main_policy_allocation_budget_can_expire(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from studyflow.scheduling import overload as overload_module

    problem = overload_problem(
        (
            demand("fits", "fits", 2, (0, 10)),
            demand("impossible", "impossible", 20, (0, 10)),
        ),
        0,
        max_solve_seconds=1.0,
    )
    monkeypatch.setattr(overload_module, "_greedy_policy_hint", lambda *_args, **_kwargs: {})
    monkeypatch.setattr(overload_module, "_uniform_allocation", lambda *_args: None)
    clock = iter((0.0, 2.0))
    monkeypatch.setattr(overload_module, "monotonic", lambda: next(clock))

    result = solve_with_overload(problem)

    assert result.diagnostics.solver_status == "TIME_LIMIT"
    assert "exhausted its shared solve budget" in str(result.detail)


def test_overload_main_policy_placement_validation_and_day_spread_branches(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from studyflow.scheduling import overload as overload_module

    sessions = (
        demand("a1", "a", 1, (0, 10)),
        demand("a2", "a", 1, (0, 10)),
        demand("b", "b", 1, (0, 10)),
    )
    planning_days = (PlanningDay(0, 0, 5), PlanningDay(1, 5, 10))
    problem = FeasibilityProblem(sessions, 0, 0, 4.0, planning_days)
    monkeypatch.setattr(overload_module, "_uniform_allocation", lambda *_args: None)
    monkeypatch.setattr(
        overload_module,
        "_greedy_policy_hint",
        lambda *_args, **_kwargs: {"a1": 0, "a2": 5, "b": 1},
    )
    validations = iter(("", "invalid placement model"))
    monkeypatch.setattr(
        cp_model.CpModel,
        "validate",
        lambda _self: next(validations),
    )

    result = solve_with_overload(problem)

    assert result.diagnostics.solver_status == "MODEL_INVALID"
    assert result.detail == "invalid placement model"


def test_overload_uniform_spread_skips_an_empty_synthetic_day_count(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import builtins

    from studyflow.scheduling import overload as overload_module

    sessions = (
        demand("a", "task", 1, (0, 99), deadline=99),
        demand("b", "task", 1, (0, 99), deadline=99),
    )
    problem = FeasibilityProblem(
        sessions,
        0,
        0,
        4.0,
        (PlanningDay(0, 0, 50), PlanningDay(1, 50, 100)),
    )
    tasks = (overload_module._TaskDemand(
        "task", 99, TaskPriority.MEDIUM, sessions[0].allowed_windows, 2, 0, 99
    ),)
    allocation = overload_module._UniformAllocation({"task": 2}, {}, (0, 50), {"task": 2})
    candidates = {"a": [[0, 99]], "b": [[0, 99]]}
    day_options: dict[str, tuple[_DayStartOption, ...]] = {
        "a": (
            _DayStartOption(0, 0, 49),
            _DayStartOption(1, 50, 99),
        ),
        "b": (
            _DayStartOption(0, 0, 49),
            _DayStartOption(1, 50, 99),
        ),
    }
    original_range = builtins.range

    def range_with_empty_extra_day(*args: int) -> range | tuple[int, ...]:
        result = original_range(*args)
        if args == (2, 3):
            return (*result, 3)
        return result

    monkeypatch.setattr(overload_module, "range", range_with_empty_extra_day, raising=False)
    monkeypatch.setattr(cp_model.CpModel, "validate", lambda _self: "synthetic day")

    result = overload_module._solve_uniform_spread_placement(
        problem, tasks, allocation, candidates, day_options, monotonic() + 10_000.0
    )

    assert result.diagnostics.solver_status == "MODEL_INVALID"


def test_overload_main_policy_handles_missing_spread_witness_and_empty_day_count(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import builtins

    from studyflow.scheduling import overload as overload_module

    sessions = (
        demand("a", "task", 1, (0, 10)),
        demand("b", "task", 1, (0, 10)),
    )
    problem = FeasibilityProblem(
        sessions,
        0,
        0,
        4.0,
        (PlanningDay(0, 0, 5), PlanningDay(1, 5, 10)),
    )
    monkeypatch.setattr(overload_module, "_uniform_allocation", lambda *_args: None)
    monkeypatch.setattr(overload_module, "_greedy_policy_hint", lambda *_args, **_kwargs: {})
    monkeypatch.setattr(overload_module, "_replace_solution_hints", lambda *_args: None)

    class Solver:
        wall_time = 0.0
        num_conflicts = 0
        num_branches = 0
        objective_value = 0.0

        def __init__(self) -> None:
            self.statuses = [
                int(cp_model.INFEASIBLE),
                int(cp_model.OPTIMAL),
                int(cp_model.OPTIMAL),
                int(cp_model.OPTIMAL),
            ]

        def solve(self, _model: object) -> int:
            return self.statuses.pop(0)

        def boolean_value(self, _variable: object) -> bool:
            return True

        def value(self, _expression: object) -> int:
            return 0

        def status_name(self, _status: int) -> str:
            return "OPTIMAL"

    solver = Solver()
    monkeypatch.setattr(overload_module, "configured_solver", lambda _seconds: solver)
    original_range = builtins.range

    def range_with_empty_extra_day(*args: int) -> range | tuple[int, ...]:
        result = original_range(*args)
        if args == (2, 3):
            return (*result, 3)
        return result

    monkeypatch.setattr(overload_module, "range", range_with_empty_extra_day, raising=False)
    result = solve_with_overload(problem)

    assert result.status is KernelStatus.FEASIBLE


def test_overload_main_policy_preserves_a_valid_session_when_another_has_no_domain(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from studyflow.scheduling import overload as overload_module

    valid = demand("valid", "valid", 1, (0, 10))
    invalid = demand("invalid", "invalid", 20, (0, 10))

    class LyingSessions(tuple[SessionDemand, ...]):
        def __len__(self) -> int:
            return 1

    problem = FeasibilityProblem(
        LyingSessions((valid, invalid)),
        0,
        0,
        4.0,
        DEFAULT_PLANNING_DAYS,
    )
    monkeypatch.setattr(overload_module, "_uniform_allocation", lambda *_args: None)
    monkeypatch.setattr(overload_module, "_greedy_policy_hint", lambda *_args, **_kwargs: {})
    monkeypatch.setattr(overload_module, "_replace_solution_hints", lambda *_args: None)

    class Solver:
        wall_time = 0.0
        num_conflicts = 0
        num_branches = 0

        def solve(self, _model: object) -> int:
            return int(cp_model.OPTIMAL)

        def boolean_value(self, _variable: object) -> bool:
            return True

        def value(self, _expression: object) -> int:
            return 0

        def status_name(self, _status: int) -> str:
            return "OPTIMAL"

    monkeypatch.setattr(overload_module, "configured_solver", lambda _seconds: Solver())
    result = solve_with_overload(problem)

    assert result.status is KernelStatus.FEASIBLE
    assert [item.session_id for item in result.sessions] == ["valid"]
