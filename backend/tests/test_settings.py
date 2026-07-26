from pathlib import Path

from pydantic import SecretStr, ValidationError
from pytest import MonkeyPatch, mark, raises

from studyflow.app import create_app
from studyflow.settings import Environment, Settings


def test_settings_read_studyflow_prefixed_environment_variables(
    monkeypatch: MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("STUDYFLOW_ENVIRONMENT", "test")
    monkeypatch.setenv("STUDYFLOW_DEBUG", "true")
    monkeypatch.setenv("STUDYFLOW_LOG_LEVEL", "DEBUG")

    settings = Settings()

    assert settings.environment is Environment.TEST
    assert settings.debug is True
    assert settings.log_level == "DEBUG"


def test_app_factory_uses_explicit_settings() -> None:
    settings = Settings(environment=Environment.TEST, debug=True)

    app = create_app(settings)

    assert app.debug is True
    assert app.state.settings is settings


def test_production_rejects_debug_mode() -> None:
    with raises(ValidationError, match="Debug mode must be disabled in production"):
        Settings(environment=Environment.PRODUCTION, debug=True)


def test_settings_load_a_secret_postgresql_database_url(
    monkeypatch: MonkeyPatch,
    tmp_path: Path,
) -> None:
    database_url = "postgresql+psycopg://studyflow:super-secret@database/studyflow"
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("STUDYFLOW_DATABASE_URL", database_url)

    settings = Settings()

    assert settings.database_url.get_secret_value() == database_url
    assert "super-secret" not in repr(settings)


def test_settings_reject_a_non_postgresql_database_url() -> None:
    with raises(ValidationError, match="must use postgresql\\+psycopg"):
        Settings(database_url=SecretStr("sqlite+aiosqlite:///:memory:"))


@mark.parametrize(
    "database_url",
    [
        "postgresql+psycopg:///studyflow",
        "postgresql+psycopg://database",
    ],
)
def test_settings_reject_an_incomplete_postgresql_database_url(
    database_url: str,
) -> None:
    with raises(ValidationError, match="must include a host and database name"):
        Settings(database_url=SecretStr(database_url))


def test_production_requires_an_explicit_database_url() -> None:
    with raises(ValidationError, match="Production requires an explicit database URL"):
        Settings(environment=Environment.PRODUCTION)


def test_production_requires_encrypted_database_transport() -> None:
    database_url = SecretStr(
        "postgresql+psycopg://studyflow:secret@database/studyflow?sslmode=disable"
    )

    with raises(ValidationError, match="Production database URL must require TLS"):
        Settings(
            environment=Environment.PRODUCTION,
            database_url=database_url,
        )


def test_production_accepts_an_explicit_encrypted_database_url() -> None:
    database_url = SecretStr(
        "postgresql+psycopg://studyflow:secret@database/studyflow?sslmode=require"
    )

    settings = Settings(
        environment=Environment.PRODUCTION,
        database_url=database_url,
    )

    assert settings.database_url is database_url
