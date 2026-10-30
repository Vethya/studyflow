import io
from pathlib import Path

import pytest

from studyflow.cli.release import check_settings, main

BACKEND_ROOT = Path(__file__).parents[1]
ALEMBIC_CONFIG = BACKEND_ROOT / "alembic.ini"
SECRET_DATABASE_URL = (
    "postgresql+psycopg://studyflow:super-secret-password@db.example.com/studyflow"
)
PRODUCTION_ENVIRONMENT = {
    "STUDYFLOW_ENVIRONMENT": "production",
    "STUDYFLOW_DATABASE_URL": f"{SECRET_DATABASE_URL}?sslmode=require",
    "STUDYFLOW_PUBLIC_APP_URL": "https://studyflow.example.com",
    "STUDYFLOW_SMTP_HOST": "smtp.example.com",
    "STUDYFLOW_SMTP_USERNAME": "mailer",
    "STUDYFLOW_SMTP_PASSWORD": "smtp-secret-value",
    "STUDYFLOW_SMTP_START_TLS": "true",
    "STUDYFLOW_EMAIL_FROM_ADDRESS": "studyflow@mail.example.com",
    "STUDYFLOW_TRUSTED_PROXY_HOPS": "2",
}


@pytest.fixture
def production_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    for key, value in PRODUCTION_ENVIRONMENT.items():
        monkeypatch.setenv(key, value)


def run(*arguments: str) -> tuple[int, str]:
    output = io.StringIO()
    exit_code = main(["--alembic-config", str(ALEMBIC_CONFIG), *arguments], output)
    return exit_code, output.getvalue()


def test_development_settings_are_valid_without_production_values() -> None:
    report = check_settings()

    assert report.settings is not None
    assert report.errors == []
    assert report.warnings == []


@pytest.mark.usefixtures("production_environment")
def test_complete_production_settings_pass() -> None:
    report = check_settings(require_production=True)

    assert report.errors == []
    assert report.warnings == ["Google sign-in and Google import are disabled"]


def test_production_validator_failures_are_reported_without_secret_values(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("STUDYFLOW_ENVIRONMENT", "production")
    monkeypatch.setenv("STUDYFLOW_DATABASE_URL", SECRET_DATABASE_URL)

    exit_code, output = run("check-settings")

    assert exit_code == 1
    assert "Production database URL must require TLS" in output
    assert "super-secret-password" not in output
    assert "Settings check failed." in output


def test_field_validation_errors_name_the_environment_variable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("STUDYFLOW_TRUSTED_PROXY_HOPS", "9")

    report = check_settings()

    assert report.settings is None
    assert len(report.errors) == 1
    assert report.errors[0].startswith("STUDYFLOW_TRUSTED_PROXY_HOPS: ")


@pytest.mark.usefixtures("production_environment")
def test_production_release_requires_email_delivery_settings(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("STUDYFLOW_SMTP_PASSWORD")
    monkeypatch.setenv("STUDYFLOW_EMAIL_FROM_ADDRESS", "no-reply@example.com")
    monkeypatch.setenv("STUDYFLOW_TRUSTED_PROXY_HOPS", "0")

    report = check_settings()

    assert len(report.errors) == 2
    assert "STUDYFLOW_SMTP_PASSWORD" in report.errors[0]
    assert "STUDYFLOW_EMAIL_FROM_ADDRESS" in report.errors[1]
    assert any("STUDYFLOW_TRUSTED_PROXY_HOPS" in warning for warning in report.warnings)


def test_require_production_rejects_other_environments() -> None:
    exit_code, output = run("check-settings", "--require-production")

    assert exit_code == 1
    assert "STUDYFLOW_ENVIRONMENT must be production" in output


@pytest.mark.usefixtures("production_environment")
def test_check_settings_does_not_touch_the_database() -> None:
    # The database URL is not a reachable server. A connection attempt would fail.
    exit_code, output = run("check-settings", "--require-production")

    assert exit_code == 0
    assert "Settings are valid for the production environment." in output
