"""Authenticated account-profile endpoints."""

from datetime import datetime
from typing import Annotated, cast

import httpx
from fastapi import APIRouter, Cookie, Depends, Header, HTTPException, Request, Response, status
from pydantic import BaseModel, EmailStr, Field, field_validator

from studyflow.accounts.password import AccountPasswords, InvalidCurrentPasswordError
from studyflow.accounts.preferences import AccountPreferences, StudyPreferences
from studyflow.accounts.profile import AccountProfile, AccountProfiles
from studyflow.auth.oidc import OIDCAccountLinking
from studyflow.auth.passwords import PasswordPolicyError
from studyflow.auth.rate_limits import (
    AccountPasswordChangeRateLimit,
    AccountPasswordChangeRateLimitExceeded,
)
from studyflow.auth.session_authentication import SessionAuthentication, SessionPrincipal
from studyflow.timezones import is_iana_timezone

router = APIRouter(prefix="/account", tags=["Account"])


class AccountProfileResponse(BaseModel):
    id: str
    email: EmailStr
    name: str


class AccountProfileUpdate(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=200)]

    @field_validator("name")
    @classmethod
    def require_nonempty_name(cls, value: str) -> str:
        name = value.strip()
        if not name:
            raise ValueError("Name is required")
        return name


class AccountError(BaseModel):
    detail: str


class StudyPreferencesResponse(BaseModel):
    timezone: str
    preferred_session_length_minutes: int
    minimum_break_minutes: int
    availability_confirmation_required: bool


class StudyPreferencesUpdate(BaseModel):
    timezone: Annotated[str, Field(min_length=1, max_length=64)]
    preferred_session_length_minutes: Annotated[int, Field(ge=10, le=240)]
    minimum_break_minutes: Annotated[int, Field(ge=0, le=120)]

    @field_validator("timezone")
    @classmethod
    def require_iana_timezone(cls, value: str) -> str:
        if not is_iana_timezone(value):
            raise ValueError("Timezone must be a valid IANA timezone")
        return value


class PasswordChangeRequest(BaseModel):
    current_password: Annotated[str, Field(min_length=1, max_length=128)]
    new_password: Annotated[str, Field(min_length=12, max_length=128)]


class LinkedIdentityResponse(BaseModel):
    provider: str
    email: EmailStr
    linked_at: datetime


def get_session_authentication(request: Request) -> SessionAuthentication:
    return cast(SessionAuthentication, request.app.state.session_authentication)


def get_account_profiles(request: Request) -> AccountProfiles:
    return cast(AccountProfiles, request.app.state.account_profiles)


def get_account_preferences(request: Request) -> AccountPreferences:
    return cast(AccountPreferences, request.app.state.account_preferences)


def get_account_passwords(request: Request) -> AccountPasswords:
    return cast(AccountPasswords, request.app.state.account_passwords)


def get_oidc_account_linking(request: Request) -> OIDCAccountLinking:
    return cast(OIDCAccountLinking, request.app.state.oidc_account_linking)


def get_account_password_change_rate_limit(request: Request) -> AccountPasswordChangeRateLimit:
    return cast(
        AccountPasswordChangeRateLimit,
        request.app.state.account_password_change_rate_limiter,
    )


async def require_session(
    authentication: Annotated[SessionAuthentication, Depends(get_session_authentication)],
    session_token: Annotated[str | None, Cookie(alias="__Host-studyflow_session")] = None,
) -> SessionPrincipal:
    principal = (
        await authentication.authenticate(session_token) if session_token is not None else None
    )
    if principal is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return principal


async def require_csrf_session(
    authentication: Annotated[SessionAuthentication, Depends(get_session_authentication)],
    session_token: Annotated[str | None, Cookie(alias="__Host-studyflow_session")] = None,
    csrf_token: Annotated[str | None, Header(alias="X-CSRF-Token")] = None,
) -> SessionPrincipal:
    if session_token is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    if csrf_token is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="CSRF validation failed")
    principal = await authentication.authenticate(session_token, csrf_token)
    if principal is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="CSRF validation failed")
    return principal


def _response(profile: AccountProfile) -> AccountProfileResponse:
    return AccountProfileResponse(id=str(profile.id), email=profile.email, name=profile.name)


def _preferences_response(preferences: StudyPreferences) -> StudyPreferencesResponse:
    return StudyPreferencesResponse(
        timezone=preferences.timezone,
        preferred_session_length_minutes=preferences.preferred_session_length_minutes,
        minimum_break_minutes=preferences.minimum_break_minutes,
        availability_confirmation_required=preferences.availability_confirmation_required,
    )


@router.get(
    "/profile",
    response_model=AccountProfileResponse,
    responses={status.HTTP_401_UNAUTHORIZED: {"model": AccountError}},
)
async def get_profile(
    principal: Annotated[SessionPrincipal, Depends(require_session)],
    profiles: Annotated[AccountProfiles, Depends(get_account_profiles)],
) -> AccountProfileResponse:
    profile = await profiles.get(principal.account_id)
    if profile is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return _response(profile)


@router.patch(
    "/profile",
    response_model=AccountProfileResponse,
    responses={
        status.HTTP_401_UNAUTHORIZED: {"model": AccountError},
        status.HTTP_403_FORBIDDEN: {"model": AccountError},
    },
)
async def update_profile(
    payload: AccountProfileUpdate,
    principal: Annotated[SessionPrincipal, Depends(require_csrf_session)],
    profiles: Annotated[AccountProfiles, Depends(get_account_profiles)],
) -> AccountProfileResponse:
    profile = await profiles.update_name(principal.account_id, payload.name)
    if profile is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return _response(profile)


@router.get(
    "/preferences",
    response_model=StudyPreferencesResponse,
    responses={status.HTTP_401_UNAUTHORIZED: {"model": AccountError}},
)
async def get_preferences(
    principal: Annotated[SessionPrincipal, Depends(require_session)],
    preferences: Annotated[AccountPreferences, Depends(get_account_preferences)],
) -> StudyPreferencesResponse:
    current = await preferences.get(principal.account_id)
    if current is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return _preferences_response(current)


@router.patch(
    "/preferences",
    response_model=StudyPreferencesResponse,
    responses={
        status.HTTP_401_UNAUTHORIZED: {"model": AccountError},
        status.HTTP_403_FORBIDDEN: {"model": AccountError},
    },
)
async def update_preferences(
    payload: StudyPreferencesUpdate,
    principal: Annotated[SessionPrincipal, Depends(require_csrf_session)],
    preferences: Annotated[AccountPreferences, Depends(get_account_preferences)],
) -> StudyPreferencesResponse:
    updated = await preferences.update(
        principal.account_id,
        payload.timezone,
        payload.preferred_session_length_minutes,
        payload.minimum_break_minutes,
    )
    if updated is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return _preferences_response(updated)


@router.get(
    "/identities",
    response_model=list[LinkedIdentityResponse],
    responses={status.HTTP_401_UNAUTHORIZED: {"model": AccountError}},
)
async def list_linked_identities(
    principal: Annotated[SessionPrincipal, Depends(require_session)],
    linking: Annotated[OIDCAccountLinking, Depends(get_oidc_account_linking)],
) -> list[LinkedIdentityResponse]:
    return [
        LinkedIdentityResponse(
            provider=identity.provider,
            email=identity.email,
            linked_at=identity.linked_at,
        )
        for identity in await linking.list_identities(principal.account_id)
    ]


@router.patch(
    "/password",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={
        status.HTTP_400_BAD_REQUEST: {"model": AccountError},
        status.HTTP_401_UNAUTHORIZED: {"model": AccountError},
        status.HTTP_403_FORBIDDEN: {"model": AccountError},
        status.HTTP_429_TOO_MANY_REQUESTS: {"model": AccountError},
        status.HTTP_422_UNPROCESSABLE_CONTENT: {
            "description": "Invalid request or disallowed password",
            "content": {
                "application/json": {
                    "schema": {
                        "oneOf": [
                            {"$ref": "#/components/schemas/AccountError"},
                            {"$ref": "#/components/schemas/HTTPValidationError"},
                        ]
                    }
                }
            },
        },
        status.HTTP_503_SERVICE_UNAVAILABLE: {"model": AccountError},
    },
)
async def change_password(
    payload: PasswordChangeRequest,
    response: Response,
    http_request: Request,
    principal: Annotated[SessionPrincipal, Depends(require_csrf_session)],
    passwords: Annotated[AccountPasswords, Depends(get_account_passwords)],
    rate_limit: Annotated[
        AccountPasswordChangeRateLimit, Depends(get_account_password_change_rate_limit)
    ],
) -> None:
    try:
        client_ip = http_request.client.host if http_request.client is not None else "unknown"
        await rate_limit.check(client_ip, str(principal.account_id))
        await passwords.change(principal.account_id, payload.current_password, payload.new_password)
    except AccountPasswordChangeRateLimitExceeded as error:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many password change attempts",
            headers={"Retry-After": "900"},
        ) from error
    except InvalidCurrentPasswordError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect"
        ) from error
    except PasswordPolicyError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Password is not allowed",
        ) from error
    except httpx.HTTPError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Password safety service is unavailable",
        ) from error
    response.delete_cookie(
        "__Host-studyflow_session", path="/", secure=True, httponly=True, samesite="strict"
    )
    response.delete_cookie(
        "__Host-studyflow_csrf", path="/", secure=True, httponly=False, samesite="strict"
    )
