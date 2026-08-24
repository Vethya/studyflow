from __future__ import annotations

import os
import runpy
import subprocess
import sys
from collections.abc import Callable
from contextlib import AbstractAsyncContextManager
from pathlib import Path
from types import TracebackType
from unittest.mock import Mock

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory

from studyflow.database import Base
from studyflow.database.migrations import get_database_url, target_metadata
from studyflow.settings import DEFAULT_DATABASE_URL

BACKEND_ROOT = Path(__file__).parents[1]
ALEMBIC_CONFIG = BACKEND_ROOT / "alembic.ini"


class FakeAsyncConnection:
    async def run_sync(self, callback: Callable[[object], None]) -> None:
        callback(object())


class FakeConnectionContext(AbstractAsyncContextManager[FakeAsyncConnection]):
    async def __aenter__(self) -> FakeAsyncConnection:
        return FakeAsyncConnection()

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        return None


class FakeAsyncEngine:
    def __init__(self) -> None:
        self.disposed = False

    def connect(self) -> FakeConnectionContext:
        return FakeConnectionContext()

    async def dispose(self) -> None:
        self.disposed = True


def run_alembic(*arguments: str) -> subprocess.CompletedProcess[str]:
    environment = os.environ.copy()
    environment["STUDYFLOW_ENVIRONMENT"] = "test"
    environment["STUDYFLOW_DATABASE_URL"] = DEFAULT_DATABASE_URL
    return subprocess.run(  # noqa: S603 - arguments are fixed by this test module
        [sys.executable, "-m", "alembic", "-c", str(ALEMBIC_CONFIG), *arguments],
        cwd=BACKEND_ROOT,
        env=environment,
        capture_output=True,
        check=False,
        text=True,
    )


def test_alembic_uses_the_canonical_migrations_directory() -> None:
    configuration = Config(ALEMBIC_CONFIG)

    scripts = ScriptDirectory.from_config(configuration)

    assert Path(scripts.dir).resolve() == BACKEND_ROOT / "migrations"


def test_migrations_share_application_metadata() -> None:
    assert target_metadata is Base.metadata


def test_migration_url_comes_from_validated_application_settings(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database_url = "postgresql+psycopg://user:secret@database:5432/studyflow"
    monkeypatch.setenv("STUDYFLOW_DATABASE_URL", database_url)

    assert get_database_url() == database_url


def test_alembic_configuration_does_not_contain_database_credentials() -> None:
    contents = ALEMBIC_CONFIG.read_text()

    assert "studyflow:studyflow" not in contents
    assert "sqlalchemy.url" not in contents


def test_alembic_cli_loads_the_migration_environment() -> None:
    result = run_alembic("heads")

    assert result.returncode == 0, result.stderr


def test_alembic_can_render_the_current_upgrade_path_offline() -> None:
    result = run_alembic("upgrade", "head", "--sql")

    assert result.returncode == 0, result.stderr
    assert "BEGIN;" in result.stdout
    assert "COMMIT;" in result.stdout
    assert "studyflow:studyflow" not in result.stdout


def test_account_authentication_schema_is_in_the_upgrade_path() -> None:
    result = run_alembic("upgrade", "head", "--sql")

    assert result.returncode == 0, result.stderr
    for table_name in (
        "student_accounts",
        "authentication_identities",
        "authentication_sessions",
        "authentication_email_tokens",
        "authentication_rate_limits",
        "authentication_registrations",
    ):
        assert f"CREATE TABLE {table_name}" in result.stdout

    expected_check_constraints = (
        "ck_student_accounts_email_canonical",
        "ck_student_accounts_preferred_session_length",
        "ck_student_accounts_minimum_break",
        "ck_authentication_identities_supported_provider",
        "ck_authentication_sessions_token_hash_length",
        "ck_authentication_sessions_csrf_token_hash_length",
        "ck_authentication_sessions_expiry_order",
        "ck_authentication_email_tokens_supported_purpose",
        "ck_authentication_email_tokens_token_hash_length",
        "ck_authentication_email_tokens_expiry_order",
        "ck_authentication_rate_limits_key_hash_length",
        "ck_authentication_rate_limits_positive_attempts",
    )
    for constraint_name in expected_check_constraints:
        assert f"CONSTRAINT {constraint_name} CHECK" in result.stdout
        assert f"ck_{constraint_name}" not in result.stdout
    assert "CREATE INDEX ix_authentication_rate_limits_window_started_at" in result.stdout
    assert "ADD COLUMN availability_timezone_confirmed BOOLEAN DEFAULT true NOT NULL" in (
        result.stdout
    )
    assert "CREATE TABLE academic_tasks" in result.stdout
    assert "CREATE TABLE task_deadline_history" in result.stdout
    assert "CREATE TABLE availability_windows" in result.stdout
    assert "CREATE TABLE unavailable_periods" in result.stdout
    assert "CREATE TABLE authentication_oidc_states" in result.stdout
    assert "CREATE TABLE authentication_oidc_link_challenges" in result.stdout
    assert "CREATE TABLE schedule_proposals" in result.stdout
    assert "CREATE TABLE study_sessions" in result.stdout
    assert "CREATE TABLE proposal_task_allocations" in result.stdout
    assert "CREATE TABLE study_session_outcomes" in result.stdout
    assert "CREATE TABLE schedule_recovery_snapshots" in result.stdout
    assert "CREATE TABLE recovery_task_work" in result.stdout
    assert (
        "FOREIGN KEY(missed_session_id) REFERENCES study_session_outcomes (session_id) "
        "ON DELETE CASCADE"
    ) in result.stdout
    for constraint_name in (
        "ck_academic_tasks_category",
        "ck_academic_tasks_priority",
        "ck_academic_tasks_positive_estimates",
        "ck_academic_tasks_planned_duration_source",
        "ck_academic_tasks_title_required",
        "ck_academic_tasks_course_length",
        "ck_academic_tasks_notes_length",
        "ck_academic_tasks_completion_requires_start",
    ):
        assert f"CONSTRAINT {constraint_name} CHECK" in result.stdout


def test_task_title_migration_preserves_postgresql_whitespace_regex() -> None:
    result = run_alembic("upgrade", "head", "--sql")

    assert result.returncode == 0, result.stderr
    assert "regexp_replace(title, E'[[:space:]]', '', 'g')" in result.stdout


def test_registration_migration_preserves_legacy_pending_accounts() -> None:
    result = run_alembic("upgrade", "head", "--sql")

    assert result.returncode == 0, result.stderr
    assert "INSERT INTO authentication_registrations" in result.stdout
    assert "UPDATE authentication_email_tokens" not in result.stdout
    assert "row_number() OVER" in result.stdout
    assert "verification_expires_at, created_at" in result.stdout
    assert "token.expires_at > CURRENT_TIMESTAMP" not in result.stdout


def test_online_environment_runs_migrations_and_disposes_engine(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from alembic import context
    from sqlalchemy.ext import asyncio as sqlalchemy_asyncio

    database_url = "postgresql+psycopg://user:secret@database:5432/studyflow"
    engine = FakeAsyncEngine()
    configure = Mock()
    run_migrations = Mock()
    engine_factory = Mock(return_value=engine)
    transaction = Mock()
    transaction.return_value.__enter__ = Mock()
    transaction.return_value.__exit__ = Mock(return_value=False)
    monkeypatch.setenv("STUDYFLOW_DATABASE_URL", database_url)
    monkeypatch.setattr(context, "config", Config(ALEMBIC_CONFIG), raising=False)
    monkeypatch.setattr(context, "is_offline_mode", lambda: False)
    monkeypatch.setattr(context, "configure", configure)
    monkeypatch.setattr(context, "begin_transaction", transaction)
    monkeypatch.setattr(context, "run_migrations", run_migrations)
    monkeypatch.setattr(sqlalchemy_asyncio, "async_engine_from_config", engine_factory)

    runpy.run_path(str(BACKEND_ROOT / "migrations" / "env.py"))

    configuration = engine_factory.call_args.args[0]
    assert configuration["sqlalchemy.url"] == database_url
    configure.assert_called_once()
    run_migrations.assert_called_once_with()
    assert engine.disposed is True
