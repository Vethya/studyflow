# StudyFlow backend

The StudyFlow REST API is implemented with Python and FastAPI. The application exposes a
versioned API and generates its OpenAPI contract from the same route definitions used at
runtime.

## Run locally

```bash
uv sync
uv run uvicorn studyflow.app:app --reload
```

The initial public endpoints are:

- Health: <http://127.0.0.1:8000/api/v1/health>
- API documentation: <http://127.0.0.1:8000/api/v1/docs>
- OpenAPI schema: <http://127.0.0.1:8000/api/v1/openapi.json>

Application settings use the `STUDYFLOW_` prefix. For example,
`STUDYFLOW_ENVIRONMENT=test` selects the test environment and `STUDYFLOW_DEBUG=true` enables
FastAPI debug behavior.

## Verify

```bash
uv run pytest
uv run pytest --cov=studyflow --cov-branch
uv run ruff format --check .
uv run ruff check .
uv run mypy
```

Database, container, and CI commands will be added by their dedicated infrastructure PRs.
