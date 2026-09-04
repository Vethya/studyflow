# Final integration fix report

Date: 2026-09-04. Worktree: `D:/studyflow/.worktrees/session-outcomes-adaptive-ui`.
Base: `1b13ce2`. Source commit: `1c19da80e34e5f0c2e743269f4d04dd26f0b095b`.

## Scope and outcome

Addressed both Important findings in `final-branch-review.md` in one bounded wave.
No push, merge, deployment, migration, scheduler, or evidence-package rewrite was performed.
Existing untracked `.planning/` and all unrelated artifacts were preserved.

### Frozen snapshots

- Added additive `estimate_frozen` task-response boolean from persisted `estimate_frozen_at`.
  The domain record and frontend mapper carry this flag; the frontend does not infer a lock
  from status. In particular, Overdue may be frozen or unfrozen.
- Frozen forms skip live preview requests and acknowledgment guards, retain original/source,
  disable original-minute editing, and show the persisted original/adaptive/planned snapshot
  through the existing read-only `PersistedEstimateNote`. No live source buttons appear.
- Category changes on frozen forms also preserve the selected source. Unrelated title/notes
  edits submit the original minutes and source; adaptive/planned minutes remain server-owned.
- Repository regression now removes eligible outcome history after freezing and explicitly
  submits Adaptive during a title edit, asserting every estimate snapshot field is unchanged.

### Adaptive-state recovery

- Task POST and PUT now return 409 with structured detail:
  `{ "code": "adaptive_estimate_conflict", "message": "..." }` for the existing unavailable
  exception (qualification or acknowledgment failure). The message directs refresh and retry.
- Existing frozen-estimate 409 string details and ordinary validation 422 behavior remain
  compatible. `ApiError` gains an optional code while retaining string detail/message and its
  existing constructor arguments. Structured detail parsing does not break string or Pydantic
  validation-array messages.
- The form only recognizes the adaptive conflict code as a preview-refresh request. It clears
  stale preview/ack state, retains entered fields, selects Original safely, and requests a fresh
  preview using the existing AbortController effect. It does not adopt a new Adaptive default
  silently. The student can save Original after dequalification or choose and acknowledge the
  updated suggestion before retrying.
- Backend README, task OpenAPI response declarations, and Postman task descriptions document
  the contract. Backend recomputation, account ownership, transactional boundaries, and frozen
  persistence rules were not weakened or replaced.

## TDD red / green evidence

The following outputs were observed directly in tool execution during this wave. They are
summaries of that transcript, not reconstructed raw log files or coverage transcripts.

1. Before production edits, ran from `backend`:
   `.venv/Scripts/python -m pytest tests/test_academic_task_api.py -q -k unavailable`
   Result: **2 failed, 11 deselected in 3.82s**. Both POST and PUT regressions expected 409
   but observed 422, reproducing the incorrect HTTP contract.
2. Before production edits, ran from `frontend`:
   `pnpm test components/task-form-dialog.test.tsx`
   Result: **4 failed** (13.52s). Frozen Adaptive + unavailable and failed preview never called
   `onSaved`; stale dequalification and re-ack conflicts never refreshed preview and showed the
   erroneous already-started message. Real TaskFormDialog, dialogs, adapters, mapper, transport,
   and submission handlers execute; only the HTTP boundary and DOM ResizeObserver are faked.
3. Before production edits, ran from `backend`:
   `.venv/Scripts/python -m pytest tests/test_academic_task_repository.py -q -x`
   Result: **1 failed in 1.07s**, missing `AcademicTaskRecord.estimate_frozen`.
4. After the fix, the same component command: **4 passed in 5.67s**.
   Subsequently expanded to six component cases (including a newly required acknowledgment
   on a frozen snapshot and overdue-but-unfrozen mapping) plus three transport compatibility
   cases. Full frontend run: **48 passed**, six test files.
5. Initial combined backend green attempt found a test setup mistake: the newly added direct
   repository `mark_started` call omitted its required `now` argument. Corrected the test call;
   no production behavior was changed to accommodate it. Final scoped suite: **59 passed**.

## Verification commands and observed output

From `frontend`:

- `pnpm test`: **6 files passed; 48 tests passed**, 5.54s.
- `pnpm lint`: exit 0, no lint diagnostics.
- `pnpm build`: exit 0; compiled successfully; TypeScript completed; **17/17 routes generated**.

From `backend`:

- `.venv/Scripts/python -m pytest tests/test_academic_task_api.py tests/test_academic_task_repository.py tests/test_academic_task_lifecycle_repository.py tests/test_adaptive_estimation.py tests/test_adaptive_estimation_repository.py tests/test_adaptive_estimate_api.py -q`
  Final run: **59 passed in 5.19s**.
- `.venv/Scripts/python -m ruff check src tests`: **All checks passed!**
- `.venv/Scripts/python -m ruff format --check src tests`: **158 files already formatted**.
  Initial check found mixed new/existing line endings in four edited files; ran scoped Ruff
  formatting and repeated the check. Final strengthened repository test was likewise formatted.
- `.venv/Scripts/python -m mypy`: **Success: no issues found in 158 source files**.
- OpenAPI inspection using `create_app().openapi()` confirmed POST and PUT 409 point at
  `#/components/schemas/TaskConflict` and `AcademicTaskResponse.estimate_frozen` is boolean.

From repository root:

- `Get-Content postman/StudyFlow.postman_collection.json -Raw | ConvertFrom-Json`: parsed
  successfully as the StudyFlow API collection.
- `git diff --check`: exit 0, no whitespace errors (standard LF-to-CRLF warnings only).

## Dependencies, limitations, and follow-up

- Added dev-only `@testing-library/react` and `jsdom` with `pnpm add -D`; retained only the
  repository's pnpm lockfile. An initial `npm install -D` attempt failed with npm Arborist
  `Cannot read properties of null (reading 'matches')` against this pnpm-managed node_modules;
  it produced no committed npm lockfile. The successful pnpm install added the DOM test harness.
- Existing Vite CommonJS/native-config warning and Vitest/@types/node peer warning remain.
  They did not prevent tests, lint, or production build and were not broadened into toolchain work.
- No real-browser or full-backend/coverage run was performed by this worker in this fix wave.
  The controller was notified of the source commit and is running final full-backend checks.
  Earlier coverage evidence is untouched and is not represented as new verification here.
- Both findings have direct behavioral regression coverage. No remaining blocker identified
  within the two-finding scope. Source is committed; this report is the follow-up evidence artifact.
