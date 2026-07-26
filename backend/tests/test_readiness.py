import pytest
from httpx import ASGITransport, AsyncClient

from studyflow.app import create_app
from studyflow.settings import Environment, Settings


class ReachableDatabase:
    def __init__(self) -> None:
        self.ping_count = 0

    async def start(self) -> None:
        pass

    async def stop(self) -> None:
        pass

    async def ping(self) -> None:
        self.ping_count += 1


class UnreachableDatabase(ReachableDatabase):
    async def ping(self) -> None:
        raise RuntimeError("could not connect with password super-secret")


@pytest.mark.anyio
async def test_readiness_reports_a_reachable_database() -> None:
    database = ReachableDatabase()
    app = create_app(
        Settings(environment=Environment.TEST),
        database=database,
    )
    transport = ASGITransport(app=app)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/ready")

    assert response.status_code == 200
    assert response.json() == {
        "service": "studyflow-api",
        "status": "ready",
        "database": "reachable",
    }
    assert database.ping_count == 1


@pytest.mark.anyio
async def test_readiness_hides_database_connection_failures() -> None:
    app = create_app(
        Settings(environment=Environment.TEST),
        database=UnreachableDatabase(),
    )
    transport = ASGITransport(app=app, raise_app_exceptions=False)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/ready")

    assert response.status_code == 503
    assert response.json() == {"detail": "Database is unavailable"}
    assert "super-secret" not in response.text


@pytest.mark.anyio
async def test_liveness_does_not_depend_on_database_readiness() -> None:
    app = create_app(
        Settings(environment=Environment.TEST),
        database=UnreachableDatabase(),
    )
    transport = ASGITransport(app=app)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"
