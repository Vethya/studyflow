from collections import defaultdict
from random import Random

import pytest

from studyflow.scheduling import (
    FeasibilityProblem,
    KernelStatus,
    MinuteWindow,
    PlanningDay,
    ScheduledSession,
    SessionDemand,
    TaskPriority,
    solve_with_overload,
)


def _policy_score(
    problem: FeasibilityProblem,
    sessions: tuple[ScheduledSession, ...],
) -> tuple[int, int]:
    days_by_task: dict[str, set[int]] = defaultdict(set)
    scheduled_counts: dict[str, int] = defaultdict(int)
    deadline_by_task: dict[str, int] = {}
    for demand in problem.sessions:
        deadline_by_task[demand.task_id] = demand.deadline_minute
    for session in sessions:
        scheduled_counts[session.task_id] += 1
        days_by_task[session.task_id].add(session.start_minute // 10)

    maximum_candidate_days = max(
        min(scheduled_count, deadline_by_task[task_id] // 10)
        for task_id, scheduled_count in scheduled_counts.items()
    )
    extra_day_weights = {
        depth: maximum_candidate_days - depth + 1 for depth in range(3, maximum_candidate_days + 1)
    }
    maximum_extra_score = sum(
        sum(
            scheduled_count >= depth and deadline_by_task[task_id] // 10 >= depth
            for task_id, scheduled_count in scheduled_counts.items()
        )
        * weight
        for depth, weight in extra_day_weights.items()
    )
    second_day_weight = maximum_extra_score + 1
    spread_score = sum(
        second_day_weight if depth == 2 else extra_day_weights[depth]
        for task_id, days in days_by_task.items()
        for depth in range(2, len(days) + 1)
        if scheduled_counts[task_id] >= depth
    )
    return spread_score, sum(session.start_minute for session in sessions)


def test_uniform_flow_matches_cp_sat_policy(monkeypatch: pytest.MonkeyPatch) -> None:
    random = Random(20260823)  # noqa: S311 - deterministic generated cases
    for case_index in range(80):
        day_count = random.randint(3, 7)
        windows = tuple(
            MinuteWindow(day * 10, day * 10 + random.randint(2, 6)) for day in range(day_count)
        )
        sessions: list[SessionDemand] = []
        for task_index in range(random.randint(2, 6)):
            deadline = random.randint(1, day_count) * 10
            for session_index in range(random.randint(1, 5)):
                sessions.append(
                    SessionDemand(
                        f"task-{task_index}-session-{session_index}",
                        f"task-{task_index}",
                        1,
                        deadline,
                        windows,
                        tuple(TaskPriority)[task_index % 3],
                    )
                )
        problem = FeasibilityProblem(
            tuple(sessions),
            planning_start_minute=0,
            minimum_break_minutes=random.randint(0, 1),
            planning_days=tuple(
                PlanningDay(day, day * 10, (day + 1) * 10) for day in range(day_count)
            ),
        )

        with monkeypatch.context() as flow_patch:
            flow_patch.setattr(
                "studyflow.scheduling.overload._uniform_witness_is_policy_optimal",
                lambda *args, **kwargs: False,
            )
            flow_result = solve_with_overload(problem)
        with monkeypatch.context() as cp_sat_patch:
            cp_sat_patch.setattr(
                "studyflow.scheduling.overload._uniform_witness_is_policy_optimal",
                lambda *args, **kwargs: False,
            )
            cp_sat_patch.setattr(
                "studyflow.scheduling.overload._uniform_flow_policy_witness",
                lambda *args, **kwargs: None,
            )
            cp_sat_result = solve_with_overload(problem)

        assert flow_result.status is not KernelStatus.TECHNICAL_FAILURE, case_index
        assert cp_sat_result.status is not KernelStatus.TECHNICAL_FAILURE, case_index
        assert flow_result.status is cp_sat_result.status, case_index
        assert flow_result.allocations == cp_sat_result.allocations, case_index
        assert _policy_score(problem, flow_result.sessions) == _policy_score(
            problem,
            cp_sat_result.sessions,
        ), case_index
