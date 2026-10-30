# StudyFlow

StudyFlow is a responsive study-planning application for university students. It turns
academic tasks and weekly availability into feasible study sessions, records what actually
happened, and proposes controlled schedule revisions when plans change.

## Features

- Email/password accounts, email verification, password recovery, and optional Google Sign-In
- Academic task management with deadlines, priorities, categories, courses, effort estimates,
  and start / finish-early lifecycle actions
- Google Calendar and Google Classroom import that previews items before creating tasks or
  blocked periods ([setup](docs/google-import-setup.md))
- Planning preferences (timezone, session length, minimum break), with timezone confirmation
- Recurring availability windows and dated unavailable periods
- Conflict-free schedule generation with task splitting and minimum breaks (OR-Tools CP-SAT).
  If the solver cannot conclude, StudyFlow reports a technical failure instead of inventing a fallback plan
- Calendar view and dashboard of the active schedule
- Completed, delayed, and missed study-session outcomes, and a progress page
- Student-approved schedule revisions for unfinished work. Accepting a revision replaces the
  active future sessions; earlier schedule versions are not kept
- Capacity and overload explanations when work cannot fit before its deadline
- Personal adaptive estimates based on previous estimated-versus-actual durations, enabled only
  after enough history
- WebMCP tools for AI agents in the authenticated app (see below)

## WebMCP tools

StudyFlow exposes 9 WebMCP tools from the authenticated app shell. An agent
can read a student's plan, update tasks and study-time inputs, test hypothetical
changes, and prepare schedule revisions for student review. Browsers without
WebMCP continue to work as a normal StudyFlow app.

| Tool | Purpose |
| --- | --- |
| `studyflow_get_plan_state` | Read tasks, deadlines, study time, schedules, progress, proposals, and capacity. |
| `studyflow_add_task` | Create one academic task without changing the active schedule. |
| `studyflow_update_study_time` | Replace planning preferences or weekly availability, confirm the timezone, and add, update, or remove blocked periods. Removing blocked periods requires student confirmation. |
| `studyflow_update_task` | Edit, start, finish early, or delete one task. Finishing early and deleting require confirmation. |
| `studyflow_simulate_plan` | Test temporary availability, blocked periods, or deadlines without persisting changes. |
| `studyflow_draft_plan` | Create an inactive study-plan proposal for student review. |
| `studyflow_accept_plan` | Activate one pending proposal after explicit student approval. |
| `studyflow_reject_plan` | Reject one pending proposal without changing the active schedule. |
| `studyflow_record_missed` | Record a missed session and return an inactive recovery proposal when one is available. |

A typical agent workflow is to read the current state, update or simulate the
student's inputs, draft a proposal, and let the student accept or reject it.
See the [WebMCP workflow guide](docs/webmcp-workflow.md) for input schemas,
outputs, and safety rules. To try the integration, run StudyFlow locally,
sign in, and open it in a browser with WebMCP enabled.

## Technology

- **Frontend:** Next.js 16, React 19, TypeScript, Tailwind CSS
- **Backend:** Python 3.12+, FastAPI, SQLAlchemy, Alembic
- **Scheduling:** Google OR-Tools CP-SAT
- **Database:** PostgreSQL
- **Local services:** Docker Compose and Mailpit
- **Hosting:** Render (API), Vercel (frontend), Neon (PostgreSQL); see
  [ADR 0005](docs/adr/0005-use-zero-cost-render-and-neon-deployment.md)

## Quick start

### Prerequisites

- Docker with Docker Compose
- Node.js 22 and [pnpm](https://pnpm.io/) for the frontend
- Python 3.12+ and [uv](https://docs.astral.sh/uv/) to run the backend checks below on the host.
  Starting the app with Docker Compose does not need them

### 1. Start the backend services

From the repository root, copy the example environment file. It already points
`STUDYFLOW_PUBLIC_APP_URL` at the local frontend (`http://localhost:3000`):

```bash
cp .env.example .env
```

Then start PostgreSQL, Mailpit, database migrations, and the API:

```bash
docker compose up --build
```

### 2. Start the frontend

In a second terminal:

```bash
cd frontend
pnpm install
pnpm dev
```

Open <http://localhost:3000>.

## Local services

| Service | URL |
| --- | --- |
| Web application | <http://localhost:3000> |
| REST API | <http://localhost:8000> |
| API documentation (non-production only) | <http://localhost:8000/api/v1/docs> |
| API health check | <http://localhost:8000/api/v1/health> |
| API readiness (checks PostgreSQL) | <http://localhost:8000/api/v1/ready> |
| Mailpit inbox | <http://localhost:8025> |

The frontend sends API requests to its own `/api/v1/*` path. `frontend/proxy.ts` forwards them
to FastAPI, with the `frontend/next.config.ts` rewrite as a fallback. This keeps browser
authentication and CSRF protection on one origin.
To use a backend other than `http://localhost:8000`, set `BACKEND_ORIGIN` in
`frontend/.env.local`.

The frontend uses a per-request nonce-based Content-Security-Policy and security headers
defined in `frontend/lib/security/headers.ts`. See the [security headers guide](docs/security-headers.md).
For deployments behind proxies, set `STUDYFLOW_TRUSTED_PROXY_HOPS` to the number of trusted
proxies that append to `X-Forwarded-For`. See the [deployment guide](docs/deployment.md#client-ip-addresses-and-rate-limits).

## Development

Run backend checks from `backend/`:

```bash
uv sync
uv run pytest --cov=studyflow --cov-branch
uv run ruff format --check .
uv run ruff check .
uv run mypy
```

Run frontend checks from `frontend/`:

```bash
pnpm lint
pnpm test:coverage   # Vitest; CI requires 100% statement, branch, function, and line coverage
pnpm build
```

From `frontend/`, `pnpm storybook` starts Storybook on port 6006, `pnpm build-storybook`
builds it, `pnpm test:storybook` runs its tests, and `pnpm check:stories` checks component
and page story coverage.

CI uses `pip-audit` to check locked backend runtime dependencies for known vulnerabilities.
Dependabot is configured to open weekly backend and frontend dependency updates and monthly
GitHub Actions updates against `dev`.

`pnpm test:nfr05` runs the automated NFR-05 browser projects (install browsers first with
`pnpm test:nfr05:install`). CI runs that job nightly in `.github/workflows/frontend-nightly.yml`.
Playwright WebKit is not Apple Safari, so the nightly job is not the full NFR-05 matrix.
Mobile Safari evidence still needs the checklist in `docs/nfr05-mobile-safari-checklist.md`.

The Postman collection is available at `postman/StudyFlow.postman_collection.json`, with local,
development, and production environments under `postman/environments/`. An isolated evaluation
stack is described in [docs/evaluation.md](docs/evaluation.md).

## Project structure

```text
studyflow/
|-- backend/                  FastAPI application, migrations, scheduler, and tests
|-- frontend/                 Next.js application, typed API client, WebMCP tools, tests
|-- docs/                     ADRs, deployment, backup/restore, evaluation, and workflow guides
|-- postman/                  API collection and environments
|-- scripts/                  Backup/restore and repository workflow utilities
|-- compose.yaml              Local PostgreSQL, Mailpit, migrations, and API services
|-- compose.evaluation.yaml   Isolated evaluation stack
|-- render.yaml               Render deployment blueprint (production and dev services)
`-- SPEC.md                   Authoritative software specification
```

For component-specific details, see the [backend guide](backend/README.md),
[frontend guide](frontend/README.md), [deployment guide](docs/deployment.md), and
[backup and restore guide](docs/backup-restore.md).

## License

StudyFlow is available under the [MIT License](LICENSE).
