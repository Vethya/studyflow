from itertools import pairwise
from time import perf_counter

import pytest

from studyflow.scheduling import KernelStatus, solve_with_overload
from studyflow.scheduling._performance import (
    PerformanceScenario,
    representative_performance_problem,
)


@pytest.mark.parametrize(
    ("scenario", "expected_status", "expected_session_count"),
    [
        (PerformanceScenario.FEASIBLE, KernelStatus.FEASIBLE, 250),
        (PerformanceScenario.OVERLOADED, KernelStatus.OVERLOAD, 160),
    ],
)
def test_spec_sized_schedule_completes_within_five_seconds(
    scenario: PerformanceScenario,
    expected_status: KernelStatus,
    expected_session_count: int,
) -> None:
    problem = representative_performance_problem(scenario)

    started = perf_counter()
    result = solve_with_overload(problem)
    elapsed_seconds = perf_counter() - started

    assert elapsed_seconds < 5
    assert result.status is expected_status
    assert result.diagnostics.solver_status == "OPTIMAL"
    assert len(result.sessions) == expected_session_count
    assert all(
        following.start_minute >= previous.end_minute + problem.minimum_break_minutes
        for previous, following in pairwise(result.sessions)
    )
    if scenario is PerformanceScenario.OVERLOADED:
        assert sum(item.unscheduled_minutes for item in result.allocations) == 5_400


def test_spec_sized_uniform_overload_uses_constructive_spread(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def reject_large_spread_model(*args: object, **kwargs: object) -> None:
        raise AssertionError("the uniform performance case must not use the large spread model")

    monkeypatch.setattr(
        "studyflow.scheduling.overload._solve_uniform_spread_placement",
        reject_large_spread_model,
    )

    result = solve_with_overload(representative_performance_problem(PerformanceScenario.OVERLOADED))

    assert result.status is KernelStatus.OVERLOAD
    assert result.diagnostics.solver_status == "OPTIMAL"
    assert len(result.sessions) == 160
    assert sum(item.unscheduled_minutes for item in result.allocations) == 5_400
