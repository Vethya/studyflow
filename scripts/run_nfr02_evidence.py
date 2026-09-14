#!/usr/bin/env python3
"""Run the NFR-02 evidence suite against one already-warm dev environment."""

from __future__ import annotations

import argparse
import json
import os
import platform
import shlex
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
def parse_args() -> argparse.Namespace:
    today = datetime.now(UTC).date().isoformat()
    parser = argparse.ArgumentParser(
        description="Run NFR-02 performance evidence against one warm dev environment."
    )
    parser.add_argument("--base-url", required=True, help="Dev frontend URL")
    parser.add_argument(
        "--database-url",
        default=os.environ.get("NFR02_DATABASE_URL"),
        help="Dev database URL; alternatively set NFR02_DATABASE_URL",
    )
    parser.add_argument(
        "--report",
        type=Path,
        default=ROOT / "docs" / "evidence" / f"nfr02-performance-{today}.md",
        help="Markdown report path",
    )
    parser.add_argument("--runs", type=int, default=20)
    parser.add_argument("--page-threshold", type=float, default=3.0)
    parser.add_argument("--generation-threshold", type=float, default=5.0)
    parser.add_argument("--readiness-timeout", type=float, default=5.0)
    parser.add_argument(
        "--email",
        default=os.environ.get("NFR02_BENCHMARK_EMAIL"),
        help="Existing student account email; alternatively set NFR02_BENCHMARK_EMAIL",
    )
    parser.add_argument(
        "--password",
        default=os.environ.get("NFR02_BENCHMARK_PASSWORD"),
        help="Existing student account password; alternatively set NFR02_BENCHMARK_PASSWORD",
    )
    args = parser.parse_args()
    if not args.database_url:
        parser.error("--database-url or NFR02_DATABASE_URL is required")
    if not args.email:
        parser.error("--email or NFR02_BENCHMARK_EMAIL is required")
    if not args.password:
        parser.error("--password or NFR02_BENCHMARK_PASSWORD is required")
    if args.runs < 1:
        parser.error("--runs must be at least 1")
    return args


def run_command(command: list[str], cwd: Path, environment: dict[str, str]) -> None:
    printable = " ".join(shlex.quote(part) for part in command)
    print(f"\n$ (cd {cwd} && {printable})")
    result = subprocess.run(  # noqa: S603 - fixed commands, no shell evaluation
        command, cwd=cwd, env=environment, check=False
    )
    if result.returncode != 0:
        raise RuntimeError(f"Command failed with exit code {result.returncode}: {printable}")


def check_ready(base_url: str, timeout_seconds: float) -> float:
    url = f"{base_url.rstrip('/')}/api/v1/ready"
    if urlsplit(base_url).scheme not in {"http", "https"}:
        raise RuntimeError("--base-url must use http or https")
    request = urllib.request.Request(  # noqa: S310 - scheme is checked above
        url, headers={"Accept": "application/json"}
    )
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(  # noqa: S310 - scheme is checked above
            request, timeout=timeout_seconds
        ) as response:
            status_code = response.status
            response.read()
    except (urllib.error.URLError, TimeoutError) as exc:
        raise RuntimeError(
            f"Dev deployment is not ready: {exc}. Warm it before starting the benchmark."
        ) from exc
    elapsed = time.perf_counter() - started
    if status_code != 200:
        raise RuntimeError(f"Dev deployment readiness returned HTTP {status_code}")
    if elapsed > timeout_seconds:
        raise RuntimeError(
            f"Readiness took {elapsed:.2f}s, exceeding the warm check limit of "
            f"{timeout_seconds:.2f}s. Warm the dev deployment and retry."
        )
    return elapsed


def git_revision() -> str:
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],  # noqa: S607 - git is a required local dependency
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    return result.stdout.strip() if result.returncode == 0 else "unknown"


def safe_database_target(database_url: str) -> str:
    parsed = urlsplit(database_url)
    host = parsed.hostname or "unknown-host"
    database = parsed.path.lstrip("/") or "unknown-database"
    return f"{host}/{database}"


def seconds(value: float | None) -> str:
    return "-" if value is None else f"{value:.4f}s"


def result_status(value: str) -> str:
    return "PASS" if value == "passed" else "FAIL"


def render_report(
    args: argparse.Namespace,
    http_report: dict[str, object],
    page_report: dict[str, object],
    readiness_seconds: float,
) -> str:
    page_rows = page_report.get("pages", [])
    endpoint_rows = http_report.get("endpoints", [])
    page_lines = [
        "| Page | Min | Median | Max | p95 | Limit | Result |",
        "| :--- | ---: | ---: | ---: | ---: | ---: | :--- |",
    ]
    for row in page_rows:
        page_lines.append(
            f"| {row['name']} | {seconds(row.get('minimum_seconds'))} | "
            f"{seconds(row.get('median_seconds'))} | {seconds(row.get('maximum_seconds'))} | "
            f"{seconds(row.get('p95_seconds'))} | < {args.page_threshold:.1f}s | "
            f"{result_status(row['status'])} |"
        )

    endpoint_lines = [
        "| Endpoint | Scenario | Min | Median | Max | p95 | Limit | Result |",
        "| :--- | :--- | ---: | ---: | ---: | ---: | ---: | :--- |",
    ]
    for row in endpoint_rows:
        endpoint_lines.append(
            f"| {row['name']} | {row.get('scenario') or '-'} | "
            f"{seconds(row.get('minimum_seconds'))} | {seconds(row.get('median_seconds'))} | "
            f"{seconds(row.get('maximum_seconds'))} | {seconds(row.get('p95_seconds'))} | "
            f"< {row['threshold_seconds']:.1f}s | {result_status(row['status'])} |"
        )

    machine = (
        f"{platform.system()} {platform.release()} ({platform.machine()}), "
        f"{os.cpu_count() or 'unknown'} logical CPUs"
    )
    browser = page_report.get("browser", {})
    viewport = page_report.get("viewport", {})
    browser_details = (
        f"{browser.get('engine', 'unknown')} {browser.get('version', 'unknown')}, "
        f"user agent `{browser.get('user_agent', 'unknown')}`"
    )
    viewport_details = f"{viewport.get('width', '?')}x{viewport.get('height', '?')} CSS pixels"
    overall_status = (
        "PASS"
        if http_report.get("status") == "passed" and page_report.get("status") == "passed"
        else "FAIL"
    )
    return f"""# NFR-02 performance evidence

Status: **{overall_status}**
Measured at: `{datetime.now(UTC).isoformat()}`
Git revision: `{git_revision()}`

## Test conditions

- Environment: dev only
- Frontend URL: `{args.base_url}`
- Database target: `{safe_database_target(args.database_url)}`
- Machine: {machine}
- Browser: {browser_details}
- Viewport: {viewport_details}
- Readiness check: `{readiness_seconds:.4f}s` before seeding and measurement
- Warm-up: one unmeasured run per endpoint and page
- Measured runs: `{args.runs}` per endpoint and page
- Seeded workload: one student, 50 active tasks, up to 250 sessions, 16-week horizon,
  50 unavailable periods

## Main-page usability

Measurement runs from page navigation until the main heading is visible, the
expected seeded API data has arrived, and loading placeholders have disappeared.

{chr(10).join(page_lines)}

## HTTP and schedule-generation response times

{chr(10).join(endpoint_lines)}

The HTTP benchmark also fails the run when a measured request returns a server error or times out.
The feasible and overloaded schedule rows use the same seeded workload.
"""


def main() -> int:
    args = parse_args()
    base_url = args.base_url.rstrip("/")
    environment = os.environ.copy()
    # This explicit override prevents backend/.env on the operator's machine
    # from selecting a different database during the dev evidence run.
    environment["STUDYFLOW_DATABASE_URL"] = args.database_url
    environment["NFR02_BENCHMARK_EMAIL"] = args.email
    environment["NFR02_BENCHMARK_PASSWORD"] = args.password

    with tempfile.TemporaryDirectory(prefix="studyflow-nfr02-") as temporary_directory:
        temporary = Path(temporary_directory)
        http_json = temporary / "http.json"
        page_json = temporary / "pages.json"

        readiness_seconds = check_ready(base_url, args.readiness_timeout)
        run_command(
            ["uv", "run", "python", "benchmarks/seed_nfr02.py"],
            BACKEND,
            environment,
        )
        run_command(
            [
                "uv",
                "run",
                "python",
                "benchmarks/http_performance.py",
                "--base-url",
                base_url,
                "--runs",
                str(args.runs),
                "--page-threshold",
                str(args.page_threshold),
                "--generation-threshold",
                str(args.generation_threshold),
                "--json-output",
                str(http_json),
            ],
            BACKEND,
            environment,
        )
        run_command(
            [
                "pnpm",
                "exec",
                "node",
                "benchmarks/page_performance.mjs",
                "--base-url",
                base_url,
                "--runs",
                str(args.runs),
                "--threshold",
                str(args.page_threshold),
                "--json-output",
                str(page_json),
            ],
            FRONTEND,
            environment,
        )

        http_report = json.loads(http_json.read_text(encoding="utf-8"))
        page_report = json.loads(page_json.read_text(encoding="utf-8"))
        report = render_report(args, http_report, page_report, readiness_seconds)
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(report, encoding="utf-8")
        print(f"\nWrote NFR-02 evidence report to {args.report}")

        return 0 if "Status: **PASS**" in report else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, FileNotFoundError, json.JSONDecodeError) as exc:
        print(f"NFR-02 evidence run failed: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
