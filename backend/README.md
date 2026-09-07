# StudyFlow backend

The StudyFlow REST API is implemented with Python and FastAPI. The application exposes a
versioned API and generates its OpenAPI contract from the same route definitions used at
runtime.

## Run locally

```bash
cp .env.example .env
uv sync
uv run uvicorn studyflow.app:app --reload
```

Or start the complete development stack from the repository root:

```bash
cp .env.example .env
docker compose up --build
```

This runs migrations, then starts the API on <http://127.0.0.1:8000>, PostgreSQL on port `5432`,
and Mailpit's inbox on <http://127.0.0.1:8025> with SMTP on port `1025`. All published ports bind
to localhost only. The checked-in database credentials are local defaults only.

To change local database credentials, set `POSTGRES_DB`, `POSTGRES_USER`, and `POSTGRES_PASSWORD`
in the root `.env`, then set `STUDYFLOW_DATABASE_URL` to the matching complete URL. Percent-encode
reserved characters in the URL password; for example, use `%40` for `@`. PostgreSQL applies its
three `POSTGRES_*` initialization values only when the data directory is empty. For an existing
volume, rotate credentials inside PostgreSQL before updating `.env`; for disposable local data,
`docker compose down --volumes` deletes the volume so the next start can initialize it again.

PostgreSQL data persists in the `studyflow_postgres_data` Docker volume. Run
`docker compose down` to stop services without deleting that data.

The evaluation stack is isolated from development by using `compose.evaluation.yaml`, port 55432
for PostgreSQL, port 18000 for the API, and a separate Docker volume. See `docs/evaluation.md`.

The initial public endpoints are:

- Health: <http://127.0.0.1:8000/api/v1/health>
- Database readiness: <http://127.0.0.1:8000/api/v1/ready>
- API documentation: <http://127.0.0.1:8000/api/v1/docs>
- OpenAPI schema: <http://127.0.0.1:8000/api/v1/openapi.json>

Application settings use the `STUDYFLOW_` prefix. For example,
`STUDYFLOW_ENVIRONMENT=test` selects the test environment and `STUDYFLOW_DEBUG=true` enables
FastAPI debug behavior.

Google Sign-In is enabled only when `STUDYFLOW_GOOGLE_OIDC_CLIENT_ID`,
`STUDYFLOW_GOOGLE_OIDC_CLIENT_SECRET`, and `STUDYFLOW_GOOGLE_OIDC_REDIRECT_URI` are all set. Register
the redirect URI as `/api/v1/auth/google/callback` on the deployed HTTPS origin. The backend asks
only for `openid email profile`; it never stores Google access or refresh tokens.

## Test with Postman

Import `postman/StudyFlow.postman_collection.json` from the repository root. The collection uses
`http://127.0.0.1:8000` by default and includes assertions for every request. Import and select one
of the files in `postman/environments/` to target local, development, or production instead.

The development and production URLs are safe placeholders: update `base_url` in your local
Postman environment after importing. Keep credentials and other secrets in Postman's **current
value** fields so they are not exported back into the repository.

`STUDYFLOW_DATABASE_URL` must use the `postgresql+psycopg` driver and include a host and
database name. The checked-in example contains local-only development credentials. Production
refuses that default and requires an explicit URL with `sslmode=require`, `verify-ca`, or
`verify-full`. The application starts its SQLAlchemy pool during FastAPI lifespan and disposes it
during shutdown; it does not connect at module import.

The liveness endpoint remains available when PostgreSQL is down. The readiness endpoint executes
`SELECT 1` and returns a generic `503` if PostgreSQL cannot be reached within
`STUDYFLOW_DATABASE_READINESS_TIMEOUT_SECONDS` (two seconds by default).

## Verify

```bash
uv run pytest
uv run pytest --cov=studyflow --cov-branch
uv run ruff format --check .
uv run ruff check .
uv run mypy
```

GitHub Actions runs the same checks for backend, infrastructure, and Postman changes. It also
applies and validates Alembic against PostgreSQL, validates the Compose model, builds the backend
image, and enforces that the Postman request set stays synchronized with OpenAPI.

## Database migrations

Alembic reads the same validated `STUDYFLOW_DATABASE_URL` and SQLAlchemy metadata as the
application. Database credentials are never stored in `alembic.ini`, and application startup does
not apply migrations automatically.

```bash
uv run alembic upgrade head
uv run alembic downgrade -1
uv run alembic revision --autogenerate -m "describe the schema change"
uv run alembic upgrade head --sql
```

Verify there is exactly one migration head with `uv run alembic heads`. Use a disposable local
PostgreSQL database to verify a fresh `upgrade head`, `downgrade -1`, and re-upgrade; never run
destructive migration checks on shared data. From the repository root also run
`docker compose config --quiet`.

On native Windows, psycopg's async driver requires a selector event loop. If the normal Alembic
command fails with the Proactor-loop incompatibility, the following launcher changes only the
process event-loop policy (use the same launcher for downgrade):

```powershell
uv run python -c "import asyncio; asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy()); from alembic.config import main; main()" upgrade head
```

## Adaptive estimation API

- `GET /api/v1/adaptive-estimates/preview?category=reading&original_minutes=60` requires a
  session and returns a non-persisting preview: availability, original/adaptive/planned minutes,
  selected source, correction factor, history scope/count, and acknowledgment requirement.
- `POST /api/v1/adaptive-estimates/acknowledgments` requires a session and CSRF token, takes
  `{"category":"reading"}`, and returns 204 after acknowledging the current qualified factor.
  An unavailable estimate returns 422; an absent authenticated account returns 401.

Cold start uses Original. Five completed tasks with positive confirmed actual minutes enable
hidden pre-task predictions. These predictions count toward qualification only after their tasks
complete; historical completed tasks are not retroactively predicted. At least five evaluations
are required, and the most recent ten must reduce mean absolute error by at least 10% versus the
original estimates. A perfect original baseline cannot qualify. Accuracy/error metrics remain
internal and are omitted from student-facing responses.

Prediction uses the median actual/original ratio of the latest twenty eligible tasks. It uses
category history when at least five examples exist, otherwise overall history. Qualified Adaptive
is the default unless a large adjustment needs acknowledgment; callers may explicitly select
Original. Factors outside the inclusive 0.5–2.0 interval require acknowledgment and prompt again
after a relative change of at least 25%. Task writes atomically save the prediction and separate
original/adaptive/planned fields. Planned minutes come from the selected source; frozen task
estimates cannot be replaced. Unavailable previews expose no hidden adaptive value.

Task responses include `estimate_frozen`, derived from the persisted snapshot lock rather than
task status (an Overdue task may be frozen or editable). Frozen forms display their saved plan
read-only and permit unrelated edits with unchanged original minutes and planned source,
independent of live qualification or a newly required acknowledgment.

Task POST/PUT rejects stale, unqualified, or unacknowledged Adaptive selection with HTTP 409:
`{"detail":{"code":"adaptive_estimate_conflict","message":"..."}}`. The message directs the
student to refresh and choose Original or acknowledge the updated suggestion. The form retains
entered fields, refreshes the preview, and selects Original safely while the student reviews
the updated choices. Frozen-estimate conflicts remain 409 with their existing string detail;
ordinary validation errors remain 422. All adaptive minutes are still recomputed server-side.

Focused tests: `uv run pytest tests/test_adaptive_estimation.py
tests/test_adaptive_estimation_repository.py tests/test_adaptive_estimate_api.py` (one command).
The full coverage gate remains `uv run pytest --cov=studyflow --cov-branch`, with the configured
90% minimum.

## Evaluation and performance benchmarks

See `docs/evaluation.md` for full instructions.

- **Seed NFR-02 dataset:** `uv run python benchmarks/seed_nfr02.py`
- **Scheduler performance gate:** `uv run python benchmarks/scheduler_performance.py`
- **HTTP performance benchmark:** `uv run python benchmarks/http_performance.py`
- **Static vs adaptive comparison (§24.6):** `uv run python benchmarks/compare_static_adaptive.py`
- **Deterministic evaluation seed (§24.1):** `uv run python benchmarks/seed_evaluation.py`
- **Pseudonymized evaluation export (§24.4):** `uv run python -m studyflow.cli.export_evaluation --output eval.json`
- **Cross-user isolation matrix (§18.3):** `uv run pytest tests/test_cross_user_isolation.py`
