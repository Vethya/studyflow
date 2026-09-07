"""Run the full-stack HTTP and page usability benchmark gate per SPEC NFR-02."""

import argparse
import asyncio
import sys
from datetime import UTC, datetime, timedelta
from math import ceil
from time import perf_counter
from typing import Any

import httpx

BENCHMARK_EMAIL = "nfr02_benchmark@studyflow.local"
BENCHMARK_PASSWORD = "BenchmarkPassword123!"
EXPECTED_TASK_COUNT = 50
EXPECTED_SESSION_COUNT = 250
EXPECTED_AVAILABILITY_WINDOW_COUNT = 5
EXPECTED_UNAVAILABLE_PERIOD_COUNT = 50


def response_status(response: httpx.Response) -> str | None:
    """Read a schedule proposal status without assuming every response is JSON."""
    try:
        payload = response.json()
    except ValueError:
        return None
    status_value = payload.get("status") if isinstance(payload, dict) else None
    return status_value if isinstance(status_value, str) else None


def validate_nfr02_dataset(
    tasks: list[Any],
    sessions: list[Any],
    availability_windows: list[Any],
    unavailable_periods: list[Any],
) -> str | None:
    """Validate the seeded NFR-02 workload before collecting timings."""
    counts = (
        ("tasks", len(tasks), EXPECTED_TASK_COUNT),
        ("sessions", len(sessions), EXPECTED_SESSION_COUNT),
        ("availability windows", len(availability_windows), EXPECTED_AVAILABILITY_WINDOW_COUNT),
        ("unavailable periods", len(unavailable_periods), EXPECTED_UNAVAILABLE_PERIOD_COUNT),
    )
    for name, actual, expected in counts:
        if actual != expected:
            return f"Expected {expected} {name}, found {actual}."

    deadlines: list[datetime] = []
    for task in tasks:
        if not isinstance(task, dict) or not isinstance(task.get("deadline_at"), str):
            return "Tasks must include ISO-8601 deadline_at values."
        try:
            deadlines.append(datetime.fromisoformat(task["deadline_at"].replace("Z", "+00:00")))
        except ValueError:
            return "Tasks must include valid ISO-8601 deadline_at values."
    if max(deadlines) - min(deadlines) < timedelta(days=100):
        return "Task deadlines must span the documented 16-week benchmark horizon."
    return None


def percentile_95(samples: list[float]) -> float:
    return sorted(samples)[ceil(len(samples) * 0.95) - 1]


async def run_http_benchmark(
    base_url: str,
    runs: int = 20,
    page_threshold_seconds: float = 3.0,
    generation_threshold_seconds: float = 5.0,
    email: str = BENCHMARK_EMAIL,
    password: str = BENCHMARK_PASSWORD,
) -> int:
    """Measure warm response latencies against live API endpoints with seeded NFR-02 data."""
    if runs <= 0:
        print("Error: runs must be greater than zero.", file=sys.stderr)
        return 1
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
                    "Make sure you have seeded the database first using:\n"
                    "  uv run python benchmarks/seed_nfr02.py",
                    file=sys.stderr,
                )
                return 1

            csrf_token = login_res.json().get("csrf_token")
            headers = {"X-CSRF-Token": csrf_token} if csrf_token else {}

            dataset_requests = {
                "tasks": "/api/v1/tasks",
                "sessions": "/api/v1/study-sessions",
                "availability windows": "/api/v1/availability/windows",
                "unavailable periods": "/api/v1/availability/unavailable-periods",
            }
            dataset: dict[str, list[Any]] = {}
            for name, url in dataset_requests.items():
                dataset_res = await client.get(url, headers=headers)
                if dataset_res.status_code != 200:
                    print(
                        f"Error: Dataset preflight failed for {name} "
                        f"(HTTP {dataset_res.status_code}).",
                        file=sys.stderr,
                    )
                    return 1
                payload = dataset_res.json()
                if not isinstance(payload, list):
                    print(
                        f"Error: Dataset preflight expected a list for {name}.",
                        file=sys.stderr,
                    )
                    return 1
                dataset[name] = payload

            dataset_error = validate_nfr02_dataset(
                tasks=dataset["tasks"],
                sessions=dataset["sessions"],
                availability_windows=dataset["availability windows"],
                unavailable_periods=dataset["unavailable periods"],
            )
            if dataset_error is not None:
                print(f"Error: Dataset preflight failed: {dataset_error}", file=sys.stderr)
                return 1

            now_utc = datetime.now(UTC)
            overload_deadline = (now_utc + timedelta(days=2)).isoformat()
            overload_payload: dict[str, Any] = {
                "scenario": {
                    "deadline_overrides": [
                        {"task_id": task["id"], "deadline_at": overload_deadline}
                        for task in dataset["tasks"][:20]
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
                    "expected_status": "feasible",
                },
                {
                    "name": "Schedule Generation (Overloaded, 50 tasks)",
                    "method": "POST",
                    "url": "/api/v1/schedule-proposals",
                    "json": overload_payload,
                    "is_generation": True,
                    "expected_status": "overload",
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
                if method == "GET":
                    warm_res = await client.get(url, headers=headers)
                else:
                    warm_res = await client.post(url, headers=headers, json=payload)

                if warm_res.status_code >= 400:
                    print(
                        f"| {endpoint['name']} | - | - | - | - | {threshold:.1f}s | "
                        f"❌ FAIL (HTTP {warm_res.status_code}) |"
                    )
                    failed = True
                    continue
                expected_status = endpoint.get("expected_status")
                if expected_status is not None and response_status(warm_res) != expected_status:
                    print(
                        f"| {endpoint['name']} | - | - | - | - | {threshold:.1f}s | "
                        f"❌ FAIL (expected status {expected_status!r}, got "
                        f"{response_status(warm_res)!r}) |"
                    )
                    failed = True
                    continue

                samples: list[float] = []
                endpoint_failed = False
                last_error: str | None = None
                for _ in range(runs):
                    started = perf_counter()
                    if method == "GET":
                        res = await client.get(url, headers=headers)
                    else:
                        res = await client.post(url, headers=headers, json=payload)
                    elapsed = perf_counter() - started
                    samples.append(elapsed)

                    if res.status_code >= 400:
                        endpoint_failed = True
                        last_error = f"HTTP {res.status_code}"
                    elif expected_status is not None and response_status(res) != expected_status:
                        endpoint_failed = True
                        last_error = (
                            f"expected status {expected_status!r}, "
                            f"got {response_status(res)!r}"
                        )

                p95 = percentile_95(samples)
                median = sorted(samples)[len(samples) // 2]
                minimum = min(samples)
                maximum = max(samples)
                passed = p95 < threshold and not endpoint_failed

                if not passed:
                    failed = True
                    if endpoint_failed:
                        status_str = f"❌ FAIL ({last_error})"
                    else:
                        status_str = f"❌ FAIL (P95 >= {threshold:.1f}s)"
                else:
                    status_str = "✅ PASS"

                print(
                    f"| {endpoint['name']} | {minimum:.4f}s | {median:.4f}s | {maximum:.4f}s | "
                    f"**{p95:.4f}s** | {threshold:.1f}s | {status_str} |"
                )

            print()
            if failed:
                print("❌ NFR-02 Performance Gate FAILED.")
                return 1
            else:
                print("✅ NFR-02 Performance Gate PASSED.")
                return 0
    except (httpx.ConnectError, httpx.TimeoutException) as exc:
        print(f"Connection error to {base_url}: {exc}", file=sys.stderr)
        return 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Run NFR-02 full-stack HTTP benchmark")
    parser.add_argument(
        "--base-url",
        type=str,
        default="http://127.0.0.1:8000",
        help="Backend base URL",
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
    parser.add_argument("--email", type=str, default=BENCHMARK_EMAIL)
    parser.add_argument("--password", type=str, default=BENCHMARK_PASSWORD)

    args = parser.parse_args()
    return asyncio.run(
        run_http_benchmark(
            base_url=args.base_url,
            runs=args.runs,
            page_threshold_seconds=args.page_threshold,
            generation_threshold_seconds=args.generation_threshold,
            email=args.email,
            password=args.password,
        )
    )


if __name__ == "__main__":
    sys.exit(main())
