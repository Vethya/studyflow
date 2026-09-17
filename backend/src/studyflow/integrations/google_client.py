"""HTTP access to Google's token, Calendar, and Classroom endpoints.

Access tokens only ever travel in the ``Authorization`` header of requests to
Google. They are never logged; log lines carry only the HTTP status and
Google's machine-readable error reason.
"""

import asyncio
import logging
from collections.abc import AsyncIterator, Mapping
from datetime import UTC, datetime
from typing import Any, cast
from urllib.parse import quote

import httpx

from studyflow.integrations.google_import import (
    MAX_CALENDAR_EVENTS,
    MAX_CLASSROOM_ITEMS,
    GoogleImportNotConfiguredError,
    GoogleImportPermissionError,
    GoogleImportProviderUnavailableError,
    GrantedGoogleToken,
    InvalidGoogleImportCallbackError,
    with_course_names,
)

GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"  # noqa: S105
CALENDAR_EVENTS_ENDPOINT = "https://www.googleapis.com/calendar/v3/calendars/primary/events"
CLASSROOM_API = "https://classroom.googleapis.com/v1"

MAX_PAGES = 5
MAX_COURSES = 50
COURSE_CONCURRENCY = 4

logger = logging.getLogger(__name__)


class HttpGoogleImportClient:
    def __init__(
        self,
        http_client: httpx.AsyncClient,
        client_id: str,
        client_secret: str,
        redirect_uri: str,
    ) -> None:
        self._http = http_client
        self._client_id = client_id
        self._client_secret = client_secret
        self._redirect_uri = redirect_uri

    async def exchange_code(self, code: str, code_verifier: str) -> GrantedGoogleToken:
        try:
            response = await self._http.post(
                GOOGLE_TOKEN_ENDPOINT,
                data={
                    "code": code,
                    "client_id": self._client_id,
                    "client_secret": self._client_secret,
                    "redirect_uri": self._redirect_uri,
                    "grant_type": "authorization_code",
                    "code_verifier": code_verifier,
                },
                headers={"Accept": "application/json"},
            )
        except httpx.RequestError as error:
            raise GoogleImportProviderUnavailableError from error
        if response.status_code == 429 or response.status_code >= 500:
            raise GoogleImportProviderUnavailableError
        if response.status_code != 200:
            logger.warning(
                "Google import token exchange rejected",
                extra={"status": response.status_code, "reason": _token_error(response)},
            )
            if _token_error(response) in {"invalid_client", "unauthorized_client"}:
                raise GoogleImportNotConfiguredError
            raise InvalidGoogleImportCallbackError
        payload = _json_object(response)
        access_token = payload.get("access_token")
        scope = payload.get("scope")
        if not isinstance(access_token, str) or not access_token or not isinstance(scope, str):
            raise InvalidGoogleImportCallbackError
        return GrantedGoogleToken(access_token, frozenset(scope.split()))

    async def calendar_events(
        self, access_token: str, time_min: datetime, time_max: datetime
    ) -> list[dict[str, Any]]:
        params = {
            "timeMin": _rfc3339(time_min),
            "timeMax": _rfc3339(time_max),
            "singleEvents": "true",
            "orderBy": "startTime",
            "maxResults": "250",
            "fields": (
                "items(id,status,summary,start,end,transparency,eventType,"
                "attendees(self,responseStatus)),nextPageToken"
            ),
        }
        events: list[dict[str, Any]] = []
        async for page in self._pages(CALENDAR_EVENTS_ENDPOINT, params, access_token):
            events.extend(_objects(page.get("items")))
            if len(events) >= MAX_CALENDAR_EVENTS:
                break
        return events[:MAX_CALENDAR_EVENTS]

    async def classroom_coursework(self, access_token: str) -> list[dict[str, Any]]:
        courses: list[dict[str, Any]] = []
        async for page in self._pages(
            f"{CLASSROOM_API}/courses",
            {
                "studentId": "me",
                "courseStates": "ACTIVE",
                "pageSize": "100",
                "fields": "courses(id,name),nextPageToken",
            },
            access_token,
        ):
            courses.extend(_objects(page.get("courses")))
            if len(courses) >= MAX_COURSES:
                break
        course_names = {
            str(course["id"]): str(course.get("name") or "")
            for course in courses[:MAX_COURSES]
            if isinstance(course.get("id"), str)
        }

        semaphore = asyncio.Semaphore(COURSE_CONCURRENCY)

        async def course_work(course_id: str) -> list[dict[str, Any]]:
            async with semaphore:
                return await self._course_work(access_token, course_id)

        per_course = await asyncio.gather(*(course_work(course_id) for course_id in course_names))
        coursework = [work for works in per_course for work in works]
        return with_course_names(coursework, course_names)[:MAX_CLASSROOM_ITEMS]

    async def _course_work(self, access_token: str, course_id: str) -> list[dict[str, Any]]:
        course_path = f"{CLASSROOM_API}/courses/{quote(course_id, safe='')}"
        try:
            work_items: list[dict[str, Any]] = []
            async for page in self._pages(
                f"{course_path}/courseWork",
                {
                    "courseWorkStates": "PUBLISHED",
                    "pageSize": "100",
                    "fields": "courseWork(id,courseId,title,dueDate,dueTime,alternateLink),"
                    "nextPageToken",
                },
                access_token,
            ):
                work_items.extend(_objects(page.get("courseWork")))
            states: dict[str, str] = {}
            async for page in self._pages(
                f"{course_path}/courseWork/-/studentSubmissions",
                {
                    "userId": "me",
                    "pageSize": "100",
                    "fields": "studentSubmissions(courseWorkId,state),nextPageToken",
                },
                access_token,
            ):
                for submission in _objects(page.get("studentSubmissions")):
                    work_id = submission.get("courseWorkId")
                    state = submission.get("state")
                    if isinstance(work_id, str) and isinstance(state, str):
                        states[work_id] = state
        except GoogleImportPermissionError:
            # One course can hide its coursework (for example, a teacher-only
            # course); the rest of the import is still useful.
            return []
        return [
            {**work, "courseId": course_id, "submissionState": states.get(str(work.get("id")))}
            for work in work_items
        ]

    async def _pages(
        self, url: str, params: Mapping[str, str], access_token: str
    ) -> AsyncIterator[dict[str, Any]]:
        page_token: str | None = None
        for _ in range(MAX_PAGES):
            query = dict(params)
            if page_token is not None:
                query["pageToken"] = page_token
            payload = await self._get(url, query, access_token)
            yield payload
            next_token = payload.get("nextPageToken")
            if not isinstance(next_token, str) or not next_token:
                return
            page_token = next_token

    async def _get(self, url: str, params: Mapping[str, str], access_token: str) -> dict[str, Any]:
        try:
            response = await self._http.get(
                url,
                params=params,
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Accept": "application/json",
                },
            )
        except httpx.RequestError as error:
            raise GoogleImportProviderUnavailableError from error
        if response.status_code == 200:
            return _json_object(response)
        reason = _api_error_reason(response)
        logger.warning(
            "Google import API request rejected",
            extra={"status": response.status_code, "reason": reason},
        )
        if response.status_code == 429 or response.status_code >= 500:
            raise GoogleImportProviderUnavailableError
        if response.status_code == 403 and reason in {"accessNotConfigured", "SERVICE_DISABLED"}:
            raise GoogleImportNotConfiguredError
        if response.status_code == 403 and reason in {"rateLimitExceeded", "userRateLimitExceeded"}:
            raise GoogleImportProviderUnavailableError
        if response.status_code in {401, 403, 404}:
            raise GoogleImportPermissionError
        raise GoogleImportProviderUnavailableError


def _rfc3339(value: datetime) -> str:
    return value.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _json_object(response: httpx.Response) -> dict[str, Any]:
    try:
        payload = response.json()
    except ValueError as error:
        raise GoogleImportProviderUnavailableError from error
    if not isinstance(payload, dict):
        raise GoogleImportProviderUnavailableError
    return cast(dict[str, Any], payload)


def _objects(value: object) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    return [cast(dict[str, Any], item) for item in value if isinstance(item, dict)]


def _token_error(response: httpx.Response) -> str | None:
    try:
        payload = response.json()
    except ValueError:
        return None
    error = payload.get("error") if isinstance(payload, dict) else None
    return error if isinstance(error, str) else None


def _api_error_reason(response: httpx.Response) -> str | None:
    try:
        payload = response.json()
    except ValueError:
        return None
    error = payload.get("error") if isinstance(payload, dict) else None
    if not isinstance(error, dict):
        return None
    for detail in _objects(error.get("details")):
        reason = detail.get("reason")
        if isinstance(reason, str):
            return reason
    for detail in _objects(error.get("errors")):
        reason = detail.get("reason")
        if isinstance(reason, str):
            return reason
    status = error.get("status")
    return status if isinstance(status, str) else None
