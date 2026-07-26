import pytest
from httpx import ASGITransport, AsyncClient

from studyflow.app import create_app


@pytest.mark.anyio
async def test_versioned_openapi_describes_the_public_health_route() -> None:
    transport = ASGITransport(app=create_app())

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/openapi.json")

    assert response.status_code == 200
    schema = response.json()
    assert schema["info"] == {
        "title": "StudyFlow API",
        "version": "0.1.0",
    }
    assert "/api/v1/health" in schema["paths"]
