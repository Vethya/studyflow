import json
from collections.abc import Callable
from datetime import UTC, datetime
from urllib.parse import parse_qs

import httpx
import pytest

from studyflow.integrations.google_client import HttpGoogleImportClient
from studyflow.integrations.google_import import (
    GoogleImportNotConfiguredError,
    GoogleImportPermissionError,
    GoogleImportProviderUnavailableError,
    InvalidGoogleImportCallbackError,
)

ACCESS_TOKEN = "ya29.access"
REDIRECT_URI = "https://studyflow.example/api/v1/integrations/google/callback"


def client_for(handler: Callable[[httpx.Request], httpx.Response]) -> HttpGoogleImportClient:
    return HttpGoogleImportClient(
        httpx.AsyncClient(transport=httpx.MockTransport(handler)),
        "client-id",
        "client-secret",
        REDIRECT_URI,
    )


def google_error(status: int, reason: str) -> httpx.Response:
    return httpx.Response(
        status,
        json={
            "error": {
                "code": status,
                "status": "PERMISSION_DENIED",
                "details": [{"reason": reason}],
            }
        },
    )


@pytest.mark.anyio
async def test_code_exchange_sends_the_pkce_verifier_and_returns_granted_scopes() -> None:
    seen: dict[str, list[str]] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == "https://oauth2.googleapis.com/token"
        seen.update(parse_qs(request.content.decode()))
        return httpx.Response(
            200,
            json={"access_token": ACCESS_TOKEN, "scope": "a b", "expires_in": 3599},
        )

    token = await client_for(handler).exchange_code("auth-code", "verifier")

    assert seen["code_verifier"] == ["verifier"]
    assert seen["redirect_uri"] == [REDIRECT_URI]
    assert seen["grant_type"] == ["authorization_code"]
    assert token.access_token == ACCESS_TOKEN
    assert token.scopes == frozenset({"a", "b"})


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("response", "error"),
    [
        (httpx.Response(400, json={"error": "invalid_grant"}), InvalidGoogleImportCallbackError),
        (httpx.Response(401, json={"error": "invalid_client"}), GoogleImportNotConfiguredError),
        (httpx.Response(400, text="not json"), InvalidGoogleImportCallbackError),
        (httpx.Response(503), GoogleImportProviderUnavailableError),
        (httpx.Response(200, json={"access_token": ""}), InvalidGoogleImportCallbackError),
        (httpx.Response(200, text="not json"), GoogleImportProviderUnavailableError),
        (httpx.Response(200, json=["not", "an", "object"]), GoogleImportProviderUnavailableError),
    ],
)
async def test_code_exchange_failures_are_classified(
    response: httpx.Response, error: type[Exception]
) -> None:
    with pytest.raises(error):
        await client_for(lambda request: response).exchange_code("code", "verifier")


@pytest.mark.anyio
async def test_network_failures_are_temporary() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("offline", request=request)

    client = client_for(handler)
    with pytest.raises(GoogleImportProviderUnavailableError):
        await client.exchange_code("code", "verifier")
    with pytest.raises(GoogleImportProviderUnavailableError):
        await client.classroom_coursework(ACCESS_TOKEN)


@pytest.mark.anyio
async def test_calendar_events_follow_pages_with_a_bearer_token() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if "pageToken" not in request.url.params:
            return httpx.Response(200, json={"items": [{"id": "1"}, "junk"], "nextPageToken": "p2"})
        return httpx.Response(200, json={"items": [{"id": "2"}]})

    events = await client_for(handler).calendar_events(
        ACCESS_TOKEN,
        datetime(2026, 9, 18, 8, tzinfo=UTC),
        datetime(2026, 10, 16, 8, tzinfo=UTC),
    )

    assert events == [{"id": "1"}, {"id": "2"}]
    first = requests[0]
    assert first.url.path == "/calendar/v3/calendars/primary/events"
    assert first.headers["authorization"] == f"Bearer {ACCESS_TOKEN}"
    assert first.url.params["timeMin"] == "2026-09-18T08:00:00Z"
    assert first.url.params["timeMax"] == "2026-10-16T08:00:00Z"
    assert first.url.params["singleEvents"] == "true"
    assert requests[1].url.params["pageToken"] == "p2"


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("response", "error"),
    [
        (google_error(403, "accessNotConfigured"), GoogleImportNotConfiguredError),
        (google_error(403, "SERVICE_DISABLED"), GoogleImportNotConfiguredError),
        (google_error(403, "rateLimitExceeded"), GoogleImportProviderUnavailableError),
        (google_error(403, "insufficientPermissions"), GoogleImportPermissionError),
        (
            httpx.Response(401, json={"error": {"errors": [{"reason": "authError"}]}}),
            GoogleImportPermissionError,
        ),
        (httpx.Response(429), GoogleImportProviderUnavailableError),
        (httpx.Response(418, text="teapot"), GoogleImportProviderUnavailableError),
        (httpx.Response(404, json={"error": "flat"}), GoogleImportPermissionError),
    ],
)
async def test_api_errors_are_classified(response: httpx.Response, error: type[Exception]) -> None:
    with pytest.raises(error):
        await client_for(lambda request: response).calendar_events(
            ACCESS_TOKEN, datetime(2026, 9, 18, tzinfo=UTC), datetime(2026, 9, 19, tzinfo=UTC)
        )


@pytest.mark.anyio
async def test_classroom_merges_course_names_and_submission_states() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        # The raw path shows that course IDs are escaped before they reach Google.
        path = request.url.raw_path.decode().partition("?")[0]
        if path == "/v1/courses":
            assert request.url.params["studentId"] == "me"
            return httpx.Response(
                200,
                json={
                    "courses": [{"id": "c/1", "name": "Physics"}, {"id": "hidden"}, {"name": "x"}]
                },
            )
        if path == "/v1/courses/c%2F1/courseWork":
            return httpx.Response(
                200,
                json={"courseWork": [{"id": "w1", "title": "Lab"}, {"id": "w2", "title": "Quiz"}]},
            )
        if path == "/v1/courses/c%2F1/courseWork/-/studentSubmissions":
            assert request.url.params["userId"] == "me"
            return httpx.Response(
                200,
                json={
                    "studentSubmissions": [
                        {"courseWorkId": "w2", "state": "TURNED_IN"},
                        {"courseWorkId": 3, "state": "junk"},
                    ]
                },
            )
        if path.startswith("/v1/courses/hidden/"):
            return google_error(403, "PERMISSION_DENIED")
        raise AssertionError(path)

    coursework = await client_for(handler).classroom_coursework(ACCESS_TOKEN)

    assert coursework == [
        {
            "id": "w1",
            "title": "Lab",
            "courseId": "c/1",
            "submissionState": None,
            "courseName": "Physics",
        },
        {
            "id": "w2",
            "title": "Quiz",
            "courseId": "c/1",
            "submissionState": "TURNED_IN",
            "courseName": "Physics",
        },
    ]


def test_no_access_token_is_logged(caplog: pytest.LogCaptureFixture) -> None:
    import asyncio

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, content=json.dumps({"error": {"status": "UNAUTHENTICATED"}}))

    async def run() -> None:
        with pytest.raises(GoogleImportPermissionError):
            await client_for(handler).classroom_coursework(ACCESS_TOKEN)

    with caplog.at_level("WARNING"):
        asyncio.run(run())

    assert caplog.records
    assert all(ACCESS_TOKEN not in record.getMessage() for record in caplog.records)
    assert all(ACCESS_TOKEN not in str(record.__dict__) for record in caplog.records)
