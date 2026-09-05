"""Run the full-stack HTTP and page usability benchmark gate per SPEC NFR-02."""

import argparse
import asyncio
import sys
from math import ceil
from time import perf_counter
from typing import Any

import httpx

BENCHMARK_EMAIL = "nfr02_benchmark@studyflow.local"
BENCHMARK_PASSWORD = "BenchmarkPassword123!"


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
                    "url": "/api/v1/availability/unavailable",
                },
                {
                    "name": "Current Schedule (250 sessions)",
                    "method": "GET",
                    "url": "/api/v1/schedule-proposals/current",
                },
                {"name": "Effort Progress", "method": "GET", "url": "/api/v1/progress"},
                {
                    "name": "Schedule Generation (50 tasks)",
                    "method": "POST",
                    "url": "/api/v1/schedule-proposals/generate",
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
                is_gen = endpoint.get("is_generation", False)
                threshold = generation_threshold_seconds if is_gen else page_threshold_seconds

                # Warm-up run
                if method == "GET":
                    warm_res = await client.get(url, headers=headers)
                else:
                    warm_res = await client.post(url, headers=headers)

                if warm_res.status_code >= 500:
                    print(f"Server error on warm-up for {endpoint['name']}: {warm_res.status_code}")
                    failed = True
                    continue

                samples: list[float] = []
                for _ in range(runs):
                    started = perf_counter()
                    if method == "GET":
                        res = await client.get(url, headers=headers)
                    else:
                        res = await client.post(url, headers=headers)
                    elapsed = perf_counter() - started
                    samples.append(elapsed)

                    if res.status_code >= 500:
                        failed = True

                p95 = percentile_95(samples)
                median = sorted(samples)[len(samples) // 2]
                minimum = min(samples)
                maximum = max(samples)
                passed = p95 <= threshold and not any(s >= 500 for s in samples)

                status_str = "✅ PASS" if passed else "❌ FAIL"
                if not passed:
                    failed = True

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
