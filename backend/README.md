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

The initial public endpoints are:

- Health: <http://127.0.0.1:8000/api/v1/health>
- Database readiness: <http://127.0.0.1:8000/api/v1/ready>
- API documentation: <http://127.0.0.1:8000/api/v1/docs>
- OpenAPI schema: <http://127.0.0.1:8000/api/v1/openapi.json>

Application settings use the `STUDYFLOW_` prefix. For example,
`STUDYFLOW_ENVIRONMENT=test` selects the test environment and `STUDYFLOW_DEBUG=true` enables
FastAPI debug behavior.

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
`SELECT 1` and returns a generic `503` if PostgreSQL cannot be reached. The dedicated development
environment PR will add the local PostgreSQL container.

## Verify

```bash
uv run pytest
uv run pytest --cov=studyflow --cov-branch
uv run ruff format --check .
uv run ruff check .
uv run mypy
```

Migration, container, and CI commands will be added by their dedicated infrastructure PRs.
