"""Follow-up to ``robustness_experiment.py`` with controlled load. One-off experiment.

Run from ``backend/``::

    uv run python benchmarks/robustness_controlled.py audit   # technical-note overload audit
    uv run python benchmarks/robustness_controlled.py run     # controlled-load experiment

Overload check (both parts): for every deadline d, required minutes before d are
the work due by d plus 10 x max(0, sessions due by d - windows ending by d). The
break term is a lower bound (each window holding k sessions needs k - 1 breaks),
so a ratio above 1 proves overload; a ratio at or below 1 does not prove
feasibility. The load of a scenario is the largest ratio over its deadlines.

Controlled scenarios use the technical-note generator style (same windows,
weights U(60, 360), session lengths, deadlines on days 2..14, priorities) and
scale the weights so the TRUE MEDIAN plan (original x b, after session rounding)
plus breaks has a load of exactly the target (largest scale not above it). Task
structure is shared across the three targets for a given variant, size and seed.

Error model: true duration = original x LogNormal(median=b, sigma=s), b = 1.3.
Conditions A (original), B (original x b), C (original x b x exp(0.674 s)) are
solved on the same scenario. A condition with no schedule is a failure: every
task of that scenario counts as missed.
"""

import json
import math
import random
import sys
from argparse import ArgumentParser
from collections import Counter, defaultdict
from pathlib import Path
from statistics import mean, median

from robustness_experiment import Task, planned_minutes, simulate, solve, task_specs
from technical_note import (
    BREAK_MINUTES,
    HORIZON_DAYS,
    SESSION_LENGTHS,
    _windows,
    build_instance,
    machine_line,
)

from studyflow.scheduling.contracts import (
    FeasibilityProblem,
    PlanningDay,
    SessionDemand,
    TaskPriority,
)
from studyflow.scheduling.splitting import split_task_sessions

B = 1.3
S_VALUES = (0.3, 0.5)
TARGETS = (0.60, 0.75, 0.90)
SIZES = (10, 25, 50)
VARIANTS = ("mixed", "uniform")
SEEDS = range(10)
SAMPLES = 50
Z75 = 0.674
EXPERIMENT_SEED = 20261108
TOLERANCE = 0.03  # max |achieved load - target| for a scenario to be used
EVIDENCE = Path(__file__).resolve().parents[2] / "docs" / "evidence"


def load_ratio(windows, tasks: list[tuple[int, int, int]]) -> float:
    """Largest (work + lower-bound breaks) / capacity over deadlines.

    ``tasks`` holds ``(minutes, session_length, deadline)`` after session rounding.
    """

    worst = 0.0
    for deadline in sorted({deadline for _, _, deadline in tasks}):
        before = [w for w in windows if w.end <= deadline]
        capacity = sum(w.end - w.start for w in before)
        due = [(m, length) for m, length, d in tasks if d <= deadline]
        work = sum(m for m, _ in due)
        sessions = sum(math.ceil(m / length) for m, length in due)
        need = work + BREAK_MINUTES * max(0, sessions - len(before))
        worst = max(worst, need / capacity if capacity else math.inf)
    return worst


# ---------------------------------------------------------------- part 1: audit


def audit(first_run_json: Path) -> dict:
    engine = {}
    if first_run_json.exists():
        for row in json.loads(first_run_json.read_text())["rows"]:
            # condition A at b = 1.0 is the technical-note instance unchanged
            if row["condition"] == "A" and row["b"] == 1.0 and row["s"] == 0.3:
                key = (row["variant"], row["tasks"], row["load"], row["seed"])
                engine[key] = f"{row['status']}/{row['solver_status']}"
    rows = []
    for variant in VARIANTS:
        for tasks in (10, 25, 50, 100):
            for load in ("light", "heavy"):
                for seed in SEEDS:
                    instance = build_instance(variant, tasks, load, seed)
                    specs = task_specs(instance)
                    windows = instance.problem.sessions[0].allowed_windows
                    ratio = load_ratio(
                        windows,
                        [(planned_minutes(t, 1.0, variant), t.length, t.deadline) for t in specs],
                    )
                    rows.append(
                        {
                            "variant": variant,
                            "tasks": tasks,
                            "bucket": "<20" if tasks < 20 else "20-49" if tasks < 50 else "50+",
                            "load": load,
                            "seed": seed,
                            "deadline_load": round(ratio, 3),
                            "proven_overloaded": ratio > 1,
                            "engine": engine.get((variant, tasks, load, seed)),
                        }
                    )
    return {"rows": rows}


def audit_markdown(result: dict) -> str:
    rows = result["rows"]
    lines = [
        "## Part 1: overload audit of the 160 technical-note scenarios",
        "",
        "Deadline load = max over deadlines of (work due + lower-bound breaks) / capacity "
        "before that deadline, using the original estimates (perfect estimates). Above 1 "
        "proves overload. Engine = `solve_with_overload` status on the same instance "
        "(from the first robustness run).",
        "",
        "| Sessions | Tasks | Load | Scenarios | Proven overloaded | Engine: overload "
        "| Engine: no schedule | Median deadline load |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    groups = defaultdict(list)
    for row in rows:
        groups[(row["variant"], row["bucket"], row["load"])].append(row)
    order = {"<20": 0, "20-49": 1, "50+": 2}
    for (variant, size_bucket, load), group in sorted(
        groups.items(), key=lambda item: (item[0][0], order[item[0][1]], item[0][2])
    ):
        engines = [str(r["engine"]) for r in group]
        lines.append(
            f"| {'equal' if variant == 'uniform' else 'mixed'} | {size_bucket} | {load} "
            f"| {len(group)} | {sum(r['proven_overloaded'] for r in group)} "
            f"| {sum(e.startswith('overload') for e in engines)} "
            f"| {sum(e.startswith(('technical_failure', 'infeasible')) for e in engines)} "
            f"| {median(r['deadline_load'] for r in group):.2f} |"
        )
    total = sum(r["proven_overloaded"] for r in rows)
    no_schedule = [
        r
        for r in rows
        if r["variant"] == "mixed"
        and r["tasks"] >= 50
        and str(r["engine"]).startswith(("technical_failure", "infeasible"))
    ]
    lines += [
        "",
        f"Proven overloaded with perfect estimates: {total} of {len(rows)}.",
        "",
        f"Mixed-length, 50+ tasks, no schedule within 4 s: {len(no_schedule)} instances; "
        f"{sum(r['proven_overloaded'] for r in no_schedule)} of them are proven overloaded "
        "(deadline loads: " + ", ".join(f"{r['deadline_load']:.2f}" for r in no_schedule) + ").",
        "",
    ]
    return "\n".join(lines)


# ------------------------------------------------------- part 2: controlled load


def controlled_scenario(variant: str, tasks: int, target: float, seed: int):
    rng = random.Random(f"controlled-{variant}-{tasks}-{seed}")  # shared across targets
    windows = _windows(rng)
    weights = [rng.uniform(60, 360) for _ in range(tasks)]
    shape = []
    for _ in range(tasks):
        length = 60 if variant == "uniform" else rng.choice(SESSION_LENGTHS)
        deadline = rng.randint(2, HORIZON_DAYS) * 1_440
        priority = rng.choice(tuple(TaskPriority))
        shape.append((length, deadline, priority))

    def specs_at(scale: float) -> list[Task]:
        return [
            Task(f"task-{i:03d}", max(10, round(w * scale)), length, deadline, priority)
            for i, (w, (length, deadline, priority)) in enumerate(zip(weights, shape, strict=True))
        ]

    def ratio(scale: float) -> float:
        return load_ratio(
            windows,
            [(planned_minutes(t, B, variant), t.length, t.deadline) for t in specs_at(scale)],
        )

    low, high = 0.0, 10.0
    for _ in range(60):  # largest scale whose true-median load does not exceed target
        middle = (low + high) / 2
        if ratio(middle) <= target:
            low = middle
        else:
            high = middle
    specs = specs_at(low)
    capacity = sum(w.end - w.start for w in windows)
    true_median = sum(planned_minutes(t, B, variant) for t in specs)
    return windows, specs, ratio(low), true_median / capacity


def build_problem(windows, specs: list[Task], factor: float, variant: str) -> FeasibilityProblem:
    sessions = tuple(
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
            task.task_id, planned_minutes(task, factor, variant), task.length
        )
    )
    return FeasibilityProblem(
        sessions,
        planning_start_minute=0,
        minimum_break_minutes=BREAK_MINUTES,
        max_solve_seconds=4.0,
        planning_days=tuple(
            PlanningDay(day, day * 1_440, (day + 1) * 1_440) for day in range(HORIZON_DAYS)
        ),
    )


def run(sizes, seeds: int, samples: int) -> dict:
    solve(build_problem(*controlled_scenario("mixed", 10, 0.6, -1)[:2], 1.0, "mixed"))  # warm-up
    rows, skipped = [], []
    for variant in VARIANTS:
        for tasks in sizes:
            for target in TARGETS:
                for seed in range(seeds):
                    windows, specs, achieved, overall = controlled_scenario(
                        variant, tasks, target, seed
                    )
                    if abs(achieved - target) > TOLERANCE:
                        # e.g. equal 60-min sessions: 50 tasks x 60 min already exceed target
                        skipped.append(
                            {
                                "variant": variant,
                                "tasks": tasks,
                                "target": target,
                                "seed": seed,
                                "achieved": round(achieved, 4),
                            }
                        )
                        print(
                            f"skip {variant} {tasks} {target} {seed} load={achieved:.3f}",
                            file=sys.stderr,
                        )
                        continue
                    factors = {"A": 1.0, "B": B}
                    factors |= {f"C{s}": B * math.exp(Z75 * s) for s in S_VALUES}
                    solved = {}
                    for name, factor in factors.items():
                        problem = build_problem(windows, specs, factor, variant)
                        result, seconds = solve(problem)
                        solved[name] = (problem, result, seconds)
                    for s in S_VALUES:
                        rng = random.Random(
                            f"{EXPERIMENT_SEED}-{variant}-{tasks}-{target}-{seed}-{s}"
                        )
                        draws = [
                            {
                                t.task_id: max(
                                    1, round(t.minutes * rng.lognormvariate(math.log(B), s))
                                )
                                for t in specs
                            }
                            for _ in range(samples)
                        ]
                        for condition, key in (("A", "A"), ("B", "B"), ("C", f"C{s}")):
                            problem, result, seconds = solved[key]
                            failed = not (
                                result.status.value in ("feasible", "overload") and result.sessions
                            )
                            miss, unused = [], []
                            for draw in draws:
                                if failed:  # no schedule: every task missed
                                    miss.append(1.0)
                                    unused.append(0.0)
                                    continue
                                missed, unneeded = simulate(
                                    specs, result.sessions, draw, windows, BREAK_MINUTES
                                )
                                miss.append(len(missed) / tasks)
                                unused.append(unneeded / sum(draw.values()))
                            rows.append(
                                {
                                    "variant": variant,
                                    "tasks": tasks,
                                    "target": target,
                                    "seed": seed,
                                    "s": s,
                                    "condition": condition,
                                    "true_median_deadline_load": round(achieved, 4),
                                    "true_median_overall_load": round(overall, 4),
                                    "plan_factor": round(factors[key], 4),
                                    "planned_min": sum(
                                        x.duration_minutes for x in problem.sessions
                                    ),
                                    "status": result.status.value,
                                    "solver_status": result.diagnostics.solver_status,
                                    "seconds": round(seconds, 3),
                                    "failed": failed,
                                    "task_miss_rate": mean(miss),
                                    "unused_pct_of_true": 100 * mean(unused),
                                }
                            )
                    print(
                        f"{variant} tasks={tasks} target={target} seed={seed} "
                        + " ".join(
                            f"{k}:{v[1].status.value}/{v[2]:.1f}s" for k, v in solved.items()
                        ),
                        file=sys.stderr,
                        flush=True,
                    )
    Path(EVIDENCE / "robustness-controlled-rows.partial.json").write_text(json.dumps(rows))
    summary = []
    groups = defaultdict(list)
    for row in rows:
        groups[(row["target"], row["s"], row["tasks"], row["condition"])].append(row)
    for (target, s, tasks, condition), group in sorted(groups.items()):
        summary.append(
            {
                "target": target,
                "s": s,
                "tasks": tasks,
                "condition": condition,
                "scenarios": len(group),
                "failed": sum(r["failed"] for r in group),
                "overload_plans": sum(r["status"] == "overload" for r in group),
                "statuses": dict(Counter(f"{r['status']}/{r['solver_status']}" for r in group)),
                "task_miss_pct": round(100 * mean(r["task_miss_rate"] for r in group), 1),
                "unused_pct_of_true": round(mean(r["unused_pct_of_true"] for r in group), 1),
                "by_variant": {
                    v: {
                        "scenarios": len(sub := [r for r in group if r["variant"] == v]),
                        "task_miss_pct": round(100 * mean(r["task_miss_rate"] for r in sub), 1)
                        if sub
                        else None,
                    }
                    for v in VARIANTS
                },
            }
        )
    return {
        "rows": rows,
        "summary": summary,
        "skipped": skipped,
        "seeds": seeds,
        "samples": samples,
    }


def run_markdown(result: dict) -> str:
    # Older saved results omit these fields and used the defaults.
    seeds = result.get("seeds", len(SEEDS))
    samples = result.get("samples", SAMPLES)
    lines = [
        "## Part 2: controlled-load experiment",
        "",
        f"- Scenarios: {len(VARIANTS)} session-length variants x task counts x {seeds} seeds per "
        "cell, shared by A/B/C. Load = deadline load of the true-median plan "
        "(original x 1.3, after rounding, plus lower-bound breaks).",
        "- Error model: true = original x LogNormal(median=1.3, sigma=s), "
        f"{samples} samples per schedule, seed {EXPERIMENT_SEED}.",
        "- A = original, B = original x 1.3, C = original x 1.3 x exp(0.674 s).",
        "- Failed = no schedule returned; all its tasks counted as missed.",
        "- Unused = planned minutes not needed, as % of true work.",
        f"- Skipped {len(result['skipped'])} scenarios whose load could not be set within "
        f"{TOLERANCE} of the target: "
        + ", ".join(
            f"{v} {n} tasks: {c}"
            for (v, n), c in sorted(
                Counter((x["variant"], x["tasks"]) for x in result["skipped"]).items()
            )
        )
        + ".",
        "",
        "| Load | s | Tasks | Cond | Tasks missed % | Unused % of true work "
        "| Failed | Overload plans |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for row in result["summary"]:
        lines.append(
            f"| {row['target']:.0%} | {row['s']} | {row['tasks']} | {row['condition']} "
            f"| {row['task_miss_pct']} | {row['unused_pct_of_true']} "
            f"| {row['failed']}/{row['scenarios']} | {row['overload_plans']} |"
        )
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    parser = ArgumentParser()
    parser.add_argument("mode", choices=("audit", "run", "markdown"))
    parser.add_argument("--sizes", default=",".join(map(str, SIZES)))
    parser.add_argument("--seeds", type=int, default=len(SEEDS))
    parser.add_argument("--samples", type=int, default=SAMPLES)
    parser.add_argument("--out", default=str(EVIDENCE / "robustness-controlled-2026-11-07"))
    args = parser.parse_args()
    out_json = Path(f"{args.out}.json")
    saved = json.loads(out_json.read_text()) if out_json.exists() else {}
    meta = saved.setdefault("meta", {})
    if args.mode != "markdown":
        # Re-rendering must not restamp saved results with the current machine.
        meta["machine"] = machine_line()
    if args.mode == "audit":
        saved["audit"] = audit(EVIDENCE / "robustness-2026-11-07.json")
    elif args.mode == "run":
        saved["controlled"] = run([int(x) for x in args.sizes.split(",")], args.seeds, args.samples)
    out_json.write_text(json.dumps(saved, indent=1))
    text = [
        "# Schedule robustness with controlled load (2026-11-07)",
        "",
        saved["meta"]["machine"],
        "",
    ]
    if "audit" in saved:
        text.append(audit_markdown(saved["audit"]))
    if "controlled" in saved:
        text.append(run_markdown(saved["controlled"]))
    Path(f"{args.out}.md").write_text("\n".join(text))
    print("\n".join(text))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
