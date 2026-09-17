"""One-time Google Calendar and Google Classroom import endpoints."""

import logging
from datetime import datetime
from typing import Annotated, Literal, cast
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, ConfigDict, Field
from starlette.responses import RedirectResponse

from studyflow.api.account import AccountError, require_csrf_session, require_session
from studyflow.auth.cookies import CookiePolicy
from studyflow.auth.rate_limits import (
    GoogleImportStartRateLimit,
    GoogleImportStartRateLimitExceeded,
)
from studyflow.auth.session_authentication import SessionPrincipal
from studyflow.integrations.google_import import (
    DEFAULT_CALENDAR_HORIZON_DAYS,
    MAX_CALENDAR_EVENTS,
    MAX_CALENDAR_HORIZON_DAYS,
    MAX_CLASSROOM_ITEMS,
    MAX_TASK_ESTIMATE_MINUTES,
    CalendarImportPreview,
    ClassroomSelection,
    GoogleImportNotConfiguredError,
    GoogleImportNotFoundError,
    GoogleImportPermissionError,
    GoogleImportProviderUnavailableError,
    GoogleImports,
    GoogleImportSource,
    GoogleImportStart,
    InvalidGoogleImportCallbackError,
    UnknownGoogleImportItemError,
)
from studyflow.tasks.service import TaskCategory, TaskPriority

router = APIRouter(prefix="/integrations/google", tags=["Google Import"])
logger = logging.getLogger(__name__)

NOT_CONFIGURED = "Google import is not configured"
IMPORT_NOT_FOUND = "Import not found or expired"

type ImportErrorCode = Literal["denied", "invalid", "permission", "unavailable", "not-configured"]


class GoogleImportError(BaseModel):
    detail: str


class GoogleImportStatusResponse(BaseModel):
    configured: bool


class GoogleImportStartResponse(BaseModel):
    authorization_url: str


class CalendarImportStartRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    horizon_days: Annotated[int, Field(ge=1, le=MAX_CALENDAR_HORIZON_DAYS)] = (
        DEFAULT_CALENDAR_HORIZON_DAYS
    )


class ClassroomImportStartRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CalendarImportItemResponse(BaseModel):
    id: str
    title: str
    starts_at: datetime
    ends_at: datetime
    all_day: bool
    status: Literal["new", "changed", "unchanged"]


class ClassroomImportItemResponse(BaseModel):
    id: str
    title: str
    course: str | None
    due_at: datetime
    link: str | None
    suggested_category: TaskCategory
    status: Literal["new", "already_imported"]


class CalendarImportResponse(BaseModel):
    id: UUID
    source: Literal["google_calendar"] = "google_calendar"
    expires_at: datetime
    items: list[CalendarImportItemResponse]


class ClassroomImportResponse(BaseModel):
    id: UUID
    source: Literal["google_classroom"] = "google_classroom"
    expires_at: datetime
    items: list[ClassroomImportItemResponse]


class CalendarImportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    item_ids: Annotated[
        list[Annotated[str, Field(min_length=64, max_length=64)]],
        Field(min_length=1, max_length=MAX_CALENDAR_EVENTS),
    ]


class CalendarImportResultResponse(BaseModel):
    created: int
    updated: int
    unchanged: int
    skipped_past: int
    invalidated_future_session_ids: list[UUID]


class ClassroomSelectionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: Annotated[str, Field(min_length=64, max_length=64)]
    category: TaskCategory
    priority: TaskPriority = TaskPriority.MEDIUM
    estimate_minutes: Annotated[int, Field(gt=0, le=MAX_TASK_ESTIMATE_MINUTES)]


class ClassroomImportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: Annotated[
        list[ClassroomSelectionRequest], Field(min_length=1, max_length=MAX_CLASSROOM_ITEMS)
    ]


class ClassroomImportFailureResponse(BaseModel):
    id: str
    reason: Literal["deadline_passed", "invalid"]


class ClassroomImportResultResponse(BaseModel):
    created_task_ids: list[UUID]
    already_imported: list[str]
    failed: list[ClassroomImportFailureResponse]


def get_google_imports(request: Request) -> GoogleImports:
    return cast(GoogleImports, request.app.state.google_imports)


def get_google_import_start_rate_limit(request: Request) -> GoogleImportStartRateLimit:
    return cast(GoogleImportStartRateLimit, request.app.state.google_import_start_rate_limiter)


def get_cookie_policy(request: Request) -> CookiePolicy:
    return cast(CookiePolicy, request.app.state.cookie_policy)


START_RESPONSES: dict[int | str, dict[str, object]] = {
    status.HTTP_401_UNAUTHORIZED: {"model": AccountError},
    status.HTTP_403_FORBIDDEN: {"model": AccountError},
    status.HTTP_429_TOO_MANY_REQUESTS: {"model": GoogleImportError},
    status.HTTP_503_SERVICE_UNAVAILABLE: {"model": GoogleImportError},
}


@router.get(
    "/status",
    response_model=GoogleImportStatusResponse,
    responses={status.HTTP_401_UNAUTHORIZED: {"model": AccountError}},
)
async def get_google_import_status(
    principal: Annotated[SessionPrincipal, Depends(require_session)],
    imports: Annotated[GoogleImports, Depends(get_google_imports)],
) -> GoogleImportStatusResponse:
    return GoogleImportStatusResponse(configured=imports.configured)


async def _start(
    source: GoogleImportSource,
    horizon_days: int,
    principal: SessionPrincipal,
    response: Response,
    http_request: Request,
    imports: GoogleImports,
    rate_limit: GoogleImportStartRateLimit,
) -> GoogleImportStartResponse:
    try:
        client_ip = http_request.client.host if http_request.client is not None else "unknown"
        await rate_limit.check(client_ip, str(principal.account_id))
        started: GoogleImportStart = await imports.start(principal.account_id, source, horizon_days)
    except GoogleImportStartRateLimitExceeded as error:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many Google import attempts",
            headers={"Retry-After": "900"},
        ) from error
    except GoogleImportNotConfiguredError as error:
        raise HTTPException(status_code=503, detail=NOT_CONFIGURED) from error
    except GoogleImportNotFoundError as error:
        raise HTTPException(status_code=401, detail="Not authenticated") from error
    response.headers["Cache-Control"] = "no-store"
    get_cookie_policy(http_request).set_google_import_state(response, started.state)
    return GoogleImportStartResponse(authorization_url=started.authorization_url)


@router.post("/calendar/start", response_model=GoogleImportStartResponse, responses=START_RESPONSES)
async def start_google_calendar_import(
    payload: CalendarImportStartRequest,
    principal: Annotated[SessionPrincipal, Depends(require_csrf_session)],
    response: Response,
    http_request: Request,
    imports: Annotated[GoogleImports, Depends(get_google_imports)],
    rate_limit: Annotated[GoogleImportStartRateLimit, Depends(get_google_import_start_rate_limit)],
) -> GoogleImportStartResponse:
    return await _start(
        GoogleImportSource.CALENDAR,
        payload.horizon_days,
        principal,
        response,
        http_request,
        imports,
        rate_limit,
    )


@router.post(
    "/classroom/start", response_model=GoogleImportStartResponse, responses=START_RESPONSES
)
async def start_google_classroom_import(
    payload: ClassroomImportStartRequest,
    principal: Annotated[SessionPrincipal, Depends(require_csrf_session)],
    response: Response,
    http_request: Request,
    imports: Annotated[GoogleImports, Depends(get_google_imports)],
    rate_limit: Annotated[GoogleImportStartRateLimit, Depends(get_google_import_start_rate_limit)],
) -> GoogleImportStartResponse:
    return await _start(
        GoogleImportSource.CLASSROOM,
        DEFAULT_CALENDAR_HORIZON_DAYS,
        principal,
        response,
        http_request,
        imports,
        rate_limit,
    )


def _redirect(request: Request, path: str) -> RedirectResponse:
    public_app_url = cast(str, request.app.state.settings.public_app_url)
    response = RedirectResponse(
        f"{public_app_url}{path}",
        status_code=status.HTTP_303_SEE_OTHER,
        headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"},
    )
    get_cookie_policy(request).clear_google_import_state(response)
    return response


def _error_redirect(request: Request, code: ImportErrorCode) -> RedirectResponse:
    return _redirect(request, f"/import/google?error={code}")


@router.get(
    "/callback",
    status_code=status.HTTP_303_SEE_OTHER,
    response_class=RedirectResponse,
    responses={
        status.HTTP_303_SEE_OTHER: {
            "description": (
                "Redirects to the import preview, or to the import error page with an "
                "error code of denied, invalid, permission, unavailable, or not-configured"
            )
        }
    },
)
async def complete_google_import(
    http_request: Request,
    imports: Annotated[GoogleImports, Depends(get_google_imports)],
    state: Annotated[str | None, Query(max_length=512)] = None,
    code: Annotated[str | None, Query(max_length=2048)] = None,
    error: Annotated[str | None, Query(max_length=200)] = None,
) -> RedirectResponse:
    state_cookie = http_request.cookies.get(
        get_cookie_policy(http_request).google_import_state_name
    )
    if error is not None:
        return _error_redirect(http_request, "denied" if error == "access_denied" else "invalid")
    if not state or not code or state_cookie is None:
        return _error_redirect(http_request, "invalid")
    try:
        snapshot_id = await imports.complete(code, state, state_cookie)
    except InvalidGoogleImportCallbackError:
        return _error_redirect(http_request, "invalid")
    except GoogleImportPermissionError:
        return _error_redirect(http_request, "permission")
    except GoogleImportProviderUnavailableError:
        return _error_redirect(http_request, "unavailable")
    except GoogleImportNotConfiguredError:
        logger.error("Google import is not configured correctly in Google Cloud")
        return _error_redirect(http_request, "not-configured")
    return _redirect(http_request, f"/import/google/{snapshot_id}")


@router.get(
    "/imports/{import_id}",
    response_model=CalendarImportResponse | ClassroomImportResponse,
    responses={
        status.HTTP_401_UNAUTHORIZED: {"model": AccountError},
        status.HTTP_404_NOT_FOUND: {"model": GoogleImportError},
        status.HTTP_503_SERVICE_UNAVAILABLE: {"model": GoogleImportError},
    },
)
async def get_google_import(
    import_id: UUID,
    response: Response,
    principal: Annotated[SessionPrincipal, Depends(require_session)],
    imports: Annotated[GoogleImports, Depends(get_google_imports)],
) -> CalendarImportResponse | ClassroomImportResponse:
    response.headers["Cache-Control"] = "no-store"
    try:
        preview = await imports.preview(principal.account_id, import_id)
    except GoogleImportNotConfiguredError as error:
        raise HTTPException(status_code=503, detail=NOT_CONFIGURED) from error
    except GoogleImportNotFoundError as error:
        raise HTTPException(status_code=404, detail=IMPORT_NOT_FOUND) from error
    if isinstance(preview, CalendarImportPreview):
        return CalendarImportResponse(
            id=preview.id,
            expires_at=preview.expires_at,
            items=[
                CalendarImportItemResponse(
                    id=entry.item.id,
                    title=entry.item.title,
                    starts_at=entry.item.starts_at,
                    ends_at=entry.item.ends_at,
                    all_day=entry.item.all_day,
                    status=entry.status,
                )
                for entry in preview.items
            ],
        )
    return ClassroomImportResponse(
        id=preview.id,
        expires_at=preview.expires_at,
        items=[
            ClassroomImportItemResponse(
                id=entry.item.id,
                title=entry.item.title,
                course=entry.item.course,
                due_at=entry.item.due_at,
                link=entry.item.link,
                suggested_category=entry.item.suggested_category,
                status=entry.status,
            )
            for entry in preview.items
        ],
    )


CONFIRM_RESPONSES: dict[int | str, dict[str, object]] = {
    status.HTTP_401_UNAUTHORIZED: {"model": AccountError},
    status.HTTP_403_FORBIDDEN: {"model": AccountError},
    status.HTTP_404_NOT_FOUND: {"model": GoogleImportError},
    status.HTTP_422_UNPROCESSABLE_CONTENT: {"model": GoogleImportError},
    status.HTTP_503_SERVICE_UNAVAILABLE: {"model": GoogleImportError},
}


@router.post(
    "/imports/{import_id}/calendar",
    response_model=CalendarImportResultResponse,
    responses=CONFIRM_RESPONSES,
)
async def import_google_calendar_items(
    import_id: UUID,
    payload: CalendarImportRequest,
    principal: Annotated[SessionPrincipal, Depends(require_csrf_session)],
    imports: Annotated[GoogleImports, Depends(get_google_imports)],
) -> CalendarImportResultResponse:
    try:
        result = await imports.import_calendar(principal.account_id, import_id, payload.item_ids)
    except GoogleImportNotConfiguredError as error:
        raise HTTPException(status_code=503, detail=NOT_CONFIGURED) from error
    except GoogleImportNotFoundError as error:
        raise HTTPException(status_code=404, detail=IMPORT_NOT_FOUND) from error
    except UnknownGoogleImportItemError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return CalendarImportResultResponse(
        created=result.created,
        updated=result.updated,
        unchanged=result.unchanged,
        skipped_past=result.skipped_past,
        invalidated_future_session_ids=result.invalidated_future_session_ids,
    )


@router.post(
    "/imports/{import_id}/classroom",
    response_model=ClassroomImportResultResponse,
    responses=CONFIRM_RESPONSES,
)
async def import_google_classroom_items(
    import_id: UUID,
    payload: ClassroomImportRequest,
    principal: Annotated[SessionPrincipal, Depends(require_csrf_session)],
    imports: Annotated[GoogleImports, Depends(get_google_imports)],
) -> ClassroomImportResultResponse:
    try:
        result = await imports.import_classroom(
            principal.account_id,
            import_id,
            [
                ClassroomSelection(
                    id=item.id,
                    category=item.category,
                    priority=item.priority,
                    estimate_minutes=item.estimate_minutes,
                )
                for item in payload.items
            ],
        )
    except GoogleImportNotConfiguredError as error:
        raise HTTPException(status_code=503, detail=NOT_CONFIGURED) from error
    except GoogleImportNotFoundError as error:
        raise HTTPException(status_code=404, detail=IMPORT_NOT_FOUND) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return ClassroomImportResultResponse(
        created_task_ids=result.created_task_ids,
        already_imported=result.already_imported,
        failed=[
            ClassroomImportFailureResponse(id=failure.id, reason=failure.reason)
            for failure in result.failed
        ],
    )


@router.delete(
    "/imports/{import_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={
        status.HTTP_401_UNAUTHORIZED: {"model": AccountError},
        status.HTTP_403_FORBIDDEN: {"model": AccountError},
        status.HTTP_404_NOT_FOUND: {"model": GoogleImportError},
        status.HTTP_503_SERVICE_UNAVAILABLE: {"model": GoogleImportError},
    },
)
async def discard_google_import(
    import_id: UUID,
    principal: Annotated[SessionPrincipal, Depends(require_csrf_session)],
    imports: Annotated[GoogleImports, Depends(get_google_imports)],
) -> None:
    try:
        discarded = await imports.discard(principal.account_id, import_id)
    except GoogleImportNotConfiguredError as error:
        raise HTTPException(status_code=503, detail=NOT_CONFIGURED) from error
    if not discarded:
        raise HTTPException(status_code=404, detail=IMPORT_NOT_FOUND)
