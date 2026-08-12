"""Documented representative inputs for the scheduler performance gate."""

from enum import StrEnum

from studyflow.scheduling.contracts import (
    FeasibilityProblem,
    MinuteWindow,
    PlanningDay,
    SessionDemand,
    TaskPriority,
)


class PerformanceScenario(StrEnum):
    FEASIBLE = "feasible"
    OVERLOADED = "overloaded"


def representative_performance_problem(
    scenario: PerformanceScenario,
) -> FeasibilityProblem:
    """Build the SPEC NFR-02 workload with exactly 50 unavailable gaps."""

    planning_days = tuple(
        PlanningDay(day_index, day_index * 1_440, (day_index + 1) * 1_440)
        for day_index in range(112)
    )
    if scenario is PerformanceScenario.FEASIBLE:
        available_minutes = 480
        unavailable_offset = 120
    else:
        available_minutes = 180
        unavailable_offset = 75

    windows: list[MinuteWindow] = []
    unavailable_periods = 0
    for day_index in range(112):
        if day_index % 7 >= 5:
            continue
        start = day_index * 1_440 + 540
        end = start + available_minutes
        if unavailable_periods < 50:
            unavailable_start = start + unavailable_offset
            unavailable_end = unavailable_start + 30
            windows.extend(
                (
                    MinuteWindow(start, unavailable_start),
                    MinuteWindow(unavailable_end, end),
                )
            )
            unavailable_periods += 1
        else:
            windows.append(MinuteWindow(start, end))

    allowed_windows = tuple(windows)
    priorities = tuple(TaskPriority)
    sessions = tuple(
        SessionDemand(
            session_id=f"task-{task_index:02d}-session-{session_index}",
            task_id=f"task-{task_index:02d}",
            duration_minutes=60,
            deadline_minute=(7 + task_index * 104 // 49) * 1_440,
            allowed_windows=allowed_windows,
            priority=priorities[task_index % len(priorities)],
        )
        for task_index in range(50)
        for session_index in range(5)
    )
    return FeasibilityProblem(
        sessions,
        planning_start_minute=0,
        minimum_break_minutes=10,
        max_solve_seconds=4.0,
        planning_days=planning_days,
    )
