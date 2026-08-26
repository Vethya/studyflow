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


def services() -> list[dict[str, Any]]:
    return [cast(dict[str, Any], service_config) for service_config in load_blueprint()["services"]]


def service(name: str = "studyflow-api") -> dict[str, Any]:
    return next(service_config for service_config in services() if service_config["name"] == name)


def environment(service_config: dict[str, Any]) -> dict[str, str | None]:
    return {entry["key"]: entry.get("value") for entry in service_config["envVars"]}


def test_blueprint_deploys_each_environment_from_its_own_branch() -> None:
    service_configs = {service_config["name"]: service_config for service_config in services()}

    assert set(service_configs) == {
        "studyflow-api",
        "studyflow-api-staging",
        "studyflow-api-dev",
    }
    assert {name: service_config["branch"] for name, service_config in service_configs.items()} == {
        "studyflow-api": "master",
        "studyflow-api-staging": "staging",
        "studyflow-api-dev": "dev",
    }
    environment_by_service = {
        name: environment(service_config)["STUDYFLOW_ENVIRONMENT"]
        for name, service_config in service_configs.items()
    }
    assert environment_by_service == {
        "studyflow-api": "production",
        "studyflow-api-staging": "production",
        "studyflow-api-dev": "production",
    }


def test_blueprint_uses_the_shared_frontend_for_authentication_links() -> None:
    public_app_urls = {
        environment(service_config)["STUDYFLOW_PUBLIC_APP_URL"] for service_config in services()
    }

    assert public_app_urls == {"https://studyflow.vercel.app"}


def test_blueprint_deploys_the_backend_docker_image_on_the_free_plan() -> None:
    api = service()

    assert api["type"] == "web"
    assert api["name"] == "studyflow-api"
    assert api["runtime"] == "docker"
    assert api["plan"] == "free"
    assert api["dockerfilePath"] == "./backend/Dockerfile"
    assert api["dockerContext"] == "./backend"


def test_blueprint_applies_migrations_before_the_server_starts() -> None:
    command = service()["dockerCommand"]

    assert "alembic upgrade head" in command
    assert command.index("alembic upgrade head") < command.index("uvicorn")
    assert "--host 0.0.0.0" in command


def test_blueprint_does_not_rely_on_paid_plan_features() -> None:
    assert "preDeployCommand" not in service()


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
        "STUDYFLOW_GOOGLE_OIDC_CLIENT_ID",
        "STUDYFLOW_GOOGLE_OIDC_CLIENT_SECRET",
        "STUDYFLOW_GOOGLE_OIDC_REDIRECT_URI",
    ]

    by_key = {entry["key"]: entry for entry in raw_variables}
    for secret in secrets:
        assert by_key[secret].get("sync") is False
        assert "value" not in by_key[secret]


def test_blueprint_requires_production_tls_for_email_delivery() -> None:
    variables = environment(service())

    assert variables["STUDYFLOW_SMTP_START_TLS"] == "true"


def test_blueprint_allows_the_shared_frontend_to_call_the_dev_service() -> None:
    variables = environment(service("studyflow-api-dev"))
    origins = (variables["STUDYFLOW_CORS_ORIGINS"] or "").split(",")

    assert origins == ["https://studyflow.vercel.app"]


def test_blueprint_does_not_expose_a_render_postgres_instance() -> None:
    blueprint = load_blueprint()

    assert "databases" not in blueprint
