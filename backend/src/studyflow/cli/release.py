"""Release checks for StudyFlow settings.

Run from the backend directory (``/app`` in the container)::

    python -m studyflow.cli.release check-settings [--require-production]

Later commands will check the schema and apply migrations. This command only
reports whether the environment can build ``Settings``.
"""

import argparse
import sys
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import TextIO

from pydantic import ValidationError

from studyflow.settings import Environment, Settings

DEFAULT_ALEMBIC_CONFIG = Path("alembic.ini")

EXAMPLE_FROM_ADDRESS = "no-reply@example.com"


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
    args = parser.parse_args(argv)

    report = check_settings(
        require_production=bool(args.require_production),
        release_checks=True,
    )
    for warning in report.warnings:
        print(f"warning: {warning}", file=stream)
    for error in report.errors:
        print(f"error: {error}", file=stream)
    if report.settings is None or report.errors:
        print("Settings check failed.", file=stream)
        return 1
    settings = report.settings
    print(f"Settings are valid for the {settings.environment} environment.", file=stream)
    return 0


def _describe_validation_error(location: tuple[int | str, ...], message: str) -> str:
    if not location:
        return message
    field_names = ", ".join(f"STUDYFLOW_{str(part).upper()}" for part in location)
    return f"{field_names}: {message}"


if __name__ == "__main__":
    sys.exit(main())
