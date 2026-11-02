# StudyFlow

Given a student's tasks, deadlines and weekly availability, place fixed-length study sessions
at exact minutes so that no two overlap, breaks are respected, and, when the work cannot all
fit, the shortfall is the smallest one under an explicit priority policy and is proven, not guessed.

## Status

- Final-year thesis project, Kirirom Institute of Technology, 2026.
- Authors: Syna Sopheakvethya (scheduling engine and backend) and Mengheang Ros.
- Production launch: November 2026.
- One usability test with 5 university students (September 2026); results under Evaluation. No study of schedule quality or estimate accuracy yet.

## The model

The engine is an exact-minute CP-SAT model (Google OR-Tools 9.15, one search worker, fixed seed)
in [`backend/src/studyflow/scheduling/`](backend/src/studyflow/scheduling/). A task's remaining effort is
split into fixed-duration sessions (preferred length 10 to 240 min, last session holds the
remainder, nothing rounded up). Each session is one optional interval.

| Element | Definition |
| --- | --- |
| Variables | `start_s` per session (integer minute); `present_s` in {0,1} when the workload is overloaded |
| Domain | `start_s` is restricted to the union of `[window.start, min(window.end, deadline) - duration]` over the task's availability windows, and to `>= planning start` |
| No overlap | Each session occupies `[start_s, start_s + duration_s + min_break)`; all occupied intervals are pairwise disjoint |
| Atomic sessions | A session is placed whole or not at all |

When every session fits, the model returns the first complete placement (`FEASIBLE`). When not
all sessions fit, a lexicographic objective is optimised in three stages:

| Stage | Objective | Notes |
| --- | --- | --- |
| 1 | Maximise scheduled minutes per task, tasks taken in policy order | Order: least slack, then earlier deadline, then more work, then higher priority, then task ID. Slack is calendar capacity minus work minus required breaks. |
| 2 | Maximise the number of distinct days each task uses | Spreads a task over more days |
| 3 | Minimise total start time | Pulls sessions earlier |

Stage 1 is solved task by task (or in weighted batches when the weights stay within a safe
integer range), and each optimum is fixed as a constraint before the next task is optimised.
A min-cost-flow witness and a greedy policy placement are passed to CP-SAT as hints, and for the
uniform workload in the benchmark they replace the large spread model entirely.

Result: either a complete schedule, or `OVERLOAD` with the scheduled sessions and, per task,
`required`, `scheduled` and `unscheduled` minutes.

## Design principles

1. **Proven overload over silent failure.** `OVERLOAD` is returned only after stage 1 reaches
   `OPTIMAL`. If it does not, the result is `TECHNICAL_FAILURE`, never a partial schedule
   presented as valid. See `classify_overload_status` in
   [`overload.py`](backend/src/studyflow/scheduling/overload.py).
2. **No fallback that could disguise a failure.** If CP-SAT times out or fails, the engine returns a
   labelled `TECHNICAL_FAILURE`. It is never reported as overload and never replaces the active
   schedule (SPEC 10.7). [ADR 0004](docs/adr/0004-fallback-only-when-cp-sat-cannot-conclude.md)
   first proposed an earliest-deadline-first fallback for that case; the SPEC supersedes it in favour of
   this failure handling (SPEC section 26).
3. **Evidence-gated adaptive estimates.** [ADR 0001](docs/adr/0001-stage-and-performance-gate-adaptive-estimation.md):
   no adaptive estimate for the first five completed tasks; hidden predictions for tasks six to ten;
   the correction (median actual-to-original ratio of the latest 20 records) is shown only if its
   chronological predictions have at least 10% lower mean absolute error than the student's own
   estimates (`adaptive_error <= 0.90 * original_error` in `estimation/model.py`). The ADR's
   Ridge Regression stage is superseded by the single median correction (SPEC section 26).

## Worked example

Three evenings, 18:00 to 21:00, 10-minute minimum break. Essay (2 x 60 min), problem set
(3 x 50 min, due the evening of day 2), exam review (4 x 60 min). Total 510 min of work in
540 min of raw window time.

Output of `uv run python examples/demo_schedule.py` from `backend/`:

```text
status: overload   solver: OPTIMAL
schedule:
  day 1 18:00 - 18:50  Problem set (50 min)
  day 1 19:00 - 19:50  Problem set (50 min)
  day 1 20:00 - 21:00  Exam review (60 min)
  day 2 18:00 - 18:50  Problem set (50 min)
  day 2 19:00 - 20:00  Exam review (60 min)
  day 3 18:00 - 19:00  Exam review (60 min)
  day 3 19:10 - 20:10  Exam review (60 min)
allocation (minutes):
  Essay draft  required 120  scheduled   0  unscheduled 120  deadline day 3 21:00
  Exam review  required 240  scheduled 240  unscheduled   0  deadline day 3 21:00
  Problem set  required 150  scheduled 150  unscheduled   0  deadline day 2 21:00
```

The essay has the most slack (420 min against 200 for the problem set and 290 for exam review),
so it ranks last in the policy order. The gaps left after the other two tasks are 50 min (day 2)
and 40 min (day 3), too short for a 60-minute session, and the solver proves no better allocation exists.

## Evaluation

Benchmark: 1 student, 50 tasks, 250 sessions of 60 min, 16-week horizon, 50 blocked periods,
10-minute break, 4 s solver limit
([`_performance.py`](backend/src/studyflow/scheduling/_performance.py)). Run: 5 runs per scenario via
`examples/demo_schedule.py`, no warm-up discarded, on an Apple M4 Pro, macOS 27.2,
Python 3.13.18, OR-Tools 9.15.6755.

| Scenario | Status | Solver | Placed | Unscheduled | Median | Max |
| --- | --- | --- | --- | --- | --- | --- |
| Feasible (480 min/day available) | feasible | OPTIMAL | 250 / 250 | 0 min | 0.082 s | 0.088 s |
| Overloaded (180 min/day available) | overload | OPTIMAL | 160 / 250 | 5,400 min | 0.113 s | 0.123 s |

The same cases are asserted in
[`test_scheduling_performance.py`](backend/tests/test_scheduling_performance.py) (under 5 s,
`OPTIMAL`, 250 and 160 sessions, exactly 5,400 unscheduled minutes, breaks respected).
`backend/benchmarks/scheduler_performance.py` runs the SPEC NFR-02 gate (20 runs, p95 under 5 s).
These are synthetic, uniform workloads on one machine, not a latency comparison.

**Usability test (SPEC NFR-04).** 5 university students, 29 and 30 September 2026, dev
environment, moderated by one observer (Vethya). Browsers: Chrome, Brave, Firefox; devices: Windows laptops,
an Android phone, a MacBook Pro. Each student did five core steps: set weekly availability, create a task,
generate and accept a schedule, record an outcome and actual duration, view effort progress.
4 of 5 completed all five steps independently, which meets the NFR-04 threshold of 4 of 5. The fifth
(P05) needed direct help to generate and accept a schedule. 0 errors and 0 blocking issues were logged.
Four students received a clarification on one or two steps; the log counts these as independent.
Source: observer log, not published in this repository.

This test exercised the workflow, not the engine. Only 1 of 5 students reached an overload scenario;
the optional revision, reject/regenerate and dated-unavailability scenarios were attempted by none.

**Not yet done** (thesis objectives O5 and O6): the matched-task comparison of adaptive and original
estimates on real completed tasks (MAE and signed bias, 10% gate), and the student rating of the workflow
and overload feedback (target 4 out of 5; the observer log records no ratings).

## Limitations and open questions

- The policy order (slack, deadline, work, priority) is hand-chosen, not learned or validated against student preferences.
- Benchmarks are synthetic and uniform (identical sessions, windows and priorities per scenario).
- The only user data is a 5-student workflow test run by one of the authors on the dev build. It shows the workflow is usable, not that the schedules are good, and "independent" counts clarifications.
- Stages 2 and 3 accept a feasible incumbent if the budget runs out; the reported solver status is
  then `FEASIBLE`, not `OPTIMAL`. Only stage 1 (the allocation) must be proven.

Open questions, taken from the thesis objectives:

1. Does the median-ratio correction beat students' original estimates by at least 10% MAE on the same completed tasks, and what is its signed bias? (O5)
2. Do students understand the overload feedback (required time, available time, shortfall)? (O3, O6)
3. Do strict constraints, explicit overload and an evidence-gated correction give a more defensible schedule than a plan that only places sessions? (thesis proposition, chapter 2)

## Features

- Email/password accounts, email verification, password recovery, optional Google Sign-In
- Tasks with deadlines, priorities, categories, courses, effort estimates, start and finish-early actions
- Google Calendar and Google Classroom import with preview before anything is created
  ([setup](docs/google-import-setup.md))
- Planning preferences (timezone, session length, minimum break), recurring availability, dated unavailable periods
- Conflict-free schedule generation, calendar view and dashboard
- Completed, delayed and missed session outcomes, progress page
- Student-approved revisions for unfinished work. Accepting one replaces the active future sessions;
  earlier schedule versions are not kept (SPEC supersedes ADR 0003)
- Capacity and overload explanations when work cannot fit before its deadline
- Personal adaptive estimates, enabled only after enough history
- WebMCP tools for AI agents (below)

## WebMCP tools

StudyFlow exposes 9 WebMCP tools from the authenticated app shell. An agent can read a plan,
update tasks and study-time inputs, test hypothetical changes, and prepare revisions for student
review. Browsers without WebMCP use the normal app. Input schemas and safety rules are in the
[WebMCP workflow guide](docs/webmcp-workflow.md).

| Tool | Purpose |
| --- | --- |
| `studyflow_get_plan_state` | Read tasks, deadlines, study time, schedules, progress, proposals, capacity. |
| `studyflow_add_task` | Create one task without changing the active schedule. |
| `studyflow_update_study_time` | Replace preferences or weekly availability, confirm timezone, change blocked periods (removal needs confirmation). |
| `studyflow_update_task` | Edit, start, finish early or delete a task (the last two need confirmation). |
| `studyflow_simulate_plan` | Test temporary availability, blocked periods or deadlines without saving. |
| `studyflow_draft_plan` | Create an inactive proposal for review. |
| `studyflow_accept_plan` | Activate a pending proposal after explicit student approval. |
| `studyflow_reject_plan` | Reject a pending proposal. |
| `studyflow_record_missed` | Record a missed session and return an inactive recovery proposal if one exists. |

## Technology

- Frontend: Next.js 16, React 19, TypeScript, Tailwind CSS
- Backend: Python 3.12+, FastAPI, SQLAlchemy, Alembic
- Scheduling: Google OR-Tools CP-SAT
- Database: PostgreSQL
- Local services: Docker Compose, Mailpit
- Hosting: Render (API), Vercel (frontend), Neon (PostgreSQL); see
  [ADR 0005](docs/adr/0005-use-zero-cost-render-and-neon-deployment.md)

## Quick start

Prerequisites: Docker with Compose; Node.js 22 and [pnpm](https://pnpm.io/) for the frontend;
Python 3.12+ and [uv](https://docs.astral.sh/uv/) only for host-side backend checks.

From the repository root:

```bash
cp .env.example .env
docker compose up --build
```

In a second terminal:

```bash
cd frontend
pnpm install
pnpm dev
```

Open <http://localhost:3000>.

| Service | URL |
| --- | --- |
| Web application | <http://localhost:3000> |
| REST API | <http://localhost:8000> |
| API docs (non-production) | <http://localhost:8000/api/v1/docs> |
| Health / readiness (checks PostgreSQL) | <http://localhost:8000/api/v1/health>, <http://localhost:8000/api/v1/ready> |
| Mailpit inbox | <http://localhost:8025> |

The frontend sends API requests to its own `/api/v1/*` path; `frontend/proxy.ts` forwards them to
FastAPI (fallback: the `frontend/next.config.ts` rewrite), keeping authentication and CSRF
protection on one origin. Set `BACKEND_ORIGIN` in `frontend/.env.local` to use another backend.
The frontend uses a per-request nonce-based CSP ([security headers](docs/security-headers.md)).
Behind proxies, set `STUDYFLOW_TRUSTED_PROXY_HOPS` ([deployment guide](docs/deployment.md#client-ip-addresses-and-rate-limits)).

## Development

Backend, from `backend/`:

```bash
uv sync
uv run pytest --cov=studyflow --cov-branch
uv run ruff format --check .
uv run ruff check .
uv run mypy
```

Frontend, from `frontend/`: `pnpm lint`, `pnpm test:coverage` (CI requires 100% coverage),
`pnpm build`. Storybook: `pnpm storybook`, `pnpm build-storybook`, `pnpm test:storybook`,
`pnpm check:stories`.

CI runs `pip-audit` on locked backend dependencies; Dependabot opens weekly backend and frontend
updates and monthly GitHub Actions updates against `dev`. `pnpm test:nfr05` runs the automated
NFR-05 browser projects (`pnpm test:nfr05:install` first), nightly in
`.github/workflows/frontend-nightly.yml`. Playwright WebKit is not Apple Safari, so Mobile Safari
evidence still needs [the checklist](docs/nfr05-mobile-safari-checklist.md).
Postman collection and environments: `postman/`. Isolated evaluation stack: [docs/evaluation.md](docs/evaluation.md).

## Project structure

```text
studyflow/
|-- backend/                  FastAPI app, migrations, scheduler, tests, examples, benchmarks
|-- frontend/                 Next.js app, typed API client, WebMCP tools, tests
|-- docs/                     ADRs, deployment, backup/restore, evaluation, workflow guides
|-- postman/                  API collection and environments
|-- scripts/                  Backup/restore and repository workflow utilities
|-- compose.yaml              Local PostgreSQL, Mailpit, migrations, API
|-- compose.evaluation.yaml   Isolated evaluation stack
|-- render.yaml               Render blueprint (production and dev)
`-- SPEC.md                   Authoritative software specification
```

More detail: [backend](backend/README.md), [frontend](frontend/README.md),
[deployment](docs/deployment.md), [backup and restore](docs/backup-restore.md).

## License

[MIT](LICENSE).
