from __future__ import annotations

from itertools import pairwise
from typing import Any, cast

import pytest
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


def test_overload_break_credit_and_zero_break_capacity_branches() -> None:
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
