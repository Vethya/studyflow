from typing import Any, cast

import pytest

from studyflow.app import create_app
from studyflow.settings import Environment, Settings


class TrackingDatabase:
    def __init__(self) -> None:
        self.events: list[str] = []

    async def start(self) -> None:
        self.events.append("started")

    async def stop(self) -> None:
        self.events.append("stopped")

    async def ping(self) -> None:
        pass


@pytest.mark.anyio
async def test_app_lifespan_owns_the_database_runtime() -> None:
    database = TrackingDatabase()
    app = create_app(
        Settings(environment=Environment.TEST),
        database=database,
    )

    assert database.events == []

    async with app.router.lifespan_context(app):
        assert database.events == ["started"]

    assert database.events == ["started", "stopped"]


@pytest.mark.anyio
async def test_app_lifespan_handles_an_injected_authentication_client_absence() -> None:
    database = TrackingDatabase()
    stub = cast(Any, object())
    app = create_app(
        Settings(environment=Environment.TEST),
        database=database,
        registration=stub,
        login=stub,
        verification_resend=stub,
        password_recovery=stub,
        account_passwords=stub,
        oidc_login=stub,
        oidc_account_linking=stub,
    )

    assert app.state.authentication_http_client is None
    async with app.router.lifespan_context(app):
        assert database.events == ["started"]

    assert database.events == ["started", "stopped"]


@pytest.mark.anyio
async def test_google_import_is_enabled_only_with_its_redirect_uri_and_closes_its_client() -> None:
    from pydantic import SecretStr

    from studyflow.integrations.google_import import (
        GoogleImportService,
        UnconfiguredGoogleImports,
    )

    oidc = {
        "google_oidc_client_id": "client-id",
        "google_oidc_client_secret": SecretStr("client-secret"),
        "google_oidc_redirect_uri": "https://studyflow.example/api/v1/auth/google/callback",
    }
    without_import = create_app(
        Settings(environment=Environment.TEST, **oidc),  # type: ignore[arg-type]
        database=TrackingDatabase(),
    )
    database = TrackingDatabase()
    with_import = create_app(
        Settings(
            environment=Environment.TEST,
            google_import_redirect_uri="https://studyflow.example/api/v1/integrations/google/callback",
            **oidc,  # type: ignore[arg-type]
        ),
        database=database,
    )

    assert isinstance(without_import.state.google_imports, UnconfiguredGoogleImports)
    assert without_import.state.google_import_http_client is None
    assert isinstance(with_import.state.google_imports, GoogleImportService)
    client = with_import.state.google_import_http_client
    async with with_import.router.lifespan_context(with_import):
        assert not client.is_closed
    assert client.is_closed
