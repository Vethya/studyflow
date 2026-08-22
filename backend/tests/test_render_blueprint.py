from __future__ import annotations

from pathlib import Path
from typing import Any, cast

import yaml

REPOSITORY_ROOT = Path(__file__).parents[2]
BLUEPRINT_PATH = REPOSITORY_ROOT / "render.yaml"


def load_blueprint() -> dict[str, Any]:
    return cast(
        dict[str, Any],
        yaml.safe_load(BLUEPRINT_PATH.read_text()),
    )


def service() -> dict[str, Any]:
    services = load_blueprint()["services"]
    assert len(services) == 1
    return cast(dict[str, Any], services[0])


def environment(service_config: dict[str, Any]) -> dict[str, str | None]:
    return {entry["key"]: entry.get("value") for entry in service_config["envVars"]}


def test_blueprint_deploys_the_backend_docker_image_on_the_free_plan() -> None:
    api = service()

    assert api["type"] == "web"
    assert api["name"] == "studyflow-api"
    assert api["runtime"] == "docker"
    assert api["plan"] == "free"
    assert api["dockerfilePath"] == "./backend/Dockerfile"
    assert api["dockerContext"] == "./backend"


def test_blueprint_applies_migrations_before_every_deploy() -> None:
    assert service()["preDeployCommand"] == ".venv/bin/alembic upgrade head"


def test_blueprint_checks_database_readiness_as_its_health_check() -> None:
    assert service()["healthCheckPath"] == "/api/v1/ready"


def test_blueprint_runs_in_production_with_proxy_headers_trusted() -> None:
    variables = environment(service())

    assert variables["STUDYFLOW_ENVIRONMENT"] == "production"
    assert variables["FORWARDED_ALLOW_IPS"] == "0.0.0.0/0"
    public_app_url = variables["STUDYFLOW_PUBLIC_APP_URL"]
    assert public_app_url is not None
    assert public_app_url.startswith("https://")


def test_blueprint_keeps_secrets_out_of_the_repository() -> None:
    raw_variables: list[dict[str, Any]] = service()["envVars"]
    secrets = [
        "STUDYFLOW_DATABASE_URL",
        "STUDYFLOW_SMTP_PASSWORD",
        "STUDYFLOW_GOOGLE_OIDC_CLIENT_SECRET",
    ]

    by_key = {entry["key"]: entry for entry in raw_variables}
    for secret in secrets:
        assert by_key[secret].get("sync") is False
        assert "value" not in by_key[secret]


def test_blueprint_requires_production_tls_for_email_delivery() -> None:
    variables = environment(service())

    assert variables["STUDYFLOW_SMTP_START_TLS"] == "true"


def test_blueprint_allows_local_frontend_development_origins() -> None:
    variables = environment(service())
    origins = (variables["STUDYFLOW_CORS_ORIGINS"] or "").split(",")

    assert "http://localhost:5173" in origins
    assert "http://localhost:3000" in origins


def test_blueprint_does_not_expose_a_render_postgres_instance() -> None:
    blueprint = load_blueprint()

    assert "databases" not in blueprint
