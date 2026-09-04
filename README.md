# StudyFlow

StudyFlow is a responsive study-planning application for university students. It turns
academic tasks and weekly availability into feasible study sessions, records what actually
happened, and proposes controlled schedule revisions when plans change.

## Features

- Email/password accounts, email verification, password recovery, and optional Google Sign-In
- Academic task management with deadlines, priorities, categories, courses, and effort estimates
- Recurring availability windows and dated unavailable periods
- Conflict-free schedule generation with task splitting and minimum breaks
- Completed, delayed, and missed study-session outcomes
- Student-approved schedule revisions for unfinished work
- Capacity and overload explanations when work cannot fit before its deadline
- Personal adaptive estimates based on previous estimated-versus-actual durations

## WebMCP tools

StudyFlow exposes 9 WebMCP tools from the authenticated app shell. An agent
can read a student's plan, update tasks and study-time inputs, test hypothetical
changes, and prepare schedule revisions for student review. Browsers without
WebMCP continue to work as a normal StudyFlow app.

| Tool | Purpose |
| --- | --- |
| `studyflow_get_plan_state` | Read tasks, deadlines, study time, schedules, progress, proposals, and capacity. |
| `studyflow_add_task` | Create one academic task without changing the active schedule. |
| `studyflow_update_study_time` | Replace planning preferences or weekly availability, and add, update, or remove blocked periods. |
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
sign in, and open it in ChatGPT's in-app browser or a Chrome environment with
WebMCP enabled.

## Technology

- **Frontend:** Next.js 16, React 19, TypeScript, Tailwind CSS
- **Backend:** Python 3.12, FastAPI, SQLAlchemy, Alembic
- **Scheduling:** Google OR-Tools CP-SAT
- **Database:** PostgreSQL
- **Local services:** Docker Compose and Mailpit

## Quick start

### Prerequisites

- Docker with Docker Compose
- Node.js and [pnpm](https://pnpm.io/) for the frontend

### 1. Start the backend services

From the repository root, copy the example environment file and set the frontend URL:

```bash
cp .env.example .env
```

In `.env`, set:

```dotenv
STUDYFLOW_PUBLIC_APP_URL=http://localhost:3000
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
| API documentation | <http://localhost:8000/api/v1/docs> |
| API health check | <http://localhost:8000/api/v1/health> |
| Mailpit inbox | <http://localhost:8025> |

The frontend sends API requests to its own `/api/v1/*` path and proxies them to FastAPI. This
keeps browser authentication and CSRF protection on one origin. To use a backend other than
`http://localhost:8000`, set `BACKEND_ORIGIN` in `frontend/.env.local`.

## Development

Run backend checks from `backend/`:

```bash
uv sync
uv run pytest
uv run pytest --cov=studyflow --cov-branch
uv run ruff format --check .
uv run ruff check .
uv run mypy
```

Run frontend checks from `frontend/`:

```bash
pnpm lint
pnpm build
```

The Postman collection is available at `postman/StudyFlow.postman_collection.json`, with local,
development, and production environments under `postman/environments/`.

## Project structure

```text
studyflow/
|-- backend/        FastAPI application, migrations, scheduler, and tests
|-- frontend/       Next.js application and typed API client
|-- docs/           Architecture decisions, deployment, and workflow guides
|-- postman/        API collection and environments
|-- scripts/        Repository workflow utilities and tests
|-- compose.yaml    Local PostgreSQL, Mailpit, migrations, and API services
|-- render.yaml     Render deployment blueprint
`-- SPEC.md         Authoritative software specification
```

For component-specific details, see the [backend guide](backend/README.md),
[frontend guide](frontend/README.md), and [deployment guide](docs/deployment.md).

## License

StudyFlow is available under the [MIT License](LICENSE).
