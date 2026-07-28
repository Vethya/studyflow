from __future__ import annotations

import re
from pathlib import Path
from typing import Any, cast

import yaml

REPOSITORY_ROOT = Path(__file__).parents[2]
WORKFLOW_PATH = REPOSITORY_ROOT / ".github" / "workflows" / "backend-ci.yml"


def load_workflow() -> dict[str, Any]:
    return cast(
        dict[str, Any],
        yaml.safe_load(WORKFLOW_PATH.read_text()),
    )


def test_backend_ci_uses_read_only_permissions_and_concurrency() -> None:
    workflow = load_workflow()

    assert workflow["permissions"] == {"contents": "read"}
    assert workflow["concurrency"]["cancel-in-progress"] is True


def test_backend_ci_runs_every_quality_and_infrastructure_gate() -> None:
    workflow = load_workflow()
    backend_job = workflow["jobs"]["backend"]
    commands = "\n".join(step["run"] for step in backend_job["steps"] if "run" in step)

    assert "uv sync --locked" in commands
    assert "uv run ruff format --check ." in commands
    assert "uv run ruff check ." in commands
    assert "uv run mypy" in commands
    assert "uv run pytest --cov=studyflow --cov-branch" in commands
    assert "uv run alembic upgrade head" in commands
    assert "uv run alembic check" in commands
    assert "docker compose config --quiet" in commands
    assert "docker build" in commands


def test_database_environment_is_scoped_to_migrations() -> None:
    backend_job = load_workflow()["jobs"]["backend"]
    migration_step = next(
        step for step in backend_job["steps"] if step["name"] == "Apply and validate migrations"
    )

    assert "env" not in backend_job
    assert migration_step["env"] == {
        "STUDYFLOW_DATABASE_URL": (
            "postgresql+psycopg://studyflow:studyflow@127.0.0.1:5432/studyflow"
        ),
        "STUDYFLOW_ENVIRONMENT": "test",
    }


def test_backend_ci_pins_actions_and_postgres_by_sha() -> None:
    workflow = load_workflow()
    backend_job = workflow["jobs"]["backend"]

    assert "@sha256:" in backend_job["services"]["postgres"]["image"]
    for step in backend_job["steps"]:
        if action := step.get("uses"):
            assert re.fullmatch(r"[^@]+@[0-9a-f]{40}", action)
