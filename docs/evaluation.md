# StudyFlow Thesis Evaluation & Performance Tooling Guide

This document describes the tooling and execution procedures for thesis evaluation (§24), performance gates (NFR-02), static-versus-adaptive comparisons (§24.6), and pseudonymized data export (§24.4).

---

## 1. Dedicated Evaluation Environment (§24.4)

To run tests against an isolated evaluation deployment:

1. Copy the evaluation environment template:
   ```bash
   cp .env.evaluation.example .env
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

To measure 20 warm runs across all core endpoints (`/tasks`, `/availability`, `/schedule-proposals/current`, `/progress`, and `/schedule-proposals/generate`) to ensure query routes meet $p95 < 3.0\text{s}$ and generation meets $p95 < 5.0\text{s}$:

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
