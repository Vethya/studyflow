from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr, ValidationError
from pytest import MonkeyPatch, mark, raises

from studyflow.app import create_app
from studyflow.settings import Environment, Settings

CORS_ORIGINS = ["https://studyflow.vercel.app", "http://localhost:5173"]


def build_app(cors_origins: list[str] | None = None) -> FastAPI:
    settings = Settings(cors_origins=cors_origins) if cors_origins is not None else Settings()
    return create_app(settings)


@mark.anyio
async def test_cors_is_disabled_by_default() -> None:
    app = build_app()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get(
            "/api/v1/health", headers={"Origin": "https://studyflow.vercel.app"}
        )

    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers


@mark.anyio
async def test_allowed_origin_receives_cors_headers() -> None:
    app = build_app(CORS_ORIGINS)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get(
            "/api/v1/health", headers={"Origin": "https://studyflow.vercel.app"}
        )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == ("https://studyflow.vercel.app")
    assert response.headers["access-control-allow-credentials"] == "true"


@mark.anyio
async def test_preflight_from_an_allowed_origin_is_accepted() -> None:
    app = build_app(CORS_ORIGINS)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.options(
            "/api/v1/auth/login",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type,x-csrf-token",
            },
        )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert response.headers["access-control-allow-credentials"] == "true"
    assert "x-csrf-token" in response.headers["access-control-allow-headers"].lower()


@mark.anyio
async def test_disallowed_origin_receives_no_cors_headers() -> None:
    app = build_app(CORS_ORIGINS)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/v1/health", headers={"Origin": "https://evil.example"})

    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers


@mark.anyio
async def test_preflight_from_a_disallowed_origin_is_rejected() -> None:
    app = build_app(CORS_ORIGINS)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.options(
            "/api/v1/auth/login",
            headers={
                "Origin": "https://evil.example",
                "Access-Control-Request-Method": "POST",
            },
        )

    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers


def test_settings_split_a_comma_separated_origin_list(
    monkeypatch: MonkeyPatch,
) -> None:
    monkeypatch.setenv(
        "STUDYFLOW_CORS_ORIGINS",
        "https://studyflow.vercel.app/, http://localhost:5173,",
    )

    settings = Settings()

    assert settings.cors_origins == [
        "https://studyflow.vercel.app",
        "http://localhost:5173",
    ]


@mark.parametrize(
    "origin",
    [
        "javascript:alert(1)",
        "not-a-url",
        "https://studyflow.example.com/?tenant=1",
        "https://studyflow.example.com/app",
    ],
)
def test_settings_reject_invalid_cors_origins(origin: str) -> None:
    with raises(ValidationError):
        Settings(cors_origins=[origin])


def test_settings_accept_a_bare_trailing_slash_in_cors_origins() -> None:
    settings = Settings(cors_origins=["https://studyflow.example.com/"])

    assert settings.cors_origins == ["https://studyflow.example.com"]


def test_settings_reject_duplicate_cors_origins() -> None:
    with raises(ValidationError, match="must not contain duplicates"):
        Settings(cors_origins=["https://studyflow.example.com/", "https://studyflow.example.com"])


def production_settings(
    cors_origins: list[str], public_app_url: str = "https://studyflow.vercel.app"
) -> Settings:
    return Settings(
        environment=Environment.PRODUCTION,
        database_url=SecretStr(
            "postgresql+psycopg://studyflow:secret@db.example.com/studyflow?sslmode=require"
        ),
        public_app_url=public_app_url,
        smtp_start_tls=True,
        cors_origins=cors_origins,
    )


@mark.parametrize(
    "cors_origins",
    [
        [],
        ["https://studyflow.vercel.app"],
        ["https://studyflow.vercel.app/"],
        ["HTTPS://StudyFlow.Vercel.App"],
    ],
)
def test_production_accepts_no_cors_or_only_the_public_app_origin(
    cors_origins: list[str],
) -> None:
    settings = production_settings(cors_origins)

    assert len(settings.cors_origins) == len(cors_origins)


@mark.parametrize(
    ("cors_origins", "message"),
    [
        (["http://studyflow.vercel.app"], "Production CORS origins must use HTTPS"),
        (["http://localhost:3000"], "Production CORS origins must use HTTPS"),
        (["https://evil.example"], "Production CORS origins must match the public app URL"),
        (
            ["https://studyflow.vercel.app", "https://preview.vercel.app"],
            "Production CORS origins must match the public app URL",
        ),
        (
            ["https://studyflow.vercel.app:8443"],
            "Production CORS origins must match the public app URL",
        ),
        (
            ["https://studyflow.vercel.app.evil.example"],
            "Production CORS origins must match the public app URL",
        ),
    ],
)
def test_production_rejects_cors_origins_other_than_the_public_app(
    cors_origins: list[str], message: str
) -> None:
    with raises(ValidationError, match=message):
        production_settings(cors_origins)


def test_development_still_allows_local_cross_origin_frontends() -> None:
    settings = Settings(public_app_url="http://localhost:3000", cors_origins=CORS_ORIGINS)

    assert settings.cors_origins == CORS_ORIGINS


@mark.parametrize(
    ("public_app_url", "cors_origin"),
    [
        ("https://studyflow.vercel.app:443", "https://studyflow.vercel.app"),
        ("https://studyflow.vercel.app", "https://studyflow.vercel.app:443"),
        ("https://studyflow.vercel.app:443/", "https://StudyFlow.vercel.app:443/"),
        ("https://studyflow.vercel.app:8443", "https://studyflow.vercel.app:8443"),
    ],
)
def test_production_treats_default_ports_as_the_same_origin(
    public_app_url: str, cors_origin: str
) -> None:
    settings = production_settings([cors_origin], public_app_url=public_app_url)

    assert len(settings.cors_origins) == 1


@mark.parametrize(
    ("configured", "serialized"),
    [
        ("https://studyflow.vercel.app:443", "https://studyflow.vercel.app"),
        ("http://localhost:80/", "http://localhost"),
        ("HTTPS://StudyFlow.Vercel.App", "https://studyflow.vercel.app"),
        ("http://localhost:3000", "http://localhost:3000"),
        ("https://[2001:DB8::1]:443", "https://[2001:db8::1]"),
        ("http://localhost:443", "http://localhost:443"),
    ],
)
def test_cors_origins_are_stored_as_browsers_serialize_origin(
    configured: str, serialized: str
) -> None:
    assert Settings(cors_origins=[configured]).cors_origins == [serialized]


def test_settings_reject_cors_origins_that_only_differ_by_a_default_port() -> None:
    with raises(ValidationError, match="must not contain duplicates"):
        Settings(
            cors_origins=["https://studyflow.example.com", "https://studyflow.example.com:443"]
        )


@mark.anyio
async def test_origin_configured_with_its_default_port_still_receives_cors_headers() -> None:
    app = build_app(["https://studyflow.vercel.app:443"])

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get(
            "/api/v1/health", headers={"Origin": "https://studyflow.vercel.app"}
        )

    assert response.headers["access-control-allow-origin"] == "https://studyflow.vercel.app"
