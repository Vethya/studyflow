"""Robustness of solved schedules when real task durations differ from the plan.

One-off experiment. Run from ``backend/``::

    uv run python benchmarks/robustness_experiment.py

Scenarios come from ``technical_note.build_instance`` (2 variants x 4 sizes x
2 loads x 10 seeds = 160, 4 s solver limit). The engine is called unchanged.

Error model: for each task, true duration = original estimate x LogNormal with
median b and log-sigma s, i.e. original x exp(N(ln b, s)). Grid b in {1.0, 1.3},
s in {0.3, 0.5}. The same true-duration draws are reused for A, B and C of one
scenario (paired comparison).

Planning conditions:
  A  original estimate
  B  original x b                     (well-calibrated median)
  C  original x b x exp(0.674 s)      (75th percentile)

Execution: sessions run as scheduled. A task that needs less stops early and its
remaining scheduled time is freed. A task that needs more gets its extra minutes
placed greedily, earliest-deadline-first across tasks, in the earliest free
available time before its deadline, keeping the minimum break from every other
block. A task misses if work remains at its deadline. A stricter secondary
metric ("after last") only allows extra minutes after the task's last scheduled
session, i.e. the student only finds out a task runs long once they get there.
"""

import json
import math
import random
import sys
from argparse import ArgumentParser
from bisect import bisect_right
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from statistics import mean
from time import perf_counter

from technical_note import (
    BREAK_MINUTES,
    LOADS,
    SESSION_LENGTHS,
    Instance,
    _windows,
    build_instance,
    machine_line,
)

from studyflow.scheduling import overload
from studyflow.scheduling.contracts import FeasibilityProblem, SessionDemand, TaskPriority
from studyflow.scheduling.splitting import split_task_sessions

VARIANTS = ("mixed", "uniform")
SIZES = (10, 25, 50, 100)
SEEDS = range(10)
B_VALUES = (1.0, 1.3)
S_VALUES = (0.3, 0.5)
Z75 = 0.674
EXPERIMENT_SEED = 20261107


@dataclass(frozen=True, slots=True)
class Task:
    task_id: str
    minutes: int  # original estimate
    length: int  # preferred session length
    deadline: int
    priority: TaskPriority


def task_specs(instance: Instance) -> list[Task]:
    """Replay ``build_instance``'s random draws to recover each task's inputs.

    Session length cannot be read back from the sessions when a task is shorter
    than its length, so the draws are replayed; ``rebuild`` with factor 1 is
    checked against the generator's own problem.
    """

    variant, tasks, load, seed = instance.variant, instance.tasks, instance.load, instance.seed
    rng = random.Random(f"{variant}-{tasks}-{load}-{seed}")
    windows = _windows(rng)
    capacity = sum(window.end - window.start for window in windows)
    weights = [rng.uniform(60, 360) for _ in range(tasks)]
    scale = LOADS[load] * capacity / sum(weights)
    specs = []
    for index, weight in enumerate(weights):
        length = 60 if variant == "uniform" else rng.choice(SESSION_LENGTHS)
        minutes = max(10, round(weight * scale))
        if variant == "uniform":
            minutes = max(60, round(minutes / 60) * 60)
        deadline = rng.randint(2, 14) * 1_440
        priority = rng.choice(tuple(TaskPriority))
        specs.append(Task(f"task-{index:03d}", minutes, length, deadline, priority))
    return specs


def planned_minutes(task: Task, factor: float, variant: str) -> int:
    minutes = max(10, round(task.minutes * factor))
    if variant == "uniform":  # keep equal 60-minute sessions
        minutes = max(60, round(minutes / 60) * 60)
    return minutes


def rebuild(instance: Instance, specs: list[Task], factor: float) -> FeasibilityProblem:
    base = instance.problem
    windows = base.sessions[0].allowed_windows
    sessions = [
        SessionDemand(
            draft.session_id,
            task.task_id,
            draft.duration_minutes,
            task.deadline,
            windows,
            task.priority,
        )
        for task in specs
        for draft in split_task_sessions(
            task.task_id, planned_minutes(task, factor, instance.variant), task.length
        )
    ]
    return FeasibilityProblem(
        tuple(sessions),
        planning_start_minute=base.planning_start_minute,
        minimum_break_minutes=base.minimum_break_minutes,
        max_solve_seconds=base.max_solve_seconds,
        planning_days=base.planning_days,
    )


def free_gaps(windows, busy, brk):
    """Available windows minus busy blocks padded by the break on both sides."""

    gaps = []
    busy = sorted(busy)
    index = 0
    for window in windows:
        cursor = window.start
        while index < len(busy) and busy[index][1] + brk <= window.start:
            index += 1
        probe = index
        while probe < len(busy) and busy[probe][0] - brk < window.end:
            start, end = busy[probe]
            if start - brk > cursor:
                gaps.append([cursor, start - brk])
            cursor = max(cursor, end + brk)
            probe += 1
        if cursor < window.end:
            gaps.append([cursor, window.end])
    return gaps


def simulate(specs, sessions, true_minutes, windows, brk, after_last=False):
    """Return (missed task ids, unneeded scheduled minutes) for one sample.

    MISS DEFINITION: a task misses when it still has work left after all its
    scheduled sessions and all overflow time that fits before its deadline.
    """

    by_task = defaultdict(list)
    for session in sessions:
        by_task[session.task_id].append((session.start_minute, session.end_minute))
    busy = []
    remaining = {}
    ready_at = {}
    unneeded = 0
    for task in specs:
        need = true_minutes[task.task_id]
        last_end = 0
        for start, end in sorted(by_task[task.task_id]):
            if need <= 0:
                unneeded += end - start  # whole session not needed, time freed
                continue
            used = min(need, end - start)
            unneeded += (end - start) - used
            need -= used
            busy.append((start, start + used))
            last_end = start + used
        remaining[task.task_id] = need
        ready_at[task.task_id] = last_end if after_last else 0

    gaps = free_gaps(windows, busy, brk)
    missed = []
    for task in sorted(specs, key=lambda t: (t.deadline, t.task_id)):  # EDF
        need = remaining[task.task_id]
        if need <= 0:
            continue
        cursor = ready_at[task.task_id] + (brk if ready_at[task.task_id] else 0)
        position = max(0, bisect_right([gap[1] for gap in gaps], cursor))
        while need > 0 and position < len(gaps):
            gap_start, gap_end = gaps[position]
            start = max(gap_start, cursor)
            end = min(gap_end, task.deadline)
            if start >= task.deadline:
                break
            if end <= start:
                position += 1
                continue
            take = min(need, end - start)
            need -= take
            block_end = start + take
            # split the gap around the new block, keeping the break on both sides
            replacement = []
            if start - brk > gap_start:
                replacement.append([gap_start, start - brk])
            if block_end + brk < gap_end:
                replacement.append([block_end + brk, gap_end])
            gaps[position : position + 1] = replacement
            cursor = block_end + brk
            position = bisect_right([gap[1] for gap in gaps], cursor)
        if need > 0:
            missed.append(task.task_id)
    return missed, unneeded


def bucket(tasks: int) -> str:
    return "<20" if tasks < 20 else "20-49" if tasks < 50 else "50+"


def has_schedule(result) -> bool:
    return result.status.value in ("feasible", "overload") and bool(result.sessions)


def solve(problem: FeasibilityProblem):
    started = perf_counter()
    result = overload.solve_with_overload(problem)
    return result, perf_counter() - started


def main() -> int:
    parser = ArgumentParser()
    parser.add_argument("--samples", type=int, default=50)
    parser.add_argument("--seeds", type=int, default=len(SEEDS))
    parser.add_argument("--sizes", default=",".join(map(str, SIZES)))
    parser.add_argument("--json", default="../docs/evidence/robustness-2026-11-07.json")
    parser.add_argument("--md", default="../docs/evidence/robustness-2026-11-07.md")
    parser.add_argument(
        "--resummarize", action="store_true", help="rebuild the markdown from --json, no solving"
    )
    args = parser.parse_args()
    if args.resummarize:
        saved = json.loads(Path(args.json).read_text())
        Path(args.md).write_text(markdown(saved["meta"], saved["summary"], saved["rows"]))
        return 0
    sizes = [int(size) for size in args.sizes.split(",")]

    overload.solve_with_overload(build_instance("mixed", sizes[0], "light", -1).problem)
    rows = []
    for variant in VARIANTS:
        for tasks in sizes:
            for load in LOADS:
                for seed in range(args.seeds):
                    instance = build_instance(variant, tasks, load, seed)
                    specs = task_specs(instance)
                    assert rebuild(instance, specs, 1.0) == instance.problem, "replay mismatch"
                    windows = instance.problem.sessions[0].allowed_windows
                    cache = {}

                    def schedule_for(factor, instance=instance, specs=specs, cache=cache):
                        key = round(factor, 9)
                        if key not in cache:
                            problem = rebuild(instance, specs, factor)
                            result, seconds = solve(problem)
                            cache[key] = (problem, result, seconds)
                        return cache[key]

                    for b in B_VALUES:
                        for s in S_VALUES:
                            # same true durations for A, B, C of this scenario and (b, s)
                            rng = random.Random(
                                f"{EXPERIMENT_SEED}-{variant}-{tasks}-{load}-{seed}-{b}-{s}"
                            )
                            draws = [
                                {
                                    t.task_id: max(
                                        1, round(t.minutes * rng.lognormvariate(math.log(b), s))
                                    )
                                    for t in specs
                                }
                                for _ in range(args.samples)
                            ]
                            factors = {"A": 1.0, "B": b, "C": b * math.exp(Z75 * s)}
                            for condition, factor in factors.items():
                                problem, result, seconds = schedule_for(factor)
                                row = {
                                    "variant": variant,
                                    "tasks": tasks,
                                    "bucket": bucket(tasks),
                                    "load": load,
                                    "seed": seed,
                                    "b": b,
                                    "s": s,
                                    "condition": condition,
                                    "plan_factor": round(factor, 4),
                                    "planned_min": sum(
                                        x.duration_minutes for x in problem.sessions
                                    ),
                                    "status": result.status.value,
                                    "solver_status": result.diagnostics.solver_status,
                                    "seconds": round(seconds, 3),
                                    "unscheduled_min": sum(
                                        a.unscheduled_minutes for a in result.allocations
                                    ),
                                    "has_schedule": has_schedule(result),
                                }
                                if row["has_schedule"]:
                                    outcomes = [
                                        simulate(
                                            specs, result.sessions, draw, windows, BREAK_MINUTES
                                        )
                                        for draw in draws
                                    ]
                                    row["any_miss_rate"] = mean(bool(m) for m, _ in outcomes)
                                    row["task_miss_rate"] = mean(
                                        len(m) / tasks for m, _ in outcomes
                                    )
                                    row["unneeded_min"] = mean(u for _, u in outcomes)
                                    row["any_miss_rate_after_last"] = mean(
                                        bool(
                                            simulate(
                                                specs,
                                                result.sessions,
                                                draw,
                                                windows,
                                                BREAK_MINUTES,
                                                after_last=True,
                                            )[0]
                                        )
                                        for draw in draws
                                    )
                                rows.append(row)
                    print(
                        f"{variant} tasks={tasks} load={load} seed={seed} solves={len(cache)} "
                        + " ".join(
                            f"{k}:{v[1].status.value}/{v[2]:.2f}s" for k, v in cache.items()
                        ),
                        file=sys.stderr,
                        flush=True,
                    )

    groups = defaultdict(list)
    for row in rows:
        groups[(row["load"], row["b"], row["s"], row["condition"], row["bucket"])].append(row)
    summary = []
    order = {"<20": 0, "20-49": 1, "50+": 2}
    for (load, b, s, condition, size_bucket), group in sorted(
        groups.items(), key=lambda item: (*item[0][:4], order[item[0][4]])
    ):
        ok = [row for row in group if row["has_schedule"]]
        summary.append(
            {
                "load": load,
                "b": b,
                "s": s,
                "condition": condition,
                "bucket": size_bucket,
                "scenarios": len(group),
                "no_schedule": len(group) - len(ok),
                "overload_plans": sum(row["status"] == "overload" for row in group),
                "solver_not_optimal": sum(row["solver_status"] != "OPTIMAL" for row in group),
                "statuses": dict(Counter(f"{r['status']}/{r['solver_status']}" for r in group)),
                "any_miss_pct": round(100 * mean(r["any_miss_rate"] for r in ok), 1)
                if ok
                else None,
                "any_miss_after_last_pct": round(
                    100 * mean(r["any_miss_rate_after_last"] for r in ok), 1
                )
                if ok
                else None,
                "task_miss_pct": round(100 * mean(r["task_miss_rate"] for r in ok), 2)
                if ok
                else None,
                "unneeded_min": round(mean(r["unneeded_min"] for r in ok)) if ok else None,
            }
        )

    meta = {
        "machine": machine_line(),
        "samples_per_schedule": args.samples,
        "experiment_seed": EXPERIMENT_SEED,
        "error_model": (
            "true = original x LogNormal(median=b, sigma=s) = original x exp(N(ln b, s))"
        ),
        "conditions": {"A": "original", "B": "original x b", "C": "original x b x exp(0.674 s)"},
        "grid": {"b": B_VALUES, "s": S_VALUES},
        "scenarios": "technical_note.build_instance; variants mixed/uniform, sizes "
        f"{sizes}, loads {LOADS}, seeds 0..{args.seeds - 1}",
    }
    Path(args.json).write_text(
        json.dumps({"meta": meta, "summary": summary, "rows": rows}, indent=1)
    )
    Path(args.md).write_text(markdown(meta, summary, rows))
    print(markdown(meta, summary, rows))
    return 0


def clean_subset(rows):
    """Scenarios where A, B and C all got a complete (feasible) plan, paired."""

    by_key = defaultdict(dict)
    for row in rows:
        key = (row["variant"], row["tasks"], row["load"], row["seed"], row["b"], row["s"])
        by_key[key][row["condition"]] = row
    groups = defaultdict(list)
    for key, conditions in by_key.items():
        if all(
            conditions[c]["status"] == "feasible" and conditions[c]["has_schedule"] for c in "ABC"
        ):
            groups[(key[2], key[4], key[5], key[0])].append(conditions)
    return groups


def markdown(meta, summary, rows) -> str:
    lines = [
        "# Schedule robustness to duration error (2026-11-07)",
        "",
        f"{meta['machine']}",
        "",
        f"- Error model: {meta['error_model']}; fixed seed {meta['experiment_seed']}, "
        f"{meta['samples_per_schedule']} samples per schedule.",
        "- A = plan on original; B = original x b; C = original x b x exp(0.674 s) (75th pct).",
        f"- Scenarios: {meta['scenarios']}.",
        "- Any miss = % of samples with at least one missed deadline. Task miss = mean % of "
        "tasks missed. After last = extra minutes only allowed after the task's last "
        "scheduled session. Unneeded = mean scheduled minutes not used per scenario.",
        "- No sched = solver returned no schedule (excluded from miss rates). Overload = the plan "
        "itself left work unscheduled (included). Not optimal = solver stopped before proof "
        "(time limit), schedule still used.",
        "",
    ]
    for load in LOADS:
        lines += [
            f"## Load: {load}",
            "",
            "| b | s | Cond | Tasks | Any miss % | Any miss % (after last) | Task miss % "
            "| Unneeded min | No sched | Overload | Not optimal |",
            "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
        ]
        for row in summary:
            if row["load"] != load:
                continue
            lines.append(
                f"| {row['b']} | {row['s']} | {row['condition']} | {row['bucket']} "
                f"| {row['any_miss_pct']} | {row['any_miss_after_last_pct']} "
                f"| {row['task_miss_pct']} | {row['unneeded_min']} "
                f"| {row['no_schedule']}/{row['scenarios']} | {row['overload_plans']} "
                f"| {row['solver_not_optimal']} |"
            )
        lines.append("")
    lines += [
        "## Paired subset: A, B and C all produced a complete plan",
        "",
        "Every other (load, b, s) cell has no scenario where all three plans are feasible.",
        "",
        "| Load | b | s | Variant | Scenarios (task counts) | Cond | Any miss % | Task miss % "
        "| Unneeded min |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for (load, b, s, variant), group in sorted(clean_subset(rows).items()):
        sizes = ", ".join(str(n) for n in sorted({g["A"]["tasks"] for g in group}))
        for c in "ABC":
            lines.append(
                f"| {load} | {b} | {s} | {variant} | {len(group)} ({sizes}) | {c} "
                f"| {100 * mean(g[c]['any_miss_rate'] for g in group):.0f} "
                f"| {100 * mean(g[c]['task_miss_rate'] for g in group):.1f} "
                f"| {mean(g[c]['unneeded_min'] for g in group):.0f} |"
            )
    lines.append("")
    return "\n".join(lines)


if __name__ == "__main__":
    raise SystemExit(main())
