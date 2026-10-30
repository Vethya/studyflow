import io
import sqlite3
from contextlib import closing
from pathlib import Path
from unittest.mock import Mock

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory

from studyflow.cli import release
from studyflow.cli.release import SchemaState, check_settings, classify_schema, main

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
def script() -> ScriptDirectory:
    return ScriptDirectory.from_config(Config(ALEMBIC_CONFIG))


@pytest.fixture
def production_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    for key, value in PRODUCTION_ENVIRONMENT.items():
        monkeypatch.setenv(key, value)


def run(*arguments: str) -> tuple[int, str]:
    output = io.StringIO()
    exit_code = main(["--alembic-config", str(ALEMBIC_CONFIG), *arguments], output)
    return exit_code, output.getvalue()


def stub_database_revisions(
    monkeypatch: pytest.MonkeyPatch, revisions: tuple[str, ...]
) -> list[str]:
    requested_urls: list[str] = []

    async def read_database_revisions(database_url: str) -> tuple[str, ...]:
        requested_urls.append(database_url)
        return revisions

    monkeypatch.setattr(release, "read_database_revisions", read_database_revisions)
    return requested_urls


def stub_migrate(monkeypatch: pytest.MonkeyPatch) -> list[Path]:
    calls: list[Path] = []
    monkeypatch.setattr(release, "migrate", calls.append)
    return calls


def test_schema_at_every_head_is_current(script: ScriptDirectory) -> None:
    status = classify_schema(script.get_heads(), script)

    assert status.state is SchemaState.CURRENT
    assert status.database_revisions == status.code_heads


@pytest.mark.parametrize("revisions", [(), ("20260903_15",), ("20260918_22",)])
def test_missing_or_older_schema_is_behind(
    script: ScriptDirectory, revisions: tuple[str, ...]
) -> None:
    assert classify_schema(revisions, script).state is SchemaState.BEHIND


@pytest.mark.parametrize(
    "revisions", [("20991231_99",), ("20260918_23", "20991231_99"), ("not-a-revision",)]
)
def test_unknown_revision_is_rejected_rather_than_treated_as_ahead(
    script: ScriptDirectory, revisions: tuple[str, ...]
) -> None:
    assert classify_schema(revisions, script).state is SchemaState.UNKNOWN


@pytest.mark.anyio
async def test_database_revisions_are_read_from_the_alembic_version_table(
    tmp_path: Path,
) -> None:
    database_path = tmp_path / "revisions.sqlite"
    with closing(sqlite3.connect(database_path)) as connection:
        connection.execute("CREATE TABLE alembic_version (version_num VARCHAR(32) PRIMARY KEY)")
        connection.execute("INSERT INTO alembic_version VALUES ('20260918_23')")
        connection.commit()

    revisions = await release.read_database_revisions(f"sqlite+aiosqlite:///{database_path}")

    assert revisions == ("20260918_23",)


@pytest.mark.anyio
async def test_empty_database_has_no_revisions(tmp_path: Path) -> None:
    database_path = tmp_path / "empty.sqlite"

    assert await release.read_database_revisions(f"sqlite+aiosqlite:///{database_path}") == ()


def test_listed_newer_revision_is_accepted(script: ScriptDirectory) -> None:
    status = classify_schema(("20991231_99",), script, ["20991231_99"])

    assert status.state is SchemaState.ACCEPTED_NEWER


def test_accepting_one_revision_does_not_accept_another(script: ScriptDirectory) -> None:
    status = classify_schema(("20991231_99", "20991231_98"), script, ["20991231_99"])

    assert status.state is SchemaState.UNKNOWN


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


def test_boot_refuses_to_start_when_the_database_is_behind(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stub_database_revisions(monkeypatch, ("20260903_15",))
    migrations = stub_migrate(monkeypatch)

    exit_code, output = run("boot")

    assert exit_code == 1
    assert "database schema is at 20260903_15 but this build requires 20260918_23" in output
    assert "docs/release.md" in output
    assert migrations == []


def test_boot_starts_when_the_database_is_current(
    monkeypatch: pytest.MonkeyPatch, script: ScriptDirectory
) -> None:
    stub_database_revisions(monkeypatch, tuple(script.get_heads()))
    migrations = stub_migrate(monkeypatch)

    exit_code, output = run("boot")

    assert exit_code == 0
    assert "Database schema is current (20260918_23)." in output
    assert migrations == []


def test_boot_starts_on_a_newer_revision_the_operator_accepted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("STUDYFLOW_ACCEPTED_NEWER_SCHEMA_REVISIONS", " 20991231_99 , ")
    stub_database_revisions(monkeypatch, ("20991231_99",))

    exit_code, output = run("boot")

    assert exit_code == 0
    assert "newer than this build" in output


@pytest.mark.parametrize("command_name", ["boot", "check-schema"])
def test_unknown_database_revision_fails_the_gate(
    monkeypatch: pytest.MonkeyPatch, command_name: str
) -> None:
    stub_database_revisions(monkeypatch, ("20991231_99",))

    exit_code, output = run(command_name)

    assert exit_code == 1
    assert "database schema is at 20991231_99, which this build (20260918_23) does not know" in (
        output
    )
    assert "Database schema is current" not in output


def test_migrate_applies_migrations_without_checking_the_schema(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requested_urls = stub_database_revisions(monkeypatch, ())
    migrations = stub_migrate(monkeypatch)

    exit_code, output = run("migrate")

    assert exit_code == 0
    assert migrations == [ALEMBIC_CONFIG]
    assert requested_urls == []
    assert "Migrations applied." in output


def test_migrate_upgrades_the_configured_alembic_environment_to_head(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    upgrades: list[tuple[str | None, str]] = []

    def upgrade(config: Config, revision: str) -> None:
        upgrades.append((config.config_file_name, revision))

    monkeypatch.setattr(command, "upgrade", upgrade)

    release.migrate(ALEMBIC_CONFIG)

    assert upgrades == [(str(ALEMBIC_CONFIG), "head")]


def test_check_schema_reads_the_configured_database(
    monkeypatch: pytest.MonkeyPatch, script: ScriptDirectory
) -> None:
    requested_urls = stub_database_revisions(monkeypatch, tuple(script.get_heads()))
    monkeypatch.setenv("STUDYFLOW_DATABASE_URL", SECRET_DATABASE_URL)

    exit_code, _ = run("check-schema")

    assert exit_code == 0
    assert requested_urls == [SECRET_DATABASE_URL]


def test_boot_migrates_first_only_when_enabled(
    monkeypatch: pytest.MonkeyPatch, script: ScriptDirectory
) -> None:
    monkeypatch.setenv("STUDYFLOW_MIGRATE_ON_START", "true")
    stub_database_revisions(monkeypatch, tuple(script.get_heads()))
    migrations = stub_migrate(monkeypatch)

    exit_code, output = run("boot")

    assert exit_code == 0
    assert migrations == [ALEMBIC_CONFIG]
    assert "Migrations applied." in output


def test_boot_stops_before_checking_the_schema_when_migration_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("STUDYFLOW_MIGRATE_ON_START", "true")
    migrate = Mock(side_effect=RuntimeError("migration failed"))
    check_schema = Mock()
    monkeypatch.setattr(release, "migrate", migrate)
    monkeypatch.setattr(release, "check_schema", check_schema)

    with pytest.raises(RuntimeError, match="migration failed"):
        run("boot")

    migrate.assert_called_once_with(ALEMBIC_CONFIG)
    check_schema.assert_not_called()


def test_boot_does_not_migrate_with_invalid_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STUDYFLOW_MIGRATE_ON_START", "true")
    monkeypatch.setenv("STUDYFLOW_ENVIRONMENT", "production")
    migrations = stub_migrate(monkeypatch)

    exit_code, _ = run("boot")

    assert exit_code == 1
    assert migrations == []


@pytest.mark.usefixtures("production_environment")
def test_boot_is_not_stricter_than_the_application(
    monkeypatch: pytest.MonkeyPatch, script: ScriptDirectory
) -> None:
    monkeypatch.delenv("STUDYFLOW_SMTP_PASSWORD")
    stub_database_revisions(monkeypatch, tuple(script.get_heads()))

    exit_code, output = run("boot")

    assert exit_code == 0
    assert "error:" not in output
