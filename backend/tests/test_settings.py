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


def test_settings_load_authentication_email_delivery_configuration(
    monkeypatch: MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("STUDYFLOW_SMTP_HOST", "smtp.example.com")
    monkeypatch.setenv("STUDYFLOW_SMTP_PORT", "587")
    monkeypatch.setenv("STUDYFLOW_SMTP_USERNAME", "mailer")
    monkeypatch.setenv("STUDYFLOW_SMTP_PASSWORD", "smtp-secret")
    monkeypatch.setenv("STUDYFLOW_SMTP_START_TLS", "true")
    monkeypatch.setenv("STUDYFLOW_EMAIL_FROM_ADDRESS", "no-reply@example.com")
    monkeypatch.setenv("STUDYFLOW_PUBLIC_APP_URL", "https://studyflow.example.com")

    settings = Settings()

    assert settings.smtp_host == "smtp.example.com"
    assert settings.smtp_port == 587
    assert settings.smtp_username == "mailer"
    assert settings.smtp_password is not None
    assert settings.smtp_password.get_secret_value() == "smtp-secret"
    assert settings.smtp_start_tls is True
    assert settings.email_from_address == "no-reply@example.com"
    assert settings.public_app_url == "https://studyflow.example.com"
    assert "smtp-secret" not in repr(settings)


def test_blank_smtp_credentials_disable_authentication(
    monkeypatch: MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("STUDYFLOW_SMTP_USERNAME", "")
    monkeypatch.setenv("STUDYFLOW_SMTP_PASSWORD", "")

    settings = Settings()

    assert settings.smtp_username is None
    assert settings.smtp_password is None


def test_google_oidc_configuration_is_secret_and_all_or_nothing() -> None:
    secret = SecretStr("google-secret")
    settings = Settings(
        google_oidc_client_id="google-client",
        google_oidc_client_secret=secret,
        google_oidc_redirect_uri="https://studyflow.example/api/v1/auth/google/callback",
    )

    assert settings.google_oidc_client_secret is secret
    assert "google-secret" not in repr(settings)
    with raises(ValidationError, match="must be configured together"):
        Settings(google_oidc_client_id="google-client")


def test_settings_reject_an_unsafe_public_app_url() -> None:
    with raises(ValidationError, match="Public app URL must use HTTP or HTTPS"):
        Settings(public_app_url="javascript:alert(1)")


@mark.parametrize(
    "public_app_url",
    ["https://studyflow.example/?tenant=1", "https://studyflow.example/#fragment"],
)
def test_settings_rejects_query_or_fragment_in_public_app_url(public_app_url: str) -> None:
    with raises(ValidationError, match="must not include a query or fragment"):
        Settings(public_app_url=public_app_url)


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
        public_app_url="https://studyflow.example.com",
        smtp_start_tls=True,
    )

    assert settings.database_url is database_url


def test_production_requires_https_verification_links() -> None:
    database_url = SecretStr(
        "postgresql+psycopg://studyflow:secret@database/studyflow?sslmode=require"
    )

    with raises(ValidationError, match="Production public app URL must use HTTPS"):
        Settings(
            environment=Environment.PRODUCTION,
            database_url=database_url,
            public_app_url="http://studyflow.example.com",
            smtp_start_tls=True,
        )


def test_production_requires_tls_for_authentication_email() -> None:
    database_url = SecretStr(
        "postgresql+psycopg://studyflow:secret@database/studyflow?sslmode=require"
    )

    with raises(ValidationError, match="Production SMTP delivery must use TLS"):
        Settings(
            environment=Environment.PRODUCTION,
            database_url=database_url,
            public_app_url="https://studyflow.example.com",
            smtp_start_tls=False,
        )
