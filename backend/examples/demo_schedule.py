"""Demonstrate the scheduling engine on a tiny overloaded problem and on the NFR-02 workload.

Run from ``backend/``:  uv run python examples/demo_schedule.py
"""

from statistics import median
from time import perf_counter

from studyflow.scheduling import (
    FeasibilityProblem,
    MinuteWindow,
    PlanningDay,
    SessionDemand,
    TaskPriority,
    solve_with_overload,
)
from studyflow.scheduling._performance import (
    PerformanceScenario,
    representative_performance_problem,
)

DAY = 1_440
EVENING_START = 18 * 60
EVENING_END = 21 * 60
BENCHMARK_RUNS = 5


def clock(minute: int) -> str:
    day, in_day = divmod(minute, DAY)
    return f"day {day + 1} {in_day // 60:02d}:{in_day % 60:02d}"


def tiny_problem() -> tuple[FeasibilityProblem, dict[str, str]]:
    windows = tuple(
        MinuteWindow(day * DAY + EVENING_START, day * DAY + EVENING_END) for day in range(3)
    )
    # (task_id, label, session minutes, deadline day index, priority)
    tasks = (
        ("essay", "Essay draft", (60, 60), 2, TaskPriority.MEDIUM),
        ("pset", "Problem set", (50, 50, 50), 1, TaskPriority.HIGH),
        ("exam", "Exam review", (60, 60, 60, 60), 2, TaskPriority.MEDIUM),
    )
    sessions = tuple(
        SessionDemand(
            session_id=f"{task_id}-{index}",
            task_id=task_id,
            duration_minutes=minutes,
            deadline_minute=deadline_day * DAY + EVENING_END,
            allowed_windows=windows,
            priority=priority,
        )
        for task_id, _, durations, deadline_day, priority in tasks
        for index, minutes in enumerate(durations)
    )
    problem = FeasibilityProblem(
        sessions,
        planning_start_minute=0,
        minimum_break_minutes=10,
        max_solve_seconds=4.0,
        planning_days=tuple(PlanningDay(day, day * DAY, (day + 1) * DAY) for day in range(3)),
    )
    return problem, {task_id: label for task_id, label, *_ in tasks}


def run_tiny_example() -> None:
    problem, labels = tiny_problem()
    result = solve_with_overload(problem)
    print("== Worked example: 3 tasks, 3 evenings (18:00-21:00), 10 min break ==")
    print(f"status: {result.status.value}   solver: {result.diagnostics.solver_status}")
    print("schedule:")
    for session in result.sessions:
        print(
            f"  {clock(session.start_minute)} - {clock(session.end_minute)[-5:]}"
            f"  {labels[session.task_id]} ({session.end_minute - session.start_minute} min)"
        )
    print("allocation (minutes):")
    for item in result.allocations:
        print(
            f"  {labels[item.task_id]:<12} required {item.required_minutes:>3}"
            f"  scheduled {item.scheduled_minutes:>3}"
            f"  unscheduled {item.unscheduled_minutes:>3}"
            f"  deadline {clock(item.deadline_minute)}"
        )


def run_benchmark() -> None:
    print(f"\n== NFR-02 workload, {BENCHMARK_RUNS} runs each ==")
    for scenario in PerformanceScenario:
        problem = representative_performance_problem(scenario)
        timings: list[float] = []
        results = []
        for _ in range(BENCHMARK_RUNS):
            started = perf_counter()
            results.append(solve_with_overload(problem))
            timings.append(perf_counter() - started)
        result = results[-1]
        unscheduled = sum(item.unscheduled_minutes for item in result.allocations)
        print(
            f"{scenario.value:<10} status={result.status.value:<8}"
            f" solver={result.diagnostics.solver_status}"
            f" placed={len(result.sessions)}/{len(problem.sessions)}"
            f" unscheduled_min={unscheduled}"
            f" median={median(timings):.3f}s max={max(timings):.3f}s"
        )


if __name__ == "__main__":
    run_tiny_example()
    run_benchmark()
