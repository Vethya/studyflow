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


def test_openapi_documents_retry_after_for_google_provider_outages() -> None:
    schema = create_app().openapi()

    unavailable = schema["paths"]["/api/v1/auth/google/callback"]["get"]["responses"]["503"]
    assert unavailable["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/AuthenticationError"
    }
    assert unavailable["headers"]["Retry-After"]["schema"] == {"type": "integer"}


def test_openapi_documents_google_browser_callback_redirect() -> None:
    schema = create_app().openapi()

    redirect = schema["paths"]["/api/v1/auth/google/callback"]["get"]["responses"]["303"]
    assert redirect["description"] == "Browser flow redirected to a clean frontend route"


def test_openapi_preserves_google_callback_query_constraints() -> None:
    schema = create_app().openapi()
    parameters = {
        parameter["name"]: parameter
        for parameter in schema["paths"]["/api/v1/auth/google/callback"]["get"]["parameters"]
    }

    assert parameters["state"]["required"] is True
    assert parameters["state"]["schema"]["minLength"] == 20
    assert parameters["state"]["schema"]["maxLength"] == 512
    code_schema = parameters["code"]["schema"]["anyOf"][0]
    error_schema = parameters["error"]["schema"]["anyOf"][0]
    assert code_schema["minLength"] == 1
    assert code_schema["maxLength"] == 2048
    assert error_schema["maxLength"] == 200


def test_openapi_documents_browser_link_cookie_prerequisites() -> None:
    schema = create_app().openapi()
    operation = schema["paths"]["/api/v1/auth/google/link/browser"]["post"]
    cookie_parameters = {
        parameter["name"]: parameter
        for parameter in operation["parameters"]
        if parameter["in"] == "cookie"
    }

    assert "short-lived HttpOnly challenge cookie" in operation["description"]
    assert set(cookie_parameters) == {
        "studyflow_oidc_link",
        "__Host-studyflow_oidc_link",
    }
    assert "development" in cookie_parameters["studyflow_oidc_link"]["description"]
    assert "production" in cookie_parameters["__Host-studyflow_oidc_link"]["description"]


def test_openapi_documents_session_authentication_failures() -> None:
    schema = create_app().openapi()

    assert "401" in schema["paths"]["/api/v1/auth/session"]["get"]["responses"]
    assert "403" in schema["paths"]["/api/v1/auth/logout"]["post"]["responses"]
    assert "503" in schema["paths"]["/api/v1/auth/logout"]["post"]["responses"]


def test_openapi_documents_both_task_update_validation_error_shapes() -> None:
    schema = create_app().openapi()

    validation_schema = schema["paths"]["/api/v1/tasks/{task_id}"]["put"]["responses"]["422"][
        "content"
    ]["application/json"]["schema"]
    assert validation_schema == {
        "oneOf": [
            {"$ref": "#/components/schemas/TaskError"},
            {"$ref": "#/components/schemas/HTTPValidationError"},
        ]
    }


def test_openapi_documents_finish_early_lifecycle_conflict() -> None:
    schema = create_app().openapi()

    conflict = schema["paths"]["/api/v1/tasks/{task_id}/finish-early"]["post"]["responses"]["409"]
    assert conflict["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/TaskError"
    }


def test_openapi_documents_task_start_transition() -> None:
    schema = create_app().openapi()

    responses = schema["paths"]["/api/v1/tasks/{task_id}/start"]["post"]["responses"]
    assert set(responses) >= {"204", "401", "403", "404"}
    assert responses["404"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/TaskError"
    }


def test_openapi_documents_both_task_list_validation_error_shapes() -> None:
    schema = create_app().openapi()

    validation_schema = schema["paths"]["/api/v1/tasks"]["get"]["responses"]["422"]["content"][
        "application/json"
    ]["schema"]
    assert validation_schema == {
        "oneOf": [
            {"$ref": "#/components/schemas/TaskError"},
            {"$ref": "#/components/schemas/HTTPValidationError"},
        ]
    }


def test_openapi_documents_study_session_list_filters() -> None:
    schema = create_app().openapi()
    operation = schema["paths"]["/api/v1/study-sessions"]["get"]
    parameters = {parameter["name"]: parameter for parameter in operation["parameters"]}

    assert set(parameters) == {"from", "to", "task_id"}
    assert parameters["from"]["required"] is False
    assert parameters["to"]["required"] is False
    assert parameters["task_id"]["required"] is False
    assert set(operation["responses"]) >= {"200", "401", "422"}
