# Session Outcome UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the existing Completed and Delayed outcome UI to the backend contract on `feature/session-outcomes` while preserving Missed recovery behavior.

**Architecture:** Keep transport translation in a small pure outcome-contract module, use the existing scheduling API as the network boundary, and keep confirmation and presentation in `RecordOutcomeDialog`. Successful mutations continue through the existing `onRecorded` callbacks and shared data-change event so every mounted task/session-derived view refreshes.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, existing FastAPI outcome endpoint

**Spec:** `docs/superpowers/specs/2026-09-03-session-outcomes-adaptive-estimation-design.md`

## Global Constraints

- Completed requires positive actual minutes and zero remaining work.
- Delayed requires positive actual and remaining minutes.
- Missed sends no minute fields and retains its recovery-proposal flow.
- Manual actual time greater than twice planned time requires explicit confirmation.
- Do not expose a success message that claims a revision exists when the response revision is null.
- Do not modify unrelated untracked review, presentation, extension, or temporary files.

---

### Task 1: Frontend Test Harness and Pure Outcome Contract

**Files:**
- Create: `frontend/vitest.config.ts`
- Create: `frontend/lib/api/outcome-contract.ts`
- Create: `frontend/lib/api/outcome-contract.test.ts`
- Modify: `frontend/package.json`
- Modify: `frontend/pnpm-lock.yaml`

**Interfaces:**
- Consumes: `OutcomeFormData` from `frontend/types/session.ts`.
- Produces: `toWireOutcome(data, largeActualConfirmed)` returning `WireSessionOutcomeRequest`.

- [ ] **Step 1: Add the test runner**

Run: `pnpm add -D vitest`

Add `"test": "vitest run"` to `package.json` and configure the `@` alias in
`vitest.config.ts`:

```ts
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
  test: { environment: "node" },
});
```

- [ ] **Step 2: Write failing request-mapping tests**

Test exact payloads for Completed, Delayed, and Missed, including the
`large_actual_confirmed` retry flag:

```ts
expect(toWireOutcome({ outcome: "Completed", actualMinutes: 75 }, true)).toEqual({
  outcome: "completed",
  actual_minutes: 75,
  large_actual_confirmed: true,
});
expect(toWireOutcome({ outcome: "Delayed", actualMinutes: 30, revisedRemainingMinutes: 45 }, false)).toEqual({
  outcome: "delayed",
  actual_minutes: 30,
  remaining_minutes: 45,
  large_actual_confirmed: false,
});
expect(toWireOutcome({ outcome: "Missed", actualMinutes: 0 }, false)).toEqual({ outcome: "missed" });
```

- [ ] **Step 3: Run the focused test and verify red**

Run: `pnpm test -- lib/api/outcome-contract.test.ts`
Expected: FAIL because the contract module does not exist.

- [ ] **Step 4: Implement the discriminated wire request union**

Define:

```ts
export type WireSessionOutcomeRequest =
  | { outcome: "completed"; actual_minutes: number; large_actual_confirmed: boolean }
  | { outcome: "delayed"; actual_minutes: number; remaining_minutes: number; large_actual_confirmed: boolean }
  | { outcome: "missed" };
```

Implement `toWireOutcome` with an exhaustive `switch`, rejecting a Delayed value whose
`revisedRemainingMinutes` is absent before any network request.

- [ ] **Step 5: Run the focused test and verify green**

Run: `pnpm test -- lib/api/outcome-contract.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json frontend/pnpm-lock.yaml frontend/vitest.config.ts frontend/lib/api/outcome-contract.ts frontend/lib/api/outcome-contract.test.ts
git commit -m "test(frontend): cover session outcome payloads"
```

---

### Task 2: Scheduling API Outcome Integration

**Files:**
- Modify: `frontend/lib/api/wire.ts`
- Modify: `frontend/lib/api/scheduling.ts`
- Modify: `frontend/types/session.ts`
- Test: `frontend/lib/api/outcome-contract.test.ts`

**Interfaces:**
- Consumes: `toWireOutcome`, `WireStudySession`, and `WireScheduleProposal`.
- Produces: `recordOutcome(sessionId, data, signal)` returning `OutcomeResult` with a nullable revision.

- [ ] **Step 1: Extend the failing contract test**

Add an assertion that missing Delayed remaining minutes throws
`"Delayed outcomes require remaining minutes"`.

- [ ] **Step 2: Run the focused test and verify red**

Run: `pnpm test -- lib/api/outcome-contract.test.ts`
Expected: FAIL on the missing validation.

- [ ] **Step 3: Add response and form fields**

Add `WireSessionOutcomeRecordingResponse`:

```ts
export interface WireSessionOutcomeRecordingResponse {
  session: WireStudySession;
  outcome: WireSessionOutcome;
  revision: WireScheduleProposal | null;
}
```

Add optional `largeActualConfirmed?: boolean` to `OutcomeFormData`.

- [ ] **Step 4: Replace the local unsupported-outcome guard**

Delete `OutcomeNotSupportedError`. POST `toWireOutcome(data, data.largeActualConfirmed ?? false)`
to `/study-sessions/${sessionId}/outcomes`, then map the returned session and nullable revision.
Preserve the existing task-title join and `ScheduleTechnicalFailure` behavior.

- [ ] **Step 5: Run API contract tests**

Run: `pnpm test -- lib/api/outcome-contract.test.ts`
Expected: PASS.

- [ ] **Step 6: Run TypeScript and lint checks**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

Run: `pnpm lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/lib/api/wire.ts frontend/lib/api/scheduling.ts frontend/types/session.ts frontend/lib/api/outcome-contract.test.ts
git commit -m "feat(frontend): connect completed and delayed outcomes"
```

---

### Task 3: Enable Completed and Delayed Interaction

**Files:**
- Modify: `frontend/components/record-outcome-dialog.tsx`
- Test: `frontend/lib/api/outcome-contract.test.ts`

**Interfaces:**
- Consumes: the completed `scheduling.recordOutcome` adapter.
- Produces: all three enabled outcome choices and correct confirmation retry data.

- [ ] **Step 1: Write the confirmation-data test**

Add a pure helper `withLargeActualConfirmation(data)` to `outcome-contract.ts` and test that it
returns a copy with `largeActualConfirmed: true` without changing the selected outcome or minutes.

- [ ] **Step 2: Run the focused test and verify red**

Run: `pnpm test -- lib/api/outcome-contract.test.ts`
Expected: FAIL because the confirmation helper does not exist.

- [ ] **Step 3: Enable all options and pass confirmation state**

Remove `available` and `UNAVAILABLE`, allow every option button to select its outcome, and remove
the “still being built” copy. Change `save` to accept `largeActualConfirmed = false`, pass it in
`OutcomeFormData`, and invoke `save(true)` from the confirmation dialog.

Use outcome-specific success copy:

```ts
const message = outcome === "Completed"
  ? "Session recorded as finished"
  : result.revision
    ? "Recorded — StudyFlow has a new plan for you to review"
    : "Session progress recorded";
```

- [ ] **Step 4: Implement the pure confirmation helper and run tests**

Run: `pnpm test -- lib/api/outcome-contract.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify frontend compilation**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

Run: `pnpm lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/record-outcome-dialog.tsx frontend/lib/api/outcome-contract.ts frontend/lib/api/outcome-contract.test.ts
git commit -m "feat(frontend): enable all study session outcomes"
```

---

### Task 4: Refresh Integration and Outcome Verification

**Files:**
- Modify: `frontend/app/(app)/calendar/page.tsx`
- Modify: `frontend/app/(app)/dashboard/page.tsx`
- Modify: `frontend/app/(app)/tasks/[taskId]/page.tsx`

**Interfaces:**
- Consumes: each screen's existing `onRecorded` handler and `useApi` reload mechanism.
- Produces: consistent post-outcome task, session, proposal, progress, dashboard, and calendar state.

- [ ] **Step 1: Trace every `RecordOutcomeDialog` caller**

Run: `rg -n "RecordOutcomeDialog|onRecorded" frontend/app frontend/components`
Expected: every caller either updates local session/proposal state or broadcasts
`notifyStudyFlowDataChanged()`.

- [ ] **Step 2: Add missing refresh calls**

After a successful outcome, surface a returned revision and call
`notifyStudyFlowDataChanged()` exactly once from each caller. Remove redundant per-resource reload
calls because every `useApi` resource already listens to that event. Do not synthesize a revision
when null.

- [ ] **Step 3: Run the complete frontend gate**

Run: `pnpm test`
Expected: PASS.

Run: `pnpm lint`
Expected: PASS.

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 4: Browser verification**

With a past accepted session, verify these flows at desktop and 360px width:

1. Completed with ordinary actual minutes saves and removes remaining work.
2. Completed above twice planned time requires confirmation and saves after confirmation.
3. Delayed requires positive actual and remaining minutes and refreshes task progress.
4. Missed still opens the recovery proposal.
5. No screen claims a revision exists when the response revision is null.

- [ ] **Step 5: Commit**

```bash
git add "frontend/app/(app)/calendar/page.tsx" "frontend/app/(app)/dashboard/page.tsx" "frontend/app/(app)/tasks/[taskId]/page.tsx"
git commit -m "fix(frontend): refresh views after session outcomes"
```
