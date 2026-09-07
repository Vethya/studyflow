# StudyFlow Thesis Evaluation & Performance Tooling Guide

This document describes the tooling and execution procedures for thesis evaluation (§24), performance gates (NFR-02), static-versus-adaptive comparisons (§24.6), and pseudonymized data export (§24.4).

---

## 1. Dedicated Evaluation Environment (§24.4)

To run tests against an isolated evaluation deployment:

1. Copy the evaluation environment template:
   ```bash
   cp .env.evaluation.example backend/.env
   ```
2. Start the isolated evaluation stack (separate project, ports, and volume):
   ```bash
   docker compose -f compose.yaml -f compose.evaluation.yaml \
     --env-file .env.evaluation.example up --build -d
   ```
3. Apply database migrations (already run by the `migrate` service; rerun when needed):
   ```bash
   cd backend
   uv run alembic upgrade head
   ```
4. The evaluation API is available at `http://127.0.0.1:18000`. Stop it without deleting
   evaluation data with:
   ```bash
   docker compose -f compose.yaml -f compose.evaluation.yaml \
     --env-file .env.evaluation.example down
   ```

The evaluation database is exposed to host-side seed/export commands at port `55432`:

```bash
cd backend
uv run python benchmarks/seed_evaluation.py \
  --database-url postgresql+psycopg://studyflow_eval:studyflow_eval@127.0.0.1:55432/studyflow_eval
```

For a host-side application run instead of Compose:
   ```bash
   uv run uvicorn studyflow.app:app --port 8000
   ```

---

## 2. NFR-02 Performance Benchmark Suite

### 2.0 Seed the deterministic evaluation dataset (§24.1)

After applying migrations, seed the dedicated evaluation database with five pseudonymous
participants, availability inputs, tasks, schedules, outcomes, five completed adaptive
predictions per participant, and one pending prediction per participant:

```bash
cd backend
uv run python benchmarks/seed_evaluation.py
```

The seed is deterministic and repeatable. It only removes rows belonging to its own dataset.
Export it with the command in section 4; pending actual durations remain `null`.

### 2.1 Seed NFR-02 Representative Workload

To seed the exact SPEC NFR-02 workload (1 student, 50 active tasks, 250 study sessions, 16-week horizon, 50 unavailable periods):

```bash
cd backend
uv run python benchmarks/seed_nfr02.py
```

Default benchmark credentials:
- **Email:** `nfr02_benchmark@studyflow.local`
- **Password:** `BenchmarkPassword123!`

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
uv run python benchmarks/http_performance.py --base-url http://127.0.0.1:8000 --runs 20
```

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

The JSON export includes pseudonymized `evaluation_records`, per-participant `evaluation_metrics`
(sample count, MAE, signed bias, and MAE reduction), recurring availability, and unavailable
period inputs. The CSV export adds per-task actual/error fields. No email, name, password, task
title, course, notes, account ID, or raw resource UUID is exported.

## 5. Isolation verification (§18.3 / NFR-01)

Run the HTTP-level two-account ownership matrix:

```bash
cd backend
uv run pytest tests/test_cross_user_isolation.py
```

It checks read isolation and mutation rejection for tasks, availability, unavailable periods,
study sessions/outcomes, schedule proposals, progress, and account profile/preferences.
