"""Solve-time benchmark on synthetic instances for the technical note.

Run from ``backend/``::

    uv run python benchmarks/technical_note.py --seeds 10 --csv /tmp/bench.csv

Each instance is generated from ``random.Random(seed)``. The solver itself is
deterministic (one worker, fixed seed), so variation between runs comes from the
instances, not from the solver.
"""

import csv
import platform
import random
import subprocess
import sys
from argparse import ArgumentParser
from collections import Counter, defaultdict
from dataclasses import dataclass
from statistics import median
from time import perf_counter

import ortools

from studyflow.scheduling import overload
from studyflow.scheduling.contracts import (
    FeasibilityProblem,
    MinuteWindow,
    PlanningDay,
    SessionDemand,
    TaskPriority,
)
from studyflow.scheduling.splitting import split_task_sessions

HORIZON_DAYS = 14
BREAK_MINUTES = 10
SESSION_LENGTHS = (30, 45, 60, 90)
LOADS = {"light": 0.6, "heavy": 1.3}


@dataclass(frozen=True, slots=True)
class Instance:
    variant: str
    tasks: int
    load: str
    seed: int
    problem: FeasibilityProblem
    capacity_minutes: int


def _windows(rng: random.Random) -> tuple[MinuteWindow, ...]:
    """Weekday evenings 18-22, weekends 10-18, about 30% of days with a 60-min block."""

    windows: list[MinuteWindow] = []
    for day in range(HORIZON_DAYS):
        open_hour, close_hour = (18, 22) if day % 7 < 5 else (10, 18)
        start, end = day * 1_440 + open_hour * 60, day * 1_440 + close_hour * 60
        if rng.random() < 0.3:
            block = start + rng.randrange(0, end - start - 60, 15)
            windows += [w for w in ((start, block), (block + 60, end)) if w[1] > w[0]]
        else:
            windows.append((start, end))
    return tuple(MinuteWindow(first, last) for first, last in windows)


def build_instance(variant: str, tasks: int, load: str, seed: int) -> Instance:
    rng = random.Random(f"{variant}-{tasks}-{load}-{seed}")
    windows = _windows(rng)
    capacity = sum(window.end - window.start for window in windows)
    weights = [rng.uniform(60, 360) for _ in range(tasks)]
    scale = LOADS[load] * capacity / sum(weights)
    sessions: list[SessionDemand] = []
    for index, weight in enumerate(weights):
        task_id = f"task-{index:03d}"
        length = 60 if variant == "uniform" else rng.choice(SESSION_LENGTHS)
        minutes = max(10, round(weight * scale))
        if variant == "uniform":
            minutes = max(60, round(minutes / 60) * 60)
        deadline = rng.randint(2, HORIZON_DAYS) * 1_440
        priority = rng.choice(tuple(TaskPriority))
        sessions += [
            SessionDemand(
                draft.session_id,
                task_id,
                draft.duration_minutes,
                deadline,
                windows,
                priority,
            )
            for draft in split_task_sessions(task_id, minutes, length)
        ]
    problem = FeasibilityProblem(
        tuple(sessions),
        planning_start_minute=0,
        minimum_break_minutes=BREAK_MINUTES,
        max_solve_seconds=4.0,
        planning_days=tuple(
            PlanningDay(day, day * 1_440, (day + 1) * 1_440) for day in range(HORIZON_DAYS)
        ),
    )
    return Instance(variant, tasks, load, seed, problem, capacity)


class PathProbe:
    """Record the last stage ``solve_with_overload`` reached.

    ``slack`` means the per-task break-capacity models did not finish, so
    ranking and the main model never ran.

    Wraps module-level helpers for the duration of the script only; the
    production code is not changed.
    """

    def __init__(self) -> None:
        self.path = "slack"
        self._wrap("_policy_order", lambda _: "main")
        self._wrap("_uniform_allocation", lambda r: "chair" if r is not None else None)
        self._wrap("_uniform_witness_is_policy_optimal", lambda r: "greedy" if r else None)
        self._wrap("_uniform_flow_policy_witness", lambda r: "flow" if r is not None else None)

    def _wrap(self, name: str, label) -> None:
        original = getattr(overload, name)

        def wrapper(*args, **kwargs):
            result = original(*args, **kwargs)
            if (path := label(result)) is not None:
                self.path = path
            return result

        setattr(overload, name, wrapper)


def run(instance: Instance, probe: PathProbe) -> dict[str, object]:
    problem = instance.problem
    probe.path = "slack"
    started = perf_counter()
    result = overload.solve_with_overload(problem)
    elapsed = perf_counter() - started
    days_by_task: dict[str, set[int]] = defaultdict(set)
    for session in result.sessions:
        days_by_task[session.task_id].add(session.start_minute // 1_440)
    sessions_by_task = Counter(session.task_id for session in result.sessions)
    multi = [task for task, count in sessions_by_task.items() if count >= 2]
    total_minutes = sum(session.duration_minutes for session in problem.sessions)
    return {
        "variant": instance.variant,
        "tasks": instance.tasks,
        "load": instance.load,
        "seed": instance.seed,
        "sessions": len(problem.sessions),
        "work_min": total_minutes,
        "capacity_min": instance.capacity_minutes,
        "path": probe.path,
        "status": result.status.value,
        "solver_status": result.diagnostics.solver_status,
        "seconds": round(elapsed, 4),
        "placed": len(result.sessions),
        "unscheduled_min": sum(a.unscheduled_minutes for a in result.allocations),
        "avg_days_per_task": round(sum(len(days_by_task[task]) for task in multi) / len(multi), 2)
        if multi
        else "",
        "earliness_h": round(
            sum(s.start_minute - problem.planning_start_minute for s in result.sessions) / 60,
            1,
        ),
    }


def summary(rows: list[dict[str, object]]) -> str:
    lines = [
        "| Variant | Tasks | Load | Sessions (median) | Path | Status (solver) "
        "| Placed | Median s | Max s |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    groups: dict[tuple, list[dict[str, object]]] = defaultdict(list)
    for row in rows:
        groups[(row["variant"], row["tasks"], row["load"])].append(row)
    for (variant, tasks, load), group in groups.items():
        times = [float(row["seconds"]) for row in group]
        statuses = Counter(f"{row['status']} ({row['solver_status']})" for row in group)
        paths = Counter(str(row["path"]) for row in group)
        placed = sum(int(row["placed"]) for row in group)
        total = sum(int(row["sessions"]) for row in group)
        lines.append(
            f"| {variant} | {tasks} | {load} | {median(int(r['sessions']) for r in group):g} "
            f"| {', '.join(f'{k} {v}' for k, v in paths.most_common())} "
            f"| {', '.join(f'{k} {v}' for k, v in statuses.most_common())} "
            f"| {100 * placed / total:.0f}% | {median(times):.3f} | {max(times):.3f} |"
        )
    return "\n".join(lines)


def machine_line() -> str:
    try:
        sha = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],  # noqa: S607 - git comes from PATH
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        sha = "unknown"
    return (
        f"{platform.platform()}, {platform.machine()}, Python {platform.python_version()}, "
        f"OR-Tools {ortools.__version__}, git {sha}"
    )


def main() -> int:
    parser = ArgumentParser()
    parser.add_argument("--seeds", type=int, default=10)
    parser.add_argument("--sizes", default="10,25,50,100")
    parser.add_argument("--csv", help="write one row per run to this path")
    parser.add_argument("--no-uniform", action="store_true", help="skip the all-60-minute variant")
    arguments = parser.parse_args()
    sizes = [int(size) for size in arguments.sizes.split(",")]
    variants = ["mixed"] if arguments.no_uniform else ["mixed", "uniform"]

    probe = PathProbe()
    overload.solve_with_overload(build_instance("mixed", sizes[0], "light", -1).problem)
    rows: list[dict[str, object]] = []
    for variant in variants:
        for tasks in sizes:
            for load in LOADS:
                for seed in range(arguments.seeds):
                    row = run(build_instance(variant, tasks, load, seed), probe)
                    rows.append(row)
                    print(
                        f"{variant} tasks={tasks} load={load} seed={seed} "
                        f"path={row['path']} {row['status']} ({row['solver_status']}) "
                        f"{row['seconds']}s",
                        file=sys.stderr,
                    )

    if arguments.csv:
        with open(arguments.csv, "w", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerows(rows)
    print(f"{machine_line()}\n")
    print(
        f"Horizon {HORIZON_DAYS} days, break {BREAK_MINUTES} min, 4 s solver limit, "
        f"load = work / available minutes ({', '.join(f'{k} {v}' for k, v in LOADS.items())})\n"
    )
    print(summary(rows))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
