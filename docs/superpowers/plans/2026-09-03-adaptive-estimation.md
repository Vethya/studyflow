# Adaptive Estimation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the transparent, evidence-gated adaptive duration estimator across backend persistence, APIs, task creation, and the existing frontend explanation and choice UI.

**Architecture:** A pure estimator owns chronological median correction and MAE qualification. A repository persists immutable pre-task predictions and category acknowledgments, while task creation stores the server-authoritative estimate snapshot in the same transaction. A dedicated API exposes only student-safe preview fields; the frontend keeps original and selected planned source separate.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2, Alembic, PostgreSQL/SQLite tests, pytest, Next.js 16, TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-09-03-session-outcomes-adaptive-estimation-design.md`

## Global Constraints

- Use only behavior available before the predicted task.
- Tasks 1-5 have no prediction; tasks 6 onward may have chronological shadow predictions.
- Use category history at five eligible category completions, otherwise overall history.
- Use the latest 20 applicable ratios and do not cap the factor.
- Expose Adaptive only after at least five eligible predictions and a 10% MAE advantage.
- Reassess with the latest ten predictions once ten exist.
- Preserve Original Estimate; never send Adaptive as `original_estimate_minutes`.
- Do not expose internal MAE, bias, prediction error, or hidden prediction status to students.
- Do not modify unrelated untracked review, presentation, extension, or temporary files.

---

### Task 1: Normalize the Alembic Graph

**Files:**
- Create: `backend/migrations/versions/20260903_16_merge_outcomes_and_scenarios.py`
- Test: `backend/tests/test_migrations.py`

**Interfaces:**
- Consumes: revision heads `20260901_15` and `20260903_15`.
- Produces: one no-op merge head `20260903_16` for the adaptive schema migration.

- [ ] **Step 1: Add a failing single-head assertion**

Extend `test_migrations.py` to load the Alembic `ScriptDirectory` and assert
`script.get_heads() == ["20260903_16"]`.

- [ ] **Step 2: Run the focused migration test and verify red**

Run: `uv run pytest tests/test_migrations.py -q`
Expected: FAIL because two heads exist.

- [ ] **Step 3: Add the merge revision**

Create a revision with:

```py
revision = "20260903_16"
down_revision = ("20260901_15", "20260903_15")

def upgrade() -> None:
    pass

def downgrade() -> None:
    pass
```

- [ ] **Step 4: Run the focused migration test and verify green**

Run: `uv run pytest tests/test_migrations.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/migrations/versions/20260903_16_merge_outcomes_and_scenarios.py backend/tests/test_migrations.py
git commit -m "chore(backend): merge migration heads"
```

---

### Task 2: Pure Median-Correction Estimator

**Files:**
- Create: `backend/src/studyflow/estimation/__init__.py`
- Create: `backend/src/studyflow/estimation/model.py`
- Create: `backend/tests/test_adaptive_estimation.py`

**Interfaces:**
- Produces: `HistoryRecord`, `PredictionEvaluation`, `CorrectionPrediction`,
  `median_correction(history, category, original_minutes)`, and
  `qualifies(predictions)`.

- [ ] **Step 1: Write failing estimator tests**

Cover no prediction before five history records, latest-20 selection, category use after five,
overall fallback, odd/even median, half-up minute rounding, uncapped factors, and stable ordering.
Use concrete histories such as five overall ratios `[1, 1, 1.5, 2, 4]`, whose median is `1.5`.

- [ ] **Step 2: Run the estimator tests and verify red**

Run: `uv run pytest tests/test_adaptive_estimation.py -q`
Expected: FAIL because the estimation package does not exist.

- [ ] **Step 3: Implement immutable estimator contracts**

Use `dataclass(frozen=True, slots=True)`, `Decimal`, and `ROUND_HALF_UP`. Return `None` when fewer
than five eligible history records exist. Sort by `(completed_at, task_id)` before taking the
latest 20.

- [ ] **Step 4: Add failing qualification tests**

Verify five-prediction activation at exactly a 10% MAE improvement, non-activation below that
threshold, no activation when original MAE is zero, latest-ten selection, and dequalification.

- [ ] **Step 5: Implement qualification**

Filter to completed predictions with positive actual minutes, take all when count is 5-9 and the
latest ten when count is at least ten, then require:

```py
adaptive_mae <= original_mae * Decimal("0.90")
```

- [ ] **Step 6: Run tests and static checks**

Run: `uv run pytest tests/test_adaptive_estimation.py -q`
Expected: PASS.

Run: `uv run ruff check src/studyflow/estimation tests/test_adaptive_estimation.py`
Expected: PASS.

Run: `uv run mypy`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/studyflow/estimation backend/tests/test_adaptive_estimation.py
git commit -m "feat(backend): add adaptive correction model"
```

---

### Task 3: Prediction and Acknowledgment Persistence

**Files:**
- Modify: `backend/src/studyflow/database/models/tasks.py`
- Modify: `backend/src/studyflow/database/models/__init__.py`
- Create: `backend/migrations/versions/20260903_17_adaptive_estimation.py`
- Create: `backend/src/studyflow/estimation/repositories.py`
- Create: `backend/tests/test_adaptive_estimation_repository.py`

**Interfaces:**
- Produces: `AdaptivePredictionRepository` and `SqlAlchemyAdaptivePredictionRepository` methods
  `history`, `evaluations`, `save_prediction`, `replace_prediction`, `acknowledgment`, and
  `acknowledge`.

- [ ] **Step 1: Write failing repository tests**

Test account isolation, deterministic completion order, latest-20 history, immutable task-linked
predictions, replacement only for unfrozen tasks, and category acknowledgment persistence.

- [ ] **Step 2: Run focused tests and verify red**

Run: `uv run pytest tests/test_adaptive_estimation_repository.py -q`
Expected: FAIL because the models and repository do not exist.

- [ ] **Step 3: Add persistence models and constraints**

Add `AdaptiveEstimationPrediction` keyed by `task_id` with account/category indexes, positive
original/predicted checks, positive decimal factor, scope in `overall|category`, positive
history count, exposed boolean, and timestamp. Add `AdaptiveEstimationAcknowledgment` with a
composite account/category key, positive factor, and timestamp.

- [ ] **Step 4: Add the adaptive schema migration**

Set `down_revision = "20260903_16"`, create both tables and indexes, and implement a complete
downgrade that removes them in reverse dependency order.

- [ ] **Step 5: Implement repository queries**

Join tasks, sessions, and confirmed outcomes to calculate positive Actual Duration. Never create
historical predictions in a query. Lock the account row for create/replace/acknowledge operations.

- [ ] **Step 6: Run persistence and migration tests**

Run: `uv run pytest tests/test_adaptive_estimation_repository.py tests/test_migrations.py -q`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/studyflow/database/models backend/src/studyflow/estimation/repositories.py backend/migrations/versions/20260903_17_adaptive_estimation.py backend/tests/test_adaptive_estimation_repository.py backend/tests/test_migrations.py
git commit -m "feat(backend): persist adaptive predictions"
```

---

### Task 4: Adaptive Estimation Service

**Files:**
- Create: `backend/src/studyflow/estimation/service.py`
- Modify: `backend/src/studyflow/estimation/__init__.py`
- Modify: `backend/tests/test_adaptive_estimation.py`

**Interfaces:**
- Produces: `AdaptiveEstimatePreview`, `AdaptiveEstimator.preview`,
  `AdaptiveEstimator.capture_for_task`, and `AdaptiveEstimator.acknowledge`.

- [ ] **Step 1: Write failing service tests**

Test hidden capture beginning on task 6, exposure only after qualification, category/overall scope,
default planned source, Original override, rejection of unavailable Adaptive selection, first
large-factor acknowledgment, and a repeat prompt at a 25% relative factor change.

- [ ] **Step 2: Run focused tests and verify red**

Run: `uv run pytest tests/test_adaptive_estimation.py -q`
Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement the service**

Use the pure estimator and repository. A preview never persists. Capture persists exactly one
chronological prediction and returns the server-authoritative adaptive minutes and source.
Acknowledgment recalculates the current factor; it never accepts a client factor.

- [ ] **Step 4: Run focused tests and verify green**

Run: `uv run pytest tests/test_adaptive_estimation.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/studyflow/estimation backend/tests/test_adaptive_estimation.py
git commit -m "feat(backend): gate adaptive estimates by evidence"
```

---

### Task 5: Task Persistence Integration

**Files:**
- Modify: `backend/src/studyflow/tasks/service.py`
- Modify: `backend/src/studyflow/tasks/repositories.py`
- Modify: `backend/src/studyflow/api/tasks.py`
- Modify: `backend/src/studyflow/app.py`
- Modify: `backend/tests/test_academic_task_service.py`
- Modify: `backend/tests/test_academic_task_repository.py`
- Modify: `backend/tests/test_academic_task_api.py`

**Interfaces:**
- Consumes: `AdaptiveEstimator.capture_for_task` and preview results.
- Produces: task requests with optional `planned_source`; task responses with
  `adaptive_estimate_minutes` and `planned_source`.

- [ ] **Step 1: Write failing service and API tests**

Assert backward-compatible Original behavior without qualification, default Adaptive after
qualification and acknowledgment, explicit Original selection, rejected unavailable Adaptive,
and unchanged estimate fields after freezing.

- [ ] **Step 2: Run focused tests and verify red**

Run: `uv run pytest tests/test_academic_task_service.py tests/test_academic_task_repository.py tests/test_academic_task_api.py -q`
Expected: FAIL on the new contract.

- [ ] **Step 3: Extend task contracts**

Add `PlannedDurationSource` with `ORIGINAL` and `ADAPTIVE`, optional selection on new/edit task
commands, and adaptive/source fields on `AcademicTaskRecord` and Pydantic responses.

- [ ] **Step 4: Integrate capture transactionally**

Create or update the task and its prediction under the same account lock. Store the true original,
the server-computed adaptive value when exposed, the selected source, and exactly matching planned
minutes. Preserve existing freeze and deadline behavior.

- [ ] **Step 5: Run focused and static checks**

Run: `uv run pytest tests/test_academic_task_service.py tests/test_academic_task_repository.py tests/test_academic_task_api.py -q`
Expected: PASS.

Run: `uv run ruff check src tests`
Expected: PASS.

Run: `uv run mypy`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/studyflow/tasks backend/src/studyflow/api/tasks.py backend/src/studyflow/app.py backend/tests/test_academic_task_service.py backend/tests/test_academic_task_repository.py backend/tests/test_academic_task_api.py
git commit -m "feat(backend): apply adaptive estimates to tasks"
```

---

### Task 6: Adaptive Estimate API

**Files:**
- Create: `backend/src/studyflow/api/adaptive_estimates.py`
- Modify: `backend/src/studyflow/api/router.py`
- Modify: `backend/src/studyflow/app.py`
- Create: `backend/tests/test_adaptive_estimate_api.py`
- Modify: `backend/tests/test_openapi.py`
- Modify: `postman/StudyFlow.postman_collection.json`

**Interfaces:**
- Produces: `GET /api/v1/adaptive-estimates/preview` and
  `POST /api/v1/adaptive-estimates/acknowledgments`.

- [ ] **Step 1: Write failing endpoint tests**

Cover authentication, validation, unavailable preview with null adaptive fields, qualified preview
without accuracy metrics, acknowledgment CSRF, server-computed factor, and account isolation.

- [ ] **Step 2: Run focused tests and verify red**

Run: `uv run pytest tests/test_adaptive_estimate_api.py -q`
Expected: FAIL with missing routes.

- [ ] **Step 3: Implement student-safe response models**

Return only category, original/adaptive/planned minutes, factor, history count, scope,
planned-source default, availability, and acknowledgment requirement. Do not return MAE or hidden
prediction rows.

- [ ] **Step 4: Register routes and application dependency**

Mount the router under `/adaptive-estimates`, expose the estimator through application state, and
protect preview with session auth and acknowledgment with CSRF session auth.

- [ ] **Step 5: Synchronize OpenAPI and Postman**

Add exact operation coverage and a valid example preview/acknowledgment request without embedding
credentials.

- [ ] **Step 6: Run API contract tests**

Run: `uv run pytest tests/test_adaptive_estimate_api.py tests/test_openapi.py tests/test_postman_collection.py -q`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/studyflow/api/adaptive_estimates.py backend/src/studyflow/api/router.py backend/src/studyflow/app.py backend/tests/test_adaptive_estimate_api.py backend/tests/test_openapi.py postman/StudyFlow.postman_collection.json
git commit -m "feat(api): expose adaptive estimate previews"
```

---

### Task 7: Frontend Adaptive API Contract

**Files:**
- Create: `frontend/lib/api/adaptive-contract.ts`
- Create: `frontend/lib/api/adaptive-contract.test.ts`
- Modify: `frontend/lib/api/wire.ts`
- Modify: `frontend/lib/api/scheduling.ts`
- Modify: `frontend/lib/api/tasks.ts`
- Modify: `frontend/types/task.ts`
- Modify: `frontend/types/progress.ts`

**Interfaces:**
- Consumes: the preview, acknowledgment, and extended task APIs.
- Produces: real `getAdaptiveEstimate`, `acknowledgeAdjustment`, and task planned-source mapping.

- [ ] **Step 1: Write failing mapping tests**

Test unavailable preview to `null`, qualified preview mapping, category/overall scope, acknowledgment
flag, task response adaptive/source mapping, and create payload preservation of both original
minutes and selected source.

- [ ] **Step 2: Run focused tests and verify red**

Run: `pnpm test -- lib/api/adaptive-contract.test.ts`
Expected: FAIL because the adaptive contract does not exist.

- [ ] **Step 3: Add wire and domain fields**

Extend `WireAcademicTask` with nullable `adaptive_estimate_minutes` and `planned_source`. Add
`plannedSource: "Original" | "Adaptive"` to the domain task and task form payload.

- [ ] **Step 4: Replace adaptive stubs**

GET the preview using category and original minutes, return `null` when unavailable, and POST the
category acknowledgment. Remove unused-variable suppressions and no-op behavior.

- [ ] **Step 5: Preserve the original estimate in task payloads**

Send `original_estimate_minutes: form.originalEstimate` and
`planned_source: form.plannedSource.toLowerCase()`. Never substitute adaptive minutes into the
original field.

- [ ] **Step 6: Run focused tests and compile**

Run: `pnpm test -- lib/api/adaptive-contract.test.ts`
Expected: PASS.

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/lib/api frontend/types
git commit -m "feat(frontend): connect adaptive estimate API"
```

---

### Task 8: Adaptive Task Form and Explanation

**Files:**
- Modify: `frontend/components/task-form-dialog.tsx`
- Modify: `frontend/components/adaptive-estimate.tsx`
- Modify: `frontend/app/(app)/tasks/[taskId]/page.tsx`
- Test: `frontend/lib/api/adaptive-contract.test.ts`

**Interfaces:**
- Consumes: `AdaptiveEstimate`, task `plannedSource`, preview, and acknowledgment APIs.
- Produces: a task workflow that keeps Original immutable and lets the student choose Original or Adaptive.

- [ ] **Step 1: Add a failing form-state reducer test**

Extract `resolveEstimateSelection(original, estimate, choice)` into `adaptive-contract.ts`. Assert
that choosing Adaptive changes only `plannedSource`, while `originalEstimate` remains the entered
value.

- [ ] **Step 2: Run the focused test and verify red**

Run: `pnpm test -- lib/api/adaptive-contract.test.ts`
Expected: FAIL because the selection helper does not exist.

- [ ] **Step 3: Separate original and planned-source form state**

Replace `plannedMinutes()` and the current adaptive-as-original payload with a `plannedSource`
field. Default to Adaptive only for a qualified, acknowledged preview. After large adjustment
acknowledgment, preserve the student's selected source and submit the unchanged original minutes.

- [ ] **Step 4: Show persisted estimate details**

On the task detail page, show Original, Adaptive when present, and the selected Planned Duration
using the existing explanation language. Do not display MAE or prediction counts as model metrics.

- [ ] **Step 5: Run all frontend gates**

Run: `pnpm test`
Expected: PASS.

Run: `pnpm lint`
Expected: PASS.

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/task-form-dialog.tsx frontend/components/adaptive-estimate.tsx "frontend/app/(app)/tasks/[taskId]/page.tsx" frontend/lib/api/adaptive-contract.ts frontend/lib/api/adaptive-contract.test.ts
git commit -m "feat(frontend): use qualified adaptive estimates"
```

---

### Task 9: Full Verification and Documentation

**Files:**
- Modify: `README.md`
- Modify: `backend/README.md`
- Modify: `frontend/README.md`

**Interfaces:**
- Consumes: the complete outcome and adaptive workflows.
- Produces: verified implementation and accurate developer documentation.

- [ ] **Step 1: Run backend quality gates**

Run: `uv run pytest --cov=studyflow --cov-branch`
Expected: PASS with coverage at or above the configured 90% threshold.

Run: `uv run ruff format --check .`
Expected: PASS.

Run: `uv run ruff check .`
Expected: PASS.

Run: `uv run mypy`
Expected: PASS.

- [ ] **Step 2: Verify migrations and infrastructure**

Run: `uv run alembic upgrade head`
Expected: PASS with exactly one head.

Run: `docker compose config --quiet`
Expected: exit 0.

- [ ] **Step 3: Run frontend quality gates**

Run: `pnpm test`
Expected: PASS.

Run: `pnpm lint`
Expected: PASS.

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 4: Browser workflow verification**

At desktop and 360px width, seed at least ten completed eligible tasks and verify cold start,
hidden prediction period, qualification, category fallback, Adaptive default, Original override,
large-adjustment acknowledgment, and a saved task whose original/adaptive/planned values remain
distinct. Also re-run all three session outcomes.

- [ ] **Step 5: Update documentation**

Document the two adaptive endpoints, the chronological evidence gate, developer test commands,
and the fact that accuracy metrics remain internal.

- [ ] **Step 6: Final diff audit and commit**

Run: `git diff --check`
Expected: no output.

Run: `git status --short`
Expected: only intentional tracked changes plus the user's pre-existing untracked files.

```bash
git add README.md backend/README.md frontend/README.md
git commit -m "docs: document adaptive estimation workflow"
```
