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


@pytest.mark.anyio
async def test_documentation_routes_stay_under_the_versioned_api_prefix() -> None:
    transport = ASGITransport(app=create_app())

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        versioned_docs = await client.get("/api/v1/docs")
        versioned_oauth_redirect = await client.get("/api/v1/docs/oauth2-redirect")
        unversioned_redoc = await client.get("/redoc")
        unversioned_oauth_redirect = await client.get("/docs/oauth2-redirect")

    assert versioned_docs.status_code == 200
    assert versioned_oauth_redirect.status_code == 200
    assert unversioned_redoc.status_code == 404
    assert unversioned_oauth_redirect.status_code == 404


@pytest.mark.anyio
async def test_openapi_documents_database_unavailability() -> None:
    transport = ASGITransport(app=create_app())

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/openapi.json")

    unavailable_response = response.json()["paths"]["/api/v1/ready"]["get"]["responses"]["503"]
    assert unavailable_response["description"] == "Database is unavailable"
    assert unavailable_response["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/DatabaseUnavailableResponse"
    }


@pytest.mark.anyio
async def test_openapi_documents_registration_flow_failures() -> None:
    transport = ASGITransport(app=create_app())

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/openapi.json")

    registration_responses = response.json()["paths"]["/api/v1/auth/register"]["post"]["responses"]
    completion_responses = response.json()["paths"]["/api/v1/auth/complete-registration"]["post"][
        "responses"
    ]
    unavailable_response = completion_responses["503"]
    assert unavailable_response["description"] == "Password safety service is unavailable"
    assert unavailable_response["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/AuthenticationError"
    }
    assert registration_responses["429"]["description"] == "Too many registration attempts"


@pytest.mark.anyio
async def test_openapi_documents_verification_rate_limiting() -> None:
    transport = ASGITransport(app=create_app())

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/openapi.json")

    verification_responses = response.json()["paths"]["/api/v1/auth/verify-email"]["post"][
        "responses"
    ]
    assert verification_responses["429"]["description"] == "Too many verification attempts"


def test_openapi_documents_google_account_link_challenge() -> None:
    schema = create_app().openapi()

    conflict = schema["paths"]["/api/v1/auth/google/callback"]["get"]["responses"]["409"]
    assert conflict["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/OIDCLinkRequiredResponse"
    }
    assert schema["components"]["schemas"]["OIDCLinkRequiredResponse"]["required"] == [
        "detail",
        "link_challenge",
    ]


def test_openapi_documents_session_authentication_failures() -> None:
    schema = create_app().openapi()

    assert "401" in schema["paths"]["/api/v1/auth/session"]["get"]["responses"]
    assert "403" in schema["paths"]["/api/v1/auth/logout"]["post"]["responses"]
