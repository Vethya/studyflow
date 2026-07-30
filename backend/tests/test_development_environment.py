from __future__ import annotations

from pathlib import Path
from typing import Any, cast

import yaml

REPOSITORY_ROOT = Path(__file__).parents[2]
BACKEND_ROOT = REPOSITORY_ROOT / "backend"


def load_compose() -> dict[str, Any]:
    return cast(dict[str, Any], yaml.safe_load((REPOSITORY_ROOT / "compose.yaml").read_text()))


def test_compose_defines_the_complete_local_backend_stack() -> None:
    services = load_compose()["services"]

    assert set(services) == {"backend", "migrate", "postgres", "mailpit"}
    assert services["backend"]["build"]["context"] == "./backend"
    assert services["postgres"]["image"].startswith("postgres:")
    assert services["mailpit"]["image"].startswith("axllent/mailpit:")


def test_backend_waits_for_healthy_postgres_and_uses_its_service_name() -> None:
    services = load_compose()["services"]
    backend = services["backend"]

    assert backend["depends_on"]["migrate"]["condition"] == "service_completed_successfully"
    assert services["migrate"]["depends_on"]["postgres"]["condition"] == "service_healthy"
    assert services["migrate"]["command"] == [".venv/bin/alembic", "upgrade", "head"]
    assert "@postgres:5432/" in backend["environment"]["STUDYFLOW_DATABASE_URL"]
    assert backend["environment"] == services["migrate"]["environment"]
    assert services["postgres"]["healthcheck"]["test"][0] == "CMD-SHELL"
    assert "-h 127.0.0.1" in services["postgres"]["healthcheck"]["test"][1]


def test_local_services_publish_expected_development_ports() -> None:
    services = load_compose()["services"]

    assert "127.0.0.1:8000:8000" in services["backend"]["ports"]
    assert "127.0.0.1:5432:5432" in services["postgres"]["ports"]
    assert "127.0.0.1:1025:1025" in services["mailpit"]["ports"]
    assert "127.0.0.1:8025:8025" in services["mailpit"]["ports"]


def test_postgres_data_is_persistent() -> None:
    compose = load_compose()

    assert "postgres_data" in compose["volumes"]
    assert "postgres_data:/var/lib/postgresql/data" in compose["services"]["postgres"]["volumes"]


def test_backend_image_is_locked_and_runs_as_non_root() -> None:
    dockerfile = (BACKEND_ROOT / "Dockerfile").read_text()

    assert dockerfile.count("@sha256:") == 2
    assert "uv sync --locked --no-dev" in dockerfile
    assert "USER studyflow" in dockerfile
    assert 'CMD [".venv/bin/uvicorn"' in dockerfile
    assert 'CMD ["uv", "run"' not in dockerfile
    assert "chown -R" not in dockerfile


def test_compose_images_are_pinned_by_digest() -> None:
    services = load_compose()["services"]

    assert "@sha256:" in services["postgres"]["image"]
    assert "@sha256:" in services["mailpit"]["image"]


def test_database_url_can_be_supplied_as_an_encoded_atomic_value() -> None:
    database_url = load_compose()["services"]["backend"]["environment"]["STUDYFLOW_DATABASE_URL"]

    assert database_url.startswith("${STUDYFLOW_DATABASE_URL:-")
    assert database_url.endswith("}")


def test_docker_context_excludes_local_and_secret_files() -> None:
    dockerignore = (BACKEND_ROOT / ".dockerignore").read_text().splitlines()

    assert ".env*" in dockerignore
    assert ".venv" in dockerignore
    assert "__pycache__" in dockerignore
    assert ".coverage" in dockerignore
