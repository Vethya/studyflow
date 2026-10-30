from __future__ import annotations

from pathlib import Path
from typing import Any, cast

import yaml

REPOSITORY_ROOT = Path(__file__).parents[2]
BLUEPRINT_PATH = REPOSITORY_ROOT / "render.yaml"
DOCKERFILE_PATH = REPOSITORY_ROOT / "backend" / "Dockerfile"


def load_blueprint() -> dict[str, Any]:
    return cast(
        dict[str, Any],
        yaml.safe_load(BLUEPRINT_PATH.read_text()),
    )


def services() -> list[dict[str, Any]]:
    return [
        cast(dict[str, Any], service_config)
        for project in load_blueprint()["projects"]
        for environment_config in project["environments"]
        for service_config in environment_config["services"]
    ]


def service(name: str = "studyflow-api") -> dict[str, Any]:
    return next(service_config for service_config in services() if service_config["name"] == name)


def environment(service_config: dict[str, Any]) -> dict[str, str | None]:
    return {entry["key"]: entry.get("value") for entry in service_config["envVars"]}


def test_blueprint_deploys_each_environment_from_its_own_branch() -> None:
    project = load_blueprint()["projects"][0]
    environments = {
        environment_config["name"]: environment_config
        for environment_config in project["environments"]
    }

    assert project["name"] == "StudyFlow"
    assert set(environments) == {"Production", "dev"}
    assert {
        name: [service_config["name"] for service_config in environment_config["services"]]
        for name, environment_config in environments.items()
    } == {
        "Production": ["studyflow-api"],
        "dev": ["studyflow-api-dev"],
    }

    service_configs = {service_config["name"]: service_config for service_config in services()}

    assert set(service_configs) == {
        "studyflow-api",
        "studyflow-api-dev",
    }
    assert {name: service_config["branch"] for name, service_config in service_configs.items()} == {
        "studyflow-api": "master",
        "studyflow-api-dev": "dev",
    }
    environment_by_service = {
        name: environment(service_config)["STUDYFLOW_ENVIRONMENT"]
        for name, service_config in service_configs.items()
    }
    assert environment_by_service == {
        "studyflow-api": "production",
        "studyflow-api-dev": "production",
    }


def raw_variable(service_name: str, key: str) -> dict[str, Any]:
    return next(entry for entry in service(service_name)["envVars"] if entry["key"] == key)


def test_production_links_point_at_the_production_frontend() -> None:
    assert environment(service())["STUDYFLOW_PUBLIC_APP_URL"] == "https://studyflow.vercel.app"


def test_dev_frontend_origin_is_entered_per_deployment_not_shared() -> None:
    for key in ("STUDYFLOW_PUBLIC_APP_URL", "STUDYFLOW_CORS_ORIGINS"):
        entry = raw_variable("studyflow-api-dev", key)
        assert entry.get("sync") is False
        assert "value" not in entry


def test_blueprint_deploys_the_backend_docker_image_on_the_free_plan() -> None:
    api = service()

    assert api["type"] == "web"
    assert api["name"] == "studyflow-api"
    assert api["runtime"] == "docker"
    assert api["plan"] == "free"
    assert api["dockerfilePath"] == "./backend/Dockerfile"
    assert api["dockerContext"] == "./backend"


def test_blueprint_applies_migrations_before_the_server_starts() -> None:
    dockerfile = DOCKERFILE_PATH.read_text()

    assert "alembic upgrade head" in dockerfile
    assert dockerfile.index("alembic upgrade head") < dockerfile.index("uvicorn")
    assert "--host 0.0.0.0" in dockerfile
    assert "exec .venv/bin/uvicorn" in dockerfile


def test_blueprint_uses_the_dockerfile_start_command() -> None:
    assert all("dockerCommand" not in service_config for service_config in services())


def test_blueprint_does_not_rely_on_paid_plan_features() -> None:
    assert "preDeployCommand" not in service()


def test_blueprint_uses_the_database_free_liveness_endpoint_as_its_health_check() -> None:
    assert {service_config["healthCheckPath"] for service_config in services()} == {
        "/api/v1/health"
    }


def test_blueprint_runs_in_production_over_https() -> None:
    variables = environment(service())

    assert variables["STUDYFLOW_ENVIRONMENT"] == "production"
    public_app_url = variables["STUDYFLOW_PUBLIC_APP_URL"]
    assert public_app_url is not None
    assert public_app_url.startswith("https://")


def test_blueprint_trusts_only_the_render_proxy_chain_for_client_addresses() -> None:
    for service_config in services():
        variables = environment(service_config)

        assert "FORWARDED_ALLOW_IPS" not in variables
        assert variables["STUDYFLOW_TRUSTED_PROXY_HOPS"] == "3"


def test_blueprint_reads_the_frontend_proxy_secret_from_the_dashboard() -> None:
    for service_config in services():
        by_key = {entry["key"]: entry for entry in service_config["envVars"]}

        assert by_key["STUDYFLOW_FRONTEND_PROXY_SECRET"].get("sync") is False
        assert "value" not in by_key["STUDYFLOW_FRONTEND_PROXY_SECRET"]


def test_dockerfile_disables_uvicorn_proxy_header_rewriting() -> None:
    dockerfile = DOCKERFILE_PATH.read_text()

    assert "--no-proxy-headers" in dockerfile


def test_blueprint_keeps_secrets_out_of_the_repository() -> None:
    raw_variables: list[dict[str, Any]] = service()["envVars"]
    secrets = [
        "STUDYFLOW_DATABASE_URL",
        "STUDYFLOW_FRONTEND_PROXY_SECRET",
        "STUDYFLOW_SMTP_PASSWORD",
        "STUDYFLOW_GOOGLE_OIDC_CLIENT_ID",
        "STUDYFLOW_GOOGLE_OIDC_CLIENT_SECRET",
        "STUDYFLOW_GOOGLE_OIDC_REDIRECT_URI",
        "STUDYFLOW_GOOGLE_IMPORT_REDIRECT_URI",
    ]

    by_key = {entry["key"]: entry for entry in raw_variables}
    for secret in secrets:
        assert by_key[secret].get("sync") is False
        assert "value" not in by_key[secret]


def test_blueprint_requires_production_tls_for_email_delivery() -> None:
    variables = environment(service())

    assert variables["STUDYFLOW_SMTP_START_TLS"] == "true"


def test_no_service_hardcodes_the_production_frontend_as_a_cors_origin() -> None:
    for service_config in services():
        assert environment(service_config).get("STUDYFLOW_CORS_ORIGINS") is None


def test_blueprint_does_not_expose_a_render_postgres_instance() -> None:
    blueprint = load_blueprint()

    assert "databases" not in blueprint
