from __future__ import annotations

from itertools import pairwise, product
from random import Random

import pytest

from studyflow.scheduling import (
    FeasibilityProblem,
    KernelStatus,
    MinuteWindow,
    SessionDemand,
    solve_feasibility,
)


def demand(
    session_id: str,
    duration: int,
    *windows: tuple[int, int],
    deadline: int = 1_000,
    task_id: str = "task",
) -> SessionDemand:
    return SessionDemand(
        session_id,
        task_id,
        duration,
        deadline,
        tuple(MinuteWindow(start, end) for start, end in windows),
    )


def assert_valid(problem: FeasibilityProblem) -> None:
    result = solve_feasibility(problem)
    assert result.status is KernelStatus.FEASIBLE
    assert len(result.sessions) == len(problem.sessions)

    by_id = {item.session_id: item for item in problem.sessions}
    for scheduled in result.sessions:
        requested = by_id[scheduled.session_id]
        assert scheduled.end_minute - scheduled.start_minute == requested.duration_minutes
        assert scheduled.end_minute <= requested.deadline_minute
        assert any(
            window.start <= scheduled.start_minute and scheduled.end_minute <= window.end
            for window in requested.allowed_windows
        )

    for previous, following in zip(result.sessions, result.sessions[1:], strict=False):
        assert following.start_minute >= previous.end_minute + problem.minimum_break_minutes


def brute_force_feasible(problem: FeasibilityProblem) -> bool:
    starts_by_session: list[list[int]] = []
    for session in problem.sessions:
        starts: list[int] = []
        for window in session.allowed_windows:
            latest = min(window.end, session.deadline_minute) - session.duration_minutes
            starts.extend(range(window.start, latest + 1))
        if not starts:
            return False
        starts_by_session.append(sorted(set(starts)))

    for chosen_starts in product(*starts_by_session):
        placed = sorted(
            (
                start,
                start + session.duration_minutes,
            )
            for start, session in zip(chosen_starts, problem.sessions, strict=True)
        )
        if all(
            following_start >= previous_end + problem.minimum_break_minutes
            for (_, previous_end), (following_start, _) in pairwise(placed)
        ):
            return True
    return False


def test_empty_problem_is_feasible() -> None:
    result = solve_feasibility(FeasibilityProblem(()))

    assert result.status is KernelStatus.FEASIBLE
    assert result.sessions == ()
    assert result.diagnostics.solver_status == "EMPTY"


def test_places_sessions_at_exact_minutes_without_a_grid() -> None:
    problem = FeasibilityProblem((demand("only", 7, (2, 9)),))

    result = solve_feasibility(problem)

    assert result.status is KernelStatus.FEASIBLE
    assert result.sessions[0].start_minute == 2
    assert result.sessions[0].end_minute == 9


def test_enforces_deadlines_and_does_not_straddle_windows() -> None:
    problem = FeasibilityProblem((demand("capped", 4, (0, 10), deadline=7),))

    result = solve_feasibility(problem)

    assert result.status is KernelStatus.FEASIBLE
    assert result.sessions[0].end_minute <= 7


def test_enforces_minimum_break_between_every_session() -> None:
    problem = FeasibilityProblem(
        (demand("a", 2, (0, 6)), demand("b", 2, (0, 6))),
        minimum_break_minutes=2,
    )

    assert_valid(problem)


def test_reports_infeasible_when_a_session_has_no_candidate_start() -> None:
    result = solve_feasibility(FeasibilityProblem((demand("too-long", 11, (0, 10)),)))

    assert result.status is KernelStatus.INFEASIBLE
    assert result.diagnostics.solver_status == "EMPTY_DOMAIN"


def test_reports_infeasible_when_sessions_cannot_all_fit() -> None:
    result = solve_feasibility(FeasibilityProblem((demand("a", 4, (0, 6)), demand("b", 4, (0, 6)))))

    assert result.status is KernelStatus.INFEASIBLE
    assert result.diagnostics.solver_status == "INFEASIBLE"


@pytest.mark.parametrize(
    ("factory", "message"),
    [
        (lambda: MinuteWindow(2, 2), "minute window"),
        (lambda: demand("", 1, (0, 2)), "session_id"),
        (lambda: demand("session", 0, (0, 2)), "duration_minutes"),
        (lambda: FeasibilityProblem((), minimum_break_minutes=-1), "minimum_break"),
        (lambda: FeasibilityProblem((), max_solve_seconds=6), "max_solve_seconds"),
        (
            lambda: FeasibilityProblem((demand("same", 1, (0, 2)), demand("same", 1, (2, 4)))),
            "unique",
        ),
    ],
)
def test_rejects_invalid_inputs(factory: object, message: str) -> None:
    with pytest.raises(ValueError, match=message):
        assert callable(factory)
        factory()


def test_cp_sat_matches_an_independent_brute_force_oracle() -> None:
    random = Random(20260809)  # noqa: S311 - deterministic test-case generation

    for case in range(80):
        session_count = random.randint(1, 4)
        horizon = random.randint(4, 10)
        sessions = tuple(
            demand(
                f"{case}-{index}",
                random.randint(1, 4),
                (random.randint(0, 2), horizon),
                deadline=random.randint(3, horizon),
            )
            for index in range(session_count)
        )
        problem = FeasibilityProblem(
            sessions,
            minimum_break_minutes=random.randint(0, 2),
        )

        expected = brute_force_feasible(problem)
        actual = solve_feasibility(problem)

        assert (actual.status is KernelStatus.FEASIBLE) is expected, case
        if expected:
            assert_valid(problem)
