from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError
from pytest import MonkeyPatch, mark, raises

from studyflow.app import create_app
from studyflow.settings import Settings

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
