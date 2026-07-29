"""Authenticated account-profile endpoints."""

from typing import Annotated, cast

from fastapi import APIRouter, Cookie, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, Field, field_validator

from studyflow.accounts.profile import AccountProfile, AccountProfiles
from studyflow.auth.session_authentication import SessionAuthentication, SessionPrincipal

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


def get_session_authentication(request: Request) -> SessionAuthentication:
    return cast(SessionAuthentication, request.app.state.session_authentication)


def get_account_profiles(request: Request) -> AccountProfiles:
    return cast(AccountProfiles, request.app.state.account_profiles)


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
