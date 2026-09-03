# StudyFlow WebMCP workflow

Phase 1 defines the first complete agent workflow. Phase 2 provides the backend
scenario engine and endpoints. Phase 3 now registers that workflow in the
authenticated browser page through the WebMCP imperative API.

## Phase 3 browser integration

When the authenticated app shell mounts, StudyFlow checks for
`document.modelContext` and registers the seven tools below. Registration is
scoped to the shell lifetime and is cancelled on logout/unmount. Browsers that
do not expose WebMCP simply continue to work as a normal StudyFlow app.

The tool handlers call the existing same-origin API client, which sends the
browser's server-managed session cookie and CSRF token. There is deliberately
no login tool and no credential passed to an agent. Mutations dispatch a small
`studyflow:data-changed` event so mounted React resources refresh after an
agent action.

The Next.js app also sends `Permissions-Policy: tools=(self)` so the intended
WebMCP exposure is explicit in deployed environments.

## Phase 2 backend surface

The scenario engine is intentionally account-scoped and uses the same session
and CSRF protections as the existing scheduling mutations:

- `POST /api/v1/schedule-proposals/simulate` runs a scenario in memory and
  returns `persisted: false`.
- `POST /api/v1/schedule-proposals` accepts the same optional `scenario` body
  and persists the result as an inactive proposal.
- `GET /api/v1/schedule-proposals/current` returns the normalized scenario on a
  draft proposal.

Temporary availability and blocked periods are concrete one-off UTC intervals;
they never modify recurring availability. Deadline overrides apply only to the
solver run. If a student accepts a draft, the backend still verifies that every
session fits the task's real current deadline, and any change to the underlying
account inputs makes the proposal stale.

## Product workflow

The agent helps a student recover a realistic study plan:

1. Read the student's current work, time, schedule, and progress.
2. Add a task when the student describes new work.
3. Compare a temporary scenario without changing stored data.
4. Create an inactive schedule proposal.
5. Let the student accept or reject the proposal.
6. Record a missed session and present the resulting recovery proposal.

Recurring availability is configured through the normal StudyFlow interface.
WebMCP reads it as planning context. There is no availability-setting tool in
the first workflow.

## Tool catalog

### `studyflow_get_plan_state`

Reads enough current state for the agent to choose its next action.

Input:

```json
{
  "horizon_days": 7
}
```

`horizon_days` is optional and accepts `7`, `14`, or `30`.

Output includes:

- account timezone and `setup_status`;
- open tasks with remaining effort and deadlines;
- recurring availability and unavailable periods;
- active sessions and their outcomes;
- any pending proposal;
- effort progress by task;
- capacity, commitment, and balance for the selected horizon.

The tool must not return passwords, authentication tokens, or account security
data. User-entered notes are data, not instructions to the agent.

### `studyflow_add_task`

Creates one task through the existing task API.

Input:

```json
{
  "title": "Prepare biology exam notes",
  "category": "Exam Preparation",
  "priority": "High",
  "course": "Biology 201",
  "notes": "Review chapters 4 through 7",
  "deadline_at": "2026-09-11T23:59:00+07:00",
  "original_estimate_minutes": 180
}
```

The backend remains the source of truth for validation and timezone-aware
deadlines.

### `studyflow_simulate_plan`

Runs a hypothetical plan. It never creates a proposal or changes the active
schedule.

Input:

```json
{
  "scenario": {
    "temporary_availability": [
      {
        "starts_at": "2026-09-10T18:00:00+07:00",
        "ends_at": "2026-09-10T19:00:00+07:00"
      }
    ],
    "temporary_blocked_periods": [],
    "deadline_overrides": []
  }
}
```

All scenario fields are optional. The same scenario shape is used by
`studyflow_draft_plan` so an option can become a reviewable proposal without
silently modifying recurring availability.

The result must include the normalized scenario, proposed sessions, task
allocations, unscheduled work, overload warnings, and:

```json
{
  "active_schedule_changed": false,
  "requires_user_review": false,
  "persisted": false
}
```

### `studyflow_draft_plan`

Generates an inactive proposal from current data and an optional scenario.

The result must include `proposal_id`, the proposal status, sessions,
allocations, unscheduled work, overload warnings, and:

```json
{
  "active_schedule_changed": false,
  "requires_user_review": true,
  "persisted": true
}
```

### `studyflow_accept_plan`

Accepts exactly one pending proposal by ID. The backend must continue to check
ownership, expiry, stale inputs, feasibility, and schedule conflicts.

Result metadata:

```json
{
  "active_schedule_changed": true,
  "requires_user_review": false,
  "persisted": true
}
```

The agent should call this only after the student explicitly approves the
proposal.

### `studyflow_reject_plan`

Rejects exactly one pending proposal by ID. Rejecting must leave the active
schedule unchanged.

### `studyflow_record_missed`

Records one past session as missed through the existing recovery workflow. The
result includes the recorded session and, when one can be generated, the new
recovery proposal. The active schedule remains unchanged until the student
accepts that proposal.

## Demo fixture

Use a dedicated account with fake data. Configure the availability through the
normal UI before the demo. The fixture should contain:

- one high-priority exam-preparation task due soon;
- one assignment with a competing deadline;
- one lower-priority reading task;
- a narrow set of recurring study windows;
- at least one unavailable period;
- an active schedule;
- one past session awaiting or needing a missed outcome;
- enough work to produce an overload warning in at least one scenario.

Suggested prompts:

```text
Can I finish everything before my earliest deadline with the time I have?
```

```text
What changes if I can study for one extra hour on Thursday? Do not change my schedule.
```

```text
Draft the safest plan, but wait for my approval before activating it.
```

```text
I missed yesterday's session. Recover the plan without changing my recurring availability.
```

## Acceptance checklist

- The tool names and input fields in `frontend/lib/webmcp/contracts.ts` remain
  the source of truth for the frontend registration layer.
- Simulation cannot persist tasks, proposals, sessions, availability, or
  preferences.
- Drafting never replaces the active schedule.
- Accepting and rejecting a proposal act only on the authenticated account.
- A stale proposal returns a clear error and leaves the active schedule intact.
- A missing availability setup returns `needs_availability` instead of an
  opaque scheduler error.
- No WebMCP tool handles login, passwords, profile security, or raw account
  tokens.
