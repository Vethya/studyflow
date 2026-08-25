"""Run the documented warm scheduler p95 gate."""

from argparse import ArgumentParser
from math import ceil
from time import perf_counter

from studyflow.scheduling import KernelStatus, solve_with_overload
from studyflow.scheduling._performance import (
    PerformanceScenario,
    representative_performance_problem,
)


def percentile_95(samples: list[float]) -> float:
    return sorted(samples)[ceil(len(samples) * 0.95) - 1]


def main() -> int:
    parser = ArgumentParser()
    parser.add_argument("--runs", type=int, default=20)
    parser.add_argument("--threshold-seconds", type=float, default=5.0)
    arguments = parser.parse_args()
    if arguments.runs <= 0:
        parser.error("--runs must be positive")

    failed = False
    for scenario in PerformanceScenario:
        problem = representative_performance_problem(scenario)
        solve_with_overload(problem)  # Warm imports, presolve code, and allocator paths.
        samples: list[float] = []
        statuses: list[KernelStatus] = []
        for _ in range(arguments.runs):
            started = perf_counter()
            result = solve_with_overload(problem)
            samples.append(perf_counter() - started)
            statuses.append(result.status)

        expected = (
            KernelStatus.FEASIBLE
            if scenario is PerformanceScenario.FEASIBLE
            else KernelStatus.OVERLOAD
        )
        p95 = percentile_95(samples)
        print(
            f"{scenario.value}: runs={arguments.runs} "
            f"p95={p95:.3f}s max={max(samples):.3f}s status={statuses[-1].value}"
        )
        failed |= p95 >= arguments.threshold_seconds or any(
            status is not expected for status in statuses
        )
    return int(failed)


if __name__ == "__main__":
    raise SystemExit(main())
