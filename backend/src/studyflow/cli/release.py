"""Release checks for StudyFlow settings and schema.

Run from the backend directory (``/app`` in the container)::

    python -m studyflow.cli.release check-settings [--require-production]
    python -m studyflow.cli.release check-schema
    python -m studyflow.cli.release migrate

``check-schema`` compares the database with this build's migration heads.
``migrate`` applies pending migrations. The container start command is unchanged.
"""

import argparse
import asyncio
import sys
from collections.abc import Sequence
from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import Path
from typing import TextIO

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from pydantic import ValidationError
from sqlalchemy import Connection
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from studyflow.settings import Environment, Settings

DEFAULT_ALEMBIC_CONFIG = Path("alembic.ini")

EXAMPLE_FROM_ADDRESS = "no-reply@example.com"


class SchemaState(StrEnum):
    CURRENT = "current"
    BEHIND = "behind"
    ACCEPTED_NEWER = "accepted_newer"
    UNKNOWN = "unknown"


@dataclass(frozen=True)
class SchemaStatus:
    state: SchemaState
    database_revisions: tuple[str, ...]
    code_heads: tuple[str, ...]


@dataclass
class SettingsReport:
    settings: Settings | None
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def check_settings(
    *, require_production: bool = False, release_checks: bool = True
) -> SettingsReport:
    """Validate settings from the environment without printing any configured value.

    ``release_checks`` adds pre-release requirements that the application itself does not
    enforce, such as working email delivery. The container gate turns them off so it never
    refuses to start an instance that the application would have started.
    """
    try:
        settings = Settings()
    except ValidationError as error:
        return SettingsReport(
            settings=None,
            errors=[
                _describe_validation_error(detail["loc"], detail["msg"])
                for detail in error.errors(include_url=False, include_input=False)
            ],
        )

    report = SettingsReport(settings=settings)
    if require_production and settings.environment is not Environment.PRODUCTION:
        report.errors.append("STUDYFLOW_ENVIRONMENT must be production for a production release")
    if release_checks and settings.environment is Environment.PRODUCTION:
        if settings.smtp_username is None or settings.smtp_password is None:
            report.errors.append(
                "STUDYFLOW_SMTP_USERNAME and STUDYFLOW_SMTP_PASSWORD must be set so "
                "verification and password reset email can be delivered"
            )
        if str(settings.email_from_address) == EXAMPLE_FROM_ADDRESS:
            report.errors.append(
                "STUDYFLOW_EMAIL_FROM_ADDRESS must be an address on a verified sending domain"
            )
        if settings.trusted_proxy_hops == 0:
            report.warnings.append(
                "STUDYFLOW_TRUSTED_PROXY_HOPS is 0, so per-IP rate limits key on the proxy address"
            )
        if settings.google_oidc_client_id is None:
            report.warnings.append("Google sign-in and Google import are disabled")
    return report


def classify_schema(
    database_revisions: Sequence[str],
    script: ScriptDirectory,
    accepted_newer_revisions: Sequence[str] = (),
) -> SchemaStatus:
    """Compare the database's Alembic revisions with the migration heads in this build.

    A revision missing from this build is rejected unless the operator listed it in
    ``STUDYFLOW_ACCEPTED_NEWER_SCHEMA_REVISIONS``, for example while rolling back to the
    previous build after an additive release migration.
    """
    current = tuple(sorted(database_revisions))
    heads = tuple(sorted(script.get_heads()))
    known_revisions = {revision.revision for revision in script.walk_revisions()}
    unknown = [revision for revision in current if revision not in known_revisions]
    if unknown and all(revision in accepted_newer_revisions for revision in unknown):
        state = SchemaState.ACCEPTED_NEWER
    elif unknown:
        # A revision this build has never heard of could be a newer release, a branch that was
        # never merged, or a hand-edited alembic_version. None of them is safe by default.
        state = SchemaState.UNKNOWN
    elif current == heads:
        state = SchemaState.CURRENT
    else:
        state = SchemaState.BEHIND
    return SchemaStatus(state=state, database_revisions=current, code_heads=heads)


async def read_database_revisions(database_url: str) -> tuple[str, ...]:
    engine = create_async_engine(database_url, poolclass=NullPool)
    try:
        async with engine.connect() as connection:
            return await connection.run_sync(_current_heads)
    finally:
        await engine.dispose()


def check_schema(settings: Settings, alembic_config: Path) -> SchemaStatus:
    script = ScriptDirectory.from_config(Config(alembic_config))
    revisions = asyncio.run(read_database_revisions(settings.database_url.get_secret_value()))
    return classify_schema(revisions, script, settings.accepted_newer_schema_revisions)


def migrate(alembic_config: Path) -> None:
    """Apply all pending migrations; the migration environment serializes concurrent runs."""
    command.upgrade(Config(alembic_config), "head")


def main(argv: Sequence[str] | None = None, output: TextIO | None = None) -> int:
    stream = output if output is not None else sys.stderr
    parser = argparse.ArgumentParser(description="StudyFlow release gates")
    parser.add_argument(
        "--alembic-config",
        type=Path,
        default=DEFAULT_ALEMBIC_CONFIG,
        help="Path to alembic.ini (default: ./alembic.ini)",
    )
    subcommands = parser.add_subparsers(dest="command", required=True)
    settings_parser = subcommands.add_parser(
        "check-settings", help="Validate settings from the environment and exit"
    )
    settings_parser.add_argument(
        "--require-production",
        action="store_true",
        help="Fail unless STUDYFLOW_ENVIRONMENT is production",
    )
    subcommands.add_parser("check-schema", help="Fail unless the database is at this build's head")
    subcommands.add_parser("migrate", help="Validate settings, then apply pending migrations")
    args = parser.parse_args(argv)
    alembic_config: Path = args.alembic_config

    report = check_settings(
        require_production=getattr(args, "require_production", False),
        release_checks=args.command == "check-settings",
    )
    for warning in report.warnings:
        print(f"warning: {warning}", file=stream)
    for error in report.errors:
        print(f"error: {error}", file=stream)
    if report.settings is None or report.errors:
        print("Settings check failed.", file=stream)
        return 1
    settings = report.settings
    if args.command == "check-settings":
        print(f"Settings are valid for the {settings.environment} environment.", file=stream)
        return 0

    if args.command == "migrate":
        migrate(alembic_config)
        print("Migrations applied.", file=stream)
        return 0

    status = check_schema(settings, alembic_config)
    database = ", ".join(status.database_revisions) or "none"
    heads = ", ".join(status.code_heads)
    if status.state is SchemaState.BEHIND:
        print(
            f"error: database schema is at {database} but this build requires {heads}. "
            "Apply migrations with the release runbook (docs/release.md) before deploying.",
            file=stream,
        )
        return 1
    if status.state is SchemaState.UNKNOWN:
        print(
            f"error: database schema is at {database}, which this build ({heads}) does not "
            "know. Deploy the build that created that revision, or, after confirming it is an "
            "additive release migration, list it in STUDYFLOW_ACCEPTED_NEWER_SCHEMA_REVISIONS "
            "(docs/release.md).",
            file=stream,
        )
        return 1
    if status.state is SchemaState.ACCEPTED_NEWER:
        print(
            f"warning: database schema {database} is newer than this build ({heads}); "
            "continuing because STUDYFLOW_ACCEPTED_NEWER_SCHEMA_REVISIONS lists it.",
            file=stream,
        )
        return 0
    print(f"Database schema is current ({heads}).", file=stream)
    return 0


def _current_heads(connection: Connection) -> tuple[str, ...]:
    return tuple(MigrationContext.configure(connection).get_current_heads())


def _describe_validation_error(location: tuple[int | str, ...], message: str) -> str:
    if not location:
        return message
    field_names = ", ".join(f"STUDYFLOW_{str(part).upper()}" for part in location)
    return f"{field_names}: {message}"


if __name__ == "__main__":
    sys.exit(main())
