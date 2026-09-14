"""Run the full-stack HTTP response benchmark gate per SPEC NFR-02."""

import argparse
import asyncio
import json
import os
import sys
from datetime import UTC, datetime, timedelta
from math import ceil
from pathlib import Path
from time import perf_counter
from typing import Any

import httpx

BENCHMARK_EMAIL = "nfr02_benchmark@studyflow.dev"
BENCHMARK_PASSWORD = "BenchmarkPassword123!"
OVERLOAD_TASK_COUNT = 5
OVERLOAD_DEADLINE_OFFSET = timedelta(hours=2)


def percentile_95(samples: list[float]) -> float:
    return sorted(samples)[ceil(len(samples) * 0.95) - 1]


def write_json_report(path: str | None, report: dict[str, Any]) -> None:
    if path is None:
        return
    output = Path(path)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")


async def run_http_benchmark(
    base_url: str,
    runs: int = 20,
    page_threshold_seconds: float = 3.0,
    generation_threshold_seconds: float = 5.0,
    email: str = BENCHMARK_EMAIL,
    password: str = BENCHMARK_PASSWORD,
    json_output: str | None = None,
) -> int:
    """Measure warm response latencies against live API endpoints with seeded NFR-02 data."""
    report: dict[str, Any] = {
        "benchmark": "nfr02-http",
        "started_at": datetime.now(UTC).isoformat(),
        "base_url": base_url,
        "runs": runs,
        "warmup_runs_per_endpoint": 1,
        "thresholds_seconds": {
            "query": page_threshold_seconds,
            "generation": generation_threshold_seconds,
        },
        "endpoints": [],
        "status": "failed",
    }

    try:
        async with httpx.AsyncClient(base_url=base_url, timeout=30.0) as client:
            # 1. Login
            login_res = await client.post(
                "/api/v1/auth/login",
                json={"email": email, "password": password},
            )
            if login_res.status_code != 200:
                print(
                    f"Error: Authentication failed ({login_res.status_code}): {login_res.text}",
                    file=sys.stderr,
                )
                print(
                    "Make sure the target account exists and the supplied benchmark "
                    "credentials match it.",
                    file=sys.stderr,
                )
                report["error"] = f"Authentication failed ({login_res.status_code})"
                write_json_report(json_output, report)
                return 1

            csrf_token = login_res.json().get("csrf_token")
            headers = {"X-CSRF-Token": csrf_token} if csrf_token else {}

            # Fetch tasks to construct realistic overloaded scenario per SPEC NFR-02
            tasks_res = await client.get("/api/v1/tasks", headers=headers)
            if tasks_res.status_code != 200:
                report["error"] = f"Could not load seeded tasks ({tasks_res.status_code})"
                write_json_report(json_output, report)
                return 1

            tasks_data = tasks_res.json()
            if not isinstance(tasks_data, list) or len(tasks_data) < OVERLOAD_TASK_COUNT:
                report["error"] = (
                    "Seeded workload does not contain at least "
                    f"{OVERLOAD_TASK_COUNT} tasks"
                )
                write_json_report(json_output, report)
                return 1

            # Keep the full seeded workload, but make five tasks clearly impossible
            # to finish in the near term. This produces a fast, proven overload
            # without changing the production scheduler or reducing the dataset.
            # Scenario deadline overrides are required to use an exact UTC minute.
            overload_deadline = (
                (datetime.now(UTC) + OVERLOAD_DEADLINE_OFFSET)
                .replace(second=0, microsecond=0)
                .isoformat(timespec="minutes")
            )
            overload_payload: dict[str, Any] = {
                "scenario": {
                    "deadline_overrides": [
                        {"task_id": t["id"], "deadline_at": overload_deadline}
                        for t in tasks_data[:OVERLOAD_TASK_COUNT]
                    ]
                }
            }

            # Endpoints to test under NFR-02
            endpoints: list[dict[str, Any]] = [
                {"name": "Tasks List (50 tasks)", "method": "GET", "url": "/api/v1/tasks"},
                {
                    "name": "Availability Windows",
                    "method": "GET",
                    "url": "/api/v1/availability/windows",
                },
                {
                    "name": "Unavailable Periods (50 gaps)",
                    "method": "GET",
                    "url": "/api/v1/availability/unavailable-periods",
                },
                {
                    "name": "Active Study Sessions (250 sessions)",
                    "method": "GET",
                    "url": "/api/v1/study-sessions",
                },
                {
                    "name": "Current Schedule Proposal",
                    "method": "GET",
                    "url": "/api/v1/schedule-proposals/current",
                },
                {"name": "Effort Progress", "method": "GET", "url": "/api/v1/progress"},
                {
                    "name": "Schedule Generation (Feasible, 50 tasks)",
                    "method": "POST",
                    "url": "/api/v1/schedule-proposals",
                    "is_generation": True,
                },
                {
                    "name": "Schedule Generation (Overloaded, 50 tasks)",
                    "method": "POST",
                    "url": "/api/v1/schedule-proposals",
                    "json": overload_payload,
                    "is_generation": True,
                },
            ]

            print(f"Running NFR-02 HTTP benchmark against {base_url} ({runs} runs/endpoint)...")
            print()
            print("| Endpoint | Min (s) | Median (s) | Max (s) | P95 (s) | Threshold | Pass/Fail |")
            print("| :--- | :--- | :--- | :--- | :--- | :--- | :--- |")

            failed = False

            for endpoint in endpoints:
                url = endpoint["url"]
                method = endpoint["method"]
                payload = endpoint.get("json")
                is_gen = endpoint.get("is_generation", False)
                threshold = generation_threshold_seconds if is_gen else page_threshold_seconds

                # Warm-up run
                warmup_started = perf_counter()
                warmup_error: str | None = None
                try:
                    if method == "GET":
                        warm_res = await client.get(url, headers=headers)
                    else:
                        warm_res = await client.post(url, headers=headers, json=payload)
                except httpx.RequestError as exc:
                    warm_res = None
                    warmup_error = str(exc)
                warmup_elapsed = perf_counter() - warmup_started

                if warm_res is None or warm_res.status_code >= 400:
                    warmup_status_code = warm_res.status_code if warm_res is not None else None
                    report["endpoints"].append(
                        {
                            "name": endpoint["name"],
                            "path": url,
                            "scenario": (
                                "overloaded"
                                if "Overloaded" in endpoint["name"]
                                else "feasible"
                                if is_gen
                                else None
                            ),
                            "threshold_seconds": threshold,
                            "warmup_seconds": warmup_elapsed,
                            "warmup_status_code": warmup_status_code,
                            "warmup_error": warmup_error,
                            "sample_seconds": [],
                            "status": "failed",
                        }
                    )
                    warmup_status = (
                        f"HTTP {warmup_status_code}"
                        if warm_res is not None
                        else "request error"
                    )
                    print(
                        f"| {endpoint['name']} | - | - | - | - | {threshold:.1f}s | "
                        f"❌ FAIL ({warmup_status}) |"
                    )
                    failed = True
                    continue

                samples: list[float] = []
                status_codes: list[int | None] = []
                request_errors: list[str] = []
                endpoint_failed = False
                last_error_status: int | None = None
                for _ in range(runs):
                    started = perf_counter()
                    try:
                        if method == "GET":
                            res = await client.get(url, headers=headers)
                        else:
                            res = await client.post(url, headers=headers, json=payload)
                    except httpx.RequestError as exc:
                        res = None
                        request_errors.append(str(exc))
                    elapsed = perf_counter() - started
                    samples.append(elapsed)
                    status_codes.append(res.status_code if res is not None else None)

                    if res is None or res.status_code >= 400:
                        endpoint_failed = True
                        if res is not None:
                            last_error_status = res.status_code

                p95 = percentile_95(samples)
                median = sorted(samples)[len(samples) // 2]
                minimum = min(samples)
                maximum = max(samples)
                passed = p95 < threshold and not endpoint_failed

                report["endpoints"].append(
                    {
                        "name": endpoint["name"],
                        "path": url,
                        "scenario": (
                            "overloaded"
                            if "Overloaded" in endpoint["name"]
                            else "feasible"
                            if is_gen
                            else None
                        ),
                        "threshold_seconds": threshold,
                        "warmup_seconds": warmup_elapsed,
                        "warmup_status_code": warm_res.status_code,
                        "warmup_error": None,
                        "sample_seconds": samples,
                        "status_codes": sorted({code for code in status_codes if code is not None}),
                        "request_errors": request_errors,
                        "minimum_seconds": minimum,
                        "median_seconds": median,
                        "maximum_seconds": maximum,
                        "p95_seconds": p95,
                        "status": "passed" if passed else "failed",
                    }
                )

                if not passed:
                    failed = True
                    if endpoint_failed:
                        status_str = (
                            f"❌ FAIL (HTTP {last_error_status})"
                            if last_error_status is not None
                            else "❌ FAIL (request error)"
                        )
                    else:
                        status_str = f"❌ FAIL (P95 >= {threshold:.1f}s)"
                else:
                    status_str = "✅ PASS"

                print(
                    f"| {endpoint['name']} | {minimum:.4f}s | {median:.4f}s | {maximum:.4f}s | "
                    f"**{p95:.4f}s** | {threshold:.1f}s | {status_str} |"
                )

            print()
            report["status"] = "failed" if failed else "passed"
            report["finished_at"] = datetime.now(UTC).isoformat()
            write_json_report(json_output, report)
            if failed:
                print("❌ NFR-02 Performance Gate FAILED.")
                return 1
            else:
                print("✅ NFR-02 Performance Gate PASSED.")
                return 0
    except httpx.RequestError as exc:
        print(f"Connection error to {base_url}: {exc}", file=sys.stderr)
        report["error"] = str(exc)
        report["finished_at"] = datetime.now(UTC).isoformat()
        write_json_report(json_output, report)
        return 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Run NFR-02 full-stack HTTP benchmark")
    parser.add_argument(
        "--base-url",
        type=str,
        default="http://127.0.0.1:8000",
        help="Frontend origin or backend base URL",
    )
    parser.add_argument(
        "--runs",
        type=int,
        default=20,
        help="Number of measured runs per endpoint (default: 20)",
    )
    parser.add_argument(
        "--page-threshold",
        type=float,
        default=3.0,
        help="Max p95 latency for main pages/queries in seconds (default: 3.0)",
    )
    parser.add_argument(
        "--generation-threshold",
        type=float,
        default=5.0,
        help="Max p95 latency for schedule generation in seconds (default: 5.0)",
    )
    parser.add_argument(
        "--json-output",
        type=str,
        help="Write raw samples and summary statistics to this JSON file",
    )
    parser.add_argument(
        "--email",
        type=str,
        default=os.environ.get("NFR02_BENCHMARK_EMAIL"),
        help="Student account email (also settable via NFR02_BENCHMARK_EMAIL)",
    )
    parser.add_argument(
        "--password",
        type=str,
        default=os.environ.get("NFR02_BENCHMARK_PASSWORD"),
        help="Student account password (also settable via NFR02_BENCHMARK_PASSWORD)",
    )

    args = parser.parse_args()
    if args.runs < 1:
        parser.error("--runs must be at least 1")
    if not args.email:
        parser.error("--email or NFR02_BENCHMARK_EMAIL is required")
    if not args.password:
        parser.error("--password or NFR02_BENCHMARK_PASSWORD is required")
    return asyncio.run(
        run_http_benchmark(
            base_url=args.base_url,
            runs=args.runs,
            page_threshold_seconds=args.page_threshold,
            generation_threshold_seconds=args.generation_threshold,
            email=args.email,
            password=args.password,
            json_output=args.json_output,
        )
    )


if __name__ == "__main__":
    sys.exit(main())
