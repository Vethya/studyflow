from __future__ import annotations

from typing import Any, cast

import pytest

from studyflow.scheduling import (
    FeasibilityProblem,
    KernelStatus,
    MinuteWindow,
    PlanningDay,
    SessionDemand,
    solve_with_overload,
)


def demand(
    session_id: str,
    task_id: str,
    duration: int,
    *windows: tuple[int, int],
    deadline: int = 1_000,
) -> SessionDemand:
    return SessionDemand(
        session_id,
        task_id,
        duration,
        deadline,
        tuple(MinuteWindow(start, end) for start, end in windows),
    )


def test_prefers_the_earliest_exact_minute() -> None:
    result = solve_with_overload(
        FeasibilityProblem(
            (demand("session", "task", 2, (0, 10), deadline=10),),
            planning_start_minute=0,
        )
    )

    assert result.status is KernelStatus.FEASIBLE
    assert result.sessions[0].start_minute == 0
    assert result.sessions[0].end_minute == 2


def test_spreads_a_long_task_across_local_days_before_optimizing_earliness() -> None:
    problem = FeasibilityProblem(
        (
            demand("a", "task", 2, (0, 6), (10, 16), deadline=16),
            demand("b", "task", 2, (0, 6), (10, 16), deadline=16),
        ),
        planning_start_minute=0,
        planning_days=(
            PlanningDay(0, 0, 10),
            PlanningDay(1, 10, 20),
        ),
    )

    result = solve_with_overload(problem)

    assert result.status is KernelStatus.FEASIBLE
    assert [session.start_minute for session in result.sessions] == [0, 10]


def test_earliness_is_deterministic_within_the_maximum_spread() -> None:
    problem = FeasibilityProblem(
        (
            demand("a", "task", 2, (0, 8), (10, 18), deadline=18),
            demand("b", "task", 2, (0, 8), (10, 18), deadline=18),
            demand("c", "task", 2, (0, 8), (10, 18), deadline=18),
        ),
        planning_start_minute=0,
        planning_days=(
            PlanningDay(0, 0, 10),
            PlanningDay(1, 10, 20),
        ),
    )

    schedules = [solve_with_overload(problem).sessions for _ in range(3)]

    assert schedules[0] == schedules[1] == schedules[2]
    assert {session.start_minute // 10 for session in schedules[0]} == {0, 1}


def test_day_metadata_does_not_forbid_a_session_crossing_local_midnight() -> None:
    result = solve_with_overload(
        FeasibilityProblem(
            (demand("session", "task", 4, (8, 13), deadline=13),),
            planning_start_minute=0,
            planning_days=(
                PlanningDay(0, 0, 10),
                PlanningDay(1, 10, 20),
            ),
        )
    )

    assert result.status is KernelStatus.FEASIBLE
    assert result.sessions[0].start_minute == 8
    assert result.sessions[0].end_minute == 12


def test_accepts_variable_length_local_days_for_dst_boundaries() -> None:
    problem = FeasibilityProblem(
        (
            demand("a", "task", 2, (0, 6), (1_380, 1_386), deadline=1_386),
            demand("b", "task", 2, (0, 6), (1_380, 1_386), deadline=1_386),
        ),
        planning_start_minute=0,
        planning_days=(
            PlanningDay(0, 0, 1_380),
            PlanningDay(1, 1_380, 2_880),
        ),
    )

    result = solve_with_overload(problem)

    assert result.status is KernelStatus.FEASIBLE
    assert [session.start_minute for session in result.sessions] == [0, 1_380]


def test_spreads_the_proven_feasible_portion_without_hiding_overload() -> None:
    problem = FeasibilityProblem(
        (
            demand("a", "task", 2, (0, 2), (10, 12), deadline=12),
            demand("b", "task", 2, (0, 2), (10, 12), deadline=12),
            demand("c", "task", 2, (0, 2), (10, 12), deadline=12),
        ),
        planning_start_minute=0,
        planning_days=(
            PlanningDay(0, 0, 10),
            PlanningDay(1, 10, 20),
        ),
    )

    result = solve_with_overload(problem)

    assert result.status is KernelStatus.OVERLOAD
    assert [session.start_minute for session in result.sessions] == [0, 10]
    assert result.allocations[0].scheduled_minutes == 4
    assert result.allocations[0].unscheduled_minutes == 2


def test_rejects_an_incomplete_day_domain_instead_of_silently_losing_starts() -> None:
    result = solve_with_overload(
        FeasibilityProblem(
            (demand("session", "task", 2, (0, 10), deadline=10),),
            planning_start_minute=0,
            planning_days=(PlanningDay(0, 0, 5),),
        )
    )

    assert result.status is KernelStatus.TECHNICAL_FAILURE
    assert result.sessions == ()
    assert result.diagnostics.solver_status == "DAY_DOMAIN_INCOMPLETE"
    assert result.detail == "Planning days do not cover every start for session 'session'"


@pytest.mark.parametrize(
    ("factory", "message"),
    [
        (lambda: PlanningDay(-1, 0, 10), "index"),
        (lambda: PlanningDay(0, 10, 10), "end"),
        (lambda: PlanningDay(cast(Any, 0.5), 0, 10), "integer"),
        (
            lambda: FeasibilityProblem(
                (),
                planning_start_minute=0,
                planning_days=(PlanningDay(0, 0, 10), PlanningDay(0, 10, 20)),
            ),
            "unique",
        ),
        (
            lambda: FeasibilityProblem(
                (),
                planning_start_minute=0,
                planning_days=(PlanningDay(0, 0, 11), PlanningDay(1, 10, 20)),
            ),
            "overlap",
        ),
    ],
)
def test_rejects_invalid_planning_days(factory: object, message: str) -> None:
    with pytest.raises((TypeError, ValueError), match=message):
        assert callable(factory)
        factory()
