# Session Outcomes and Adaptive Estimation Design

## Status

Approved in chat on 2026-09-03. Implementation targets the
`feature/session-outcomes` branch after merging the latest `master`.

## Goal

Complete the student-facing session-outcome workflow against the backend's new
Completed and Delayed outcome contract, then implement SPEC FR-07 adaptive duration
estimation end to end. The finished system must preserve the student's original estimate,
learn only from earlier confirmed behavior, expose a suggestion only after it proves more
accurate, and let the student choose which estimate controls scheduling.

## Existing State

The branch already contains backend support for Completed, Delayed, and Missed outcomes.
The frontend outcome dialog already collects the required values, but its API adapter still
rejects Completed and Delayed locally. The frontend also contains the intended adaptive
estimate explanation and large-adjustment dialog, while its API functions are deliberate
stubs that return `null` or do nothing.

The `academic_tasks` table already has `original_estimate_minutes`,
`adaptive_estimate_minutes`, `planned_source`, and `planned_duration_minutes`. These fields
are the authoritative task snapshot. Predictions used to evaluate whether the model has
qualified require separate chronological persistence.

## Scope

### Included

- Merge `master` into `feature/session-outcomes` and retain both histories.
- Connect Completed and Delayed frontend submissions to the outcome endpoint.
- Support the backend's large-actual-duration confirmation contract.
- Refresh task, session, calendar, dashboard, and progress views after outcomes.
- Implement the transparent median-correction estimator from SPEC Section 15.
- Persist chronological hidden and exposed predictions without retrospectively generating
  history.
- Evaluate qualification using like-for-like original and adaptive errors.
- Add estimate preview and large-adjustment acknowledgment endpoints.
- Preserve original, adaptive, and planned estimates independently when tasks are created or
  edited.
- Show the existing adaptive explanation and choice UI only when the estimator is qualified.
- Add migrations, automated tests, and browser-level workflow verification.

### Excluded

- Ridge Regression or any competing estimator.
- Student-facing accuracy analytics such as MAE, bias, prediction error, or sample counts.
- Retrospective predictions for tasks created before this feature exists.
- Changes to scheduling constraints unrelated to which planned duration a task uses.
- A general analytics dashboard for adaptive-estimation evaluation.

## Branch and Migration Strategy

The session-outcome branch and `master` each introduced an Alembic revision based on the same
previous revision. Both existing revisions will remain immutable. A no-op Alembic merge
revision will join the two heads, and the adaptive-estimation schema revision will descend
from that merge revision. This keeps every deployed upgrade path valid and produces one head.

## Session Outcome Integration

The frontend wire contract will model the endpoint as a discriminated request union:

- Completed: `outcome: "completed"`, positive `actual_minutes`, and
  `large_actual_confirmed`.
- Delayed: `outcome: "delayed"`, positive `actual_minutes`, positive
  `remaining_minutes`, and `large_actual_confirmed`.
- Missed: `outcome: "missed"` with no minute fields.

`recordOutcome` will translate the UI's title-cased domain values into these payloads and map
the returned session plus nullable revision. It will no longer throw
`OutcomeNotSupportedError`. The existing confirmation dialog will retry Completed or Delayed
with `large_actual_confirmed: true` when the student's entry exceeds twice the planned time.

After a successful outcome, shared data-change events will invalidate every view derived from
tasks or sessions. Missed outcomes continue to surface their recovery proposal. Completed and
Delayed outcomes accept the backend's nullable revision response and display an accurate
success message without inventing a proposal.

## Adaptive Estimation Model

### Eligible history

A task becomes eligible history only after it is completed and has a positive confirmed Actual
Duration. Actual Duration is the sum of Completed and Delayed outcome minutes for the task.
Missed and Awaiting Outcome sessions contribute no time. Predictions always use tasks completed
before the predicted task; future information is never read.

### Correction factor

For each eligible completed task:

`ratio = actual duration / original estimate`

The candidate factor is the median of the latest 20 applicable ratios, ordered by completion
time and then task ID for deterministic ties. Category-specific history is used when at least
five eligible completed tasks exist in the requested category. Otherwise, the latest 20 overall
eligible tasks are used. Course and Notes never affect the model.

The predicted minutes are the original minutes multiplied by the uncapped factor, rounded to
the nearest whole minute using round-half-up and bounded only to the database's positive integer
range.

### Cold start and qualification

- Tasks 1-5 collect outcomes but receive no prediction.
- Starting with task 6, a chronological shadow prediction is saved when the task is created.
- After five shadow predictions have completed, compare adaptive MAE with original MAE on the
  same tasks.
- The method qualifies only when adaptive MAE is at most 90% of original MAE. If original MAE
  is zero, the adaptive method cannot qualify.
- Once ten or more completed prediction records exist, qualification uses the latest ten;
  otherwise it uses every completed prediction record with a minimum of five.
- Qualification is recomputed after later completions. Losing the required advantage hides the
  adaptive estimate for new tasks, while existing task snapshots remain unchanged.

### Prediction persistence

`adaptive_estimation_predictions` stores one immutable pre-task prediction per task:

- task and account IDs;
- category;
- original and predicted minutes;
- correction factor;
- overall or category history scope;
- number of history records used;
- whether the estimate was qualified and exposed when captured;
- creation timestamp.

The task's own later actual duration is not written back into this prediction. Evaluation joins
the immutable prediction to the completed task and its outcomes. This preserves chronological
fairness and prevents retrospective prediction generation.

### Large adjustments

An exposed factor greater than `2.0` or less than `0.5` requires acknowledgment before Adaptive
can be selected for that category. `adaptive_estimation_acknowledgments` stores the account,
category, acknowledged factor, and timestamp. A category asks again only when the new factor
differs from the acknowledged factor by at least 25% relative to that acknowledged factor.
The predicted value remains uncapped regardless of the student's choice.

## API Design

### Preview

`GET /api/v1/adaptive-estimates/preview`

Query parameters:

- `category`
- `original_estimate_minutes`

The response always succeeds for valid inputs and reports whether a student-visible estimate is
available. When unavailable, adaptive fields are `null`; hidden qualification metrics are never
returned. When available, the response includes original minutes, adaptive minutes, factor,
history count, history scope, the default planned source, and whether acknowledgment is required.

### Acknowledgment

`POST /api/v1/adaptive-estimates/acknowledgments`

The request contains the category. The server recalculates the currently qualified factor and
stores that value; it does not trust a client-supplied factor. Acknowledging explains acceptance
of the pattern but does not create or edit a task.

### Task persistence

Task create and editable pre-start update requests gain an optional `planned_source` of
`original` or `adaptive`.

On create, the backend calculates and persists the chronological prediction inside the same
transaction as the task. If qualified, it stores the adaptive estimate on the task. Omitted
`planned_source` defaults to Adaptive when qualified and acknowledged, otherwise Original.
Explicit Adaptive selection is rejected when no qualified estimate exists or acknowledgment is
still required. Original selection remains valid even when Adaptive is available.

On update before the estimate is frozen, the backend recalculates the candidate from history and
replaces the unconsumed task prediction. Once the task has started or has been scheduled, all
estimate snapshot fields remain frozen.

Task responses add `adaptive_estimate_minutes` and `planned_source`. Existing clients remain
compatible because the new request field is optional.

## Frontend Design

The current `AdaptiveEstimateNote` and `LargeAdjustmentDialog` remain the presentation layer.
The API adapter will replace the stubs with the preview and acknowledgment calls and map the
snake-case response into `AdaptiveEstimate`.

The task form will keep the entered Original Estimate unchanged. Its state will separately track
the selected planned source. This corrects the current temporary behavior that sends the
suggested duration as `original_estimate_minutes`. Saving sends both the true original estimate
and the student's selected source; the backend remains authoritative for the adaptive value.

Task mapping and detail surfaces will expose the stored adaptive estimate and selected planned
duration. The UI will show explanations in plain task/minute language and will not display model
accuracy calculations.

## Errors and Concurrency

- Invalid outcome minutes remain `422`; duplicate/future/proposed-session outcomes remain `409`.
- Adaptive selection without qualification or acknowledgment returns `409` with an actionable
  message, and the form refreshes its preview.
- Preview cancellation uses the existing `AbortSignal` flow to avoid stale form updates.
- Task creation, prediction capture, and estimate snapshot persistence occur in one transaction.
- Concurrent completion/create operations lock the account or relevant rows so a prediction has
  one deterministic history boundary.
- Technical failures never silently fall back to an invented adaptive value; the UI uses Original
  and reports a normal API error when saving cannot be validated.

## Testing and Verification

Backend tests will cover:

- Completed, Delayed, and Missed request validation and persistence.
- Large actual-duration confirmation.
- Median behavior for odd/even samples and round-half-up.
- Latest-20 ordering, category fallback, and category activation.
- No prediction for tasks 1-5 and chronological shadow predictions from task 6.
- The five-prediction qualification gate, latest-ten reassessment, and dequalification.
- Zero original-MAE behavior and like-for-like comparison.
- Large-adjustment acknowledgment and the 25% re-prompt threshold.
- Original/adaptive task selection, defaulting, freezing, ownership, and transactionality.
- Alembic upgrade/downgrade and a single migration head.
- OpenAPI and Postman synchronization for the new endpoints.

Frontend tests will cover payload mapping, response mapping, original-estimate preservation,
planned-source selection, large-entry retry, and data refresh behavior. Final verification will
run the full backend suite and coverage gate, Ruff, mypy, frontend tests, lint, production build,
Compose validation, and a browser walkthrough at desktop and 360px width.

## Delivery Order

1. Merge histories and normalize the migration graph.
2. Connect and verify the Completed/Delayed UI.
3. Implement the pure adaptive estimator and its tests.
4. Add persistence, qualification queries, and migrations.
5. Add APIs and task-service integration.
6. Connect the adaptive frontend and fix estimate/source preservation.
7. Run full automated and browser verification, then update documentation.
