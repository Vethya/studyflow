# StudyFlow WebMCP workflow

Phase 1 defines the first complete agent workflow. Phase 2 provides the backend
scenario engine and endpoints. Phase 3 registers that workflow in the
authenticated browser page through the WebMCP imperative API. The current
workflow exposes nine tools, including grouped study-time setup and task edits.

## Phase 3 browser integration

When the authenticated app shell mounts, StudyFlow checks for
`document.modelContext` and registers the nine tools below. Registration is
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

The agent can configure the student's study-time inputs through one grouped
tool. It can confirm the detected timezone, replace the complete recurring
weekly availability pattern, and add, update, or remove one-off blocked
periods. Removing blocked periods asks the student to confirm in the page. These changes never generate or activate a schedule;
if existing future sessions are invalidated, the tool reports that the agent
should draft a replacement plan for review.

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
- planning preferences, including session length, minimum break, and timezone
  confirmation state;
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

### `studyflow_update_study_time`

Updates one or more scheduling inputs in a single authenticated action. The
operations are applied in this order: planning preferences, timezone
confirmation, complete recurring availability replacement, blocked-period
additions, updates, and removals.

Planning preferences are a full replacement because that is how the backend
endpoint works. Read `studyflow_get_plan_state` first and preserve values the
student did not ask to change.

Recurring availability uses weekday names and local `HH:mm` times. Supplying
`recurring_availability` always replaces the full weekly pattern, including
with an empty `windows` array. Any blocked-period removal opens an in-page
confirmation for the student; if they decline, the call fails and nothing in
the request is saved.

Example:

```json
{
  "planning_preferences": {
    "timezone": "Asia/Phnom_Penh",
    "preferred_session_length_minutes": 60,
    "minimum_break_minutes": 10
  },
  "confirm_timezone": true,
  "recurring_availability": {
    "replace_all": true,
    "windows": [
      { "day": "Monday", "start_time": "18:00", "end_time": "20:00" },
      { "day": "Wednesday", "start_time": "18:00", "end_time": "20:00" }
    ]
  },
  "blocked_periods": {
    "add": [
      {
        "starts_at": "2026-09-12T09:00:00+07:00",
        "ends_at": "2026-09-12T17:00:00+07:00",
        "reason": "Family event"
      }
    ],
    "update": [],
    "remove": []
  }
}
```

The result returns saved planning preferences, windows, and changed periods.
If blocked-period changes invalidate future sessions, the result includes
`invalidated_future_session_ids` and requires a new draft for student review.

### `studyflow_update_task`

Manages an existing task through one explicit operation. The tool supports
editing all fields, starting a task, finishing a started task early, and
deleting a task. Deletion and finishing early open an in-page confirmation that
names the task from StudyFlow's own data; if the student declines, the call
fails and the task is unchanged.

Edit example:

```json
{
  "operation": "edit",
  "task_id": "00000000-0000-0000-0000-000000000000",
  "title": "Prepare biology exam notes",
  "category": "Exam Preparation",
  "priority": "High",
  "course": "Biology 201",
  "notes": "Review chapters 4 through 8",
  "deadline_at": "2026-09-11T23:59:00+07:00",
  "original_estimate_minutes": 210
}
```

Start example:

```json
{
  "operation": "start",
  "task_id": "00000000-0000-0000-0000-000000000000"
}
```

Finish-early example:

```json
{
  "operation": "finish_early",
  "task_id": "00000000-0000-0000-0000-000000000000"
}
```

Delete example:

```json
{
  "operation": "delete",
  "task_id": "00000000-0000-0000-0000-000000000000"
}
```

Task edits do not silently regenerate or activate a schedule. Since deleting or
finishing early removes future sessions, and edits can change feasibility, the
agent should draft a new proposal when the result says review is required.

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
proposal. The tool also asks the student to approve activation in the page
before it calls the backend, so an agent following injected instructions cannot
activate a plan on its own.

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

## In-page confirmation

Task titles and notes, and imported Classroom and Calendar text, are untrusted
(`untrustedContentHint`). An agent that reads them can be steered by instructions
hidden inside, so an input flag such as `confirmed: true` proves nothing about
the student's intent. These actions always ask the student directly in the page
before calling the backend:

| Tool | Action |
| --- | --- |
| `studyflow_update_task` | `delete`, `finish_early` |
| `studyflow_update_study_time` | any `blocked_periods.remove` |
| `studyflow_accept_plan` | every call |

The prompt is the browser's own modal dialog (`frontend/lib/webmcp/confirm.ts`),
which neither page scripts nor WebMCP agents can answer. When the WebMCP client
provides `requestUserInteraction`, the page asks inside that callback so the agent
waits. Approval is that callback's result. A hook that returns true without asking
does not count. A declined prompt fails the tool call with "The student did not
approve" and changes nothing. A `confirmed` field is still accepted so older agents
stay schema-valid, and it is ignored. Task titles and blocked-period labels in the
prompt are reduced to one short line. A removal names the account's periods by
date and reason.

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
- Deleting or finishing a task early, removing a blocked period, and accepting a
  plan each require an in-page confirmation by the student.
- No WebMCP tool handles login, passwords, profile security, or raw account
  tokens.
