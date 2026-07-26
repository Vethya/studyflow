import pytest
from httpx import ASGITransport, AsyncClient

from studyflow.app import create_app


@pytest.mark.anyio
async def test_health_endpoint_reports_the_api_is_healthy() -> None:
    transport = ASGITransport(app=create_app())

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/health")

    assert response.status_code == 200
    assert response.json() == {
        "service": "studyflow-api",
        "status": "ok",
        "version": "0.1.0",
    }
