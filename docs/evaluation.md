# StudyFlow Thesis Evaluation & Performance Tooling Guide

This document describes the tooling and execution procedures for thesis evaluation (§24), performance gates (NFR-02), static-versus-adaptive comparisons (§24.6), and pseudonymized data export (§24.4).

---

## 1. Dedicated Evaluation Environment (§24.4)

To run tests against an isolated evaluation deployment:

1. Copy the evaluation environment template:
   ```bash
   cp .env.evaluation.example backend/.env
   ```
2. Apply database migrations:
   ```bash
   cd backend
   uv run alembic upgrade head
   ```
3. Start the application in evaluation mode:
   ```bash
   uv run uvicorn studyflow.app:app --port 8000
   ```

---

## 2. NFR-02 Performance Benchmark Suite

### 2.1 Seed NFR-02 Representative Workload

To seed the exact SPEC NFR-02 workload (1 student, 50 active tasks, 250 study sessions, 16-week horizon, 50 unavailable periods):

```bash
cd backend
NFR02_BENCHMARK_EMAIL='<existing-dev-account-email>' \
uv run python benchmarks/seed_nfr02.py
```

The seeder targets an existing student account, preserves its password and
profile, and refuses to mix benchmark rows with other student data. If the
complete NFR-02 dataset is already present, it skips seeding. The account's
real password is supplied separately to the HTTP benchmark; it is never
changed or printed by the seeder.

### 2.2 In-Memory Scheduler Kernel Performance Gate (NFR-02-AC02)

To verify that schedule generation completes within 5.0 seconds at the 95th percentile under warm conditions:

```bash
cd backend
uv run python benchmarks/scheduler_performance.py --runs 20 --threshold-seconds 5.0
```

### 2.3 Full-Stack HTTP & Page Usability Benchmark (NFR-02-AC01 & AC03)

To measure 20 warm runs across core endpoints (`/tasks`, `/availability/windows`, `/availability/unavailable-periods`, `/study-sessions`, `/schedule-proposals/current`, `/progress`, and `POST /schedule-proposals` for feasible and overloaded scenarios) to ensure query routes meet $p95 < 3.0\text{s}$ and generation meets $p95 < 5.0\text{s}$:

```bash
cd backend
NFR02_BENCHMARK_EMAIL='<existing-dev-account-email>' \
NFR02_BENCHMARK_PASSWORD='<existing-dev-account-password>' \
uv run python benchmarks/http_performance.py --base-url http://127.0.0.1:8000 --runs 20
```

The overloaded request keeps the complete seeded workload and sets five task
deadlines to approximately two hours from the benchmark start. This is a
clearly overloaded scenario while preserving the required 50-task/250-session
dataset; deadline overrides are rounded to an exact UTC minute for API
validation.

### 2.4 Complete dev-environment evidence run

The final NFR-02 evidence run uses one isolated dev environment:

```text
dev frontend -> dev backend deployment -> dev database
```

The deployment must already be warm. The runner checks `/api/v1/ready` and
stops if the readiness check exceeds its warm limit. It does not start or wake
the deployment, and it does not use the local `backend/.env` database by
accident.

From the repository root, provide the dev database URL explicitly:

```bash
NFR02_DATABASE_URL='postgresql+psycopg://<dev-database-url>' \
NFR02_BENCHMARK_EMAIL='<existing-dev-account-email>' \
NFR02_BENCHMARK_PASSWORD='<existing-dev-account-password>' \
NFR02_DEPLOYED_REVISION='<git-sha-deployed-at-the-dev-frontend-url>' \
python3 scripts/run_nfr02_evidence.py \
  --base-url https://<dev-frontend-url>
```

The command seeds the dev database, measures each main page and the HTTP
endpoints for 20 runs, covers feasible and overloaded schedule generation, and
writes `docs/evidence/nfr02-performance-YYYY-MM-DD.md`. The report includes
the measured p95 values, frontend URL, safe database target, browser, viewport,
machine, deployed Git revision, benchmark checkout revision, workload, and
pass/fail status. Set `NFR02_DEPLOYED_REVISION` to the exact commit SHA shown by
the dev frontend deployment. The runner rejects a missing or malformed SHA.

The browser benchmark uses the installed Google Chrome application through
Playwright's `chrome` channel. It does not download a separate Playwright
Chromium binary.

---

## 3. Static vs Adaptive Technical Comparison Tool (§24.6)

SPEC §24.6 requires measuring the technical trade-offs between static scheduling (original estimates only) and adaptive scheduling (learned duration adjustments) on identical task snapshots.

Run the comparison simulator:

```bash
cd backend
uv run python benchmarks/compare_static_adaptive.py --json-output ../docs/static_vs_adaptive_results.json
```

### Measured §24.6 Metrics:
1. **Estimation Accuracy & Bias:**
   - Original Estimate MAE vs Adaptive Estimate MAE
   - Relative MAE reduction percentage
   - Signed estimation bias ($\frac{1}{N}\sum (\text{Estimated} - \text{Actual})$)
2. **Feasibility & Constraints:**
   - Hard-constraint violations (overlaps, break-time violations)
   - Deadline feasibility & overload status
3. **Schedule Stability / Disruption Metrics:**
   - Sessions moved
   - Total absolute minutes shifted
   - Sessions added / removed
   - Unscheduled minutes

---

## 4. Evaluation Data Export Command (§24.4)

SPEC §24.4 mandates backend CLI export against the dedicated evaluation environment without creating an admin dashboard. All participant identifiers are deterministically pseudonymized, and personal identifiable information (emails, names, passwords) is strictly excluded.

### Export as JSON:
```bash
cd backend
uv run python -m studyflow.cli.export_evaluation --output evaluation_data.json
```

### Export as CSV:
```bash
cd backend
uv run python -m studyflow.cli.export_evaluation --format csv --output evaluation_tasks.csv
```

### Filter for a Specific Participant:
```bash
cd backend
uv run python -m studyflow.cli.export_evaluation --account-id <uuid> --output participant_eval.json
```
