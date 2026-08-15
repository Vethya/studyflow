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

The first domain schema PR will add the first revision. CI commands will be added by its dedicated
infrastructure PR.
