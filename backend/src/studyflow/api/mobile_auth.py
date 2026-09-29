"""Token authentication endpoints for the native mobile clients."""

from typing import Annotated, cast
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, EmailStr, Field, field_validator
from starlette.responses import RedirectResponse

from studyflow.api.auth import AuthenticatedAccount, AuthenticationError
from studyflow.auth.login import (
    EmailVerificationRequiredError,
    InvalidCredentialsError,
    Login,
    LoginCommand,
)
from studyflow.auth.mobile_tokens import (
    MOBILE_BEARER_SCHEME,
    InvalidMobileRefreshToken,
    MobileTokenResult,
    MobileTokenService,
)
from studyflow.auth.oidc import (
    AccountLinkRequiredError,
    InvalidLinkChallengeError,
    InvalidOIDCResponseError,
    OIDCAccountLinking,
    OIDCLogin,
    OIDCNotConfiguredError,
    OIDCProviderUnavailableError,
)
from studyflow.auth.rate_limits import (
    LoginRateLimit,
    LoginRateLimitExceeded,
    OIDCLinkRateLimit,
    OIDCLinkRateLimitExceeded,
    OIDCStartRateLimit,
    OIDCStartRateLimitExceeded,
)
from studyflow.timezones import is_iana_timezone

router = APIRouter(prefix="/auth/mobile", tags=["Mobile authentication"])


class MobileLoginRequest(BaseModel):
    email: Annotated[EmailStr, Field(max_length=320)]
    password: Annotated[str, Field(min_length=1, max_length=128)]


class MobileRefreshRequest(BaseModel):
    refresh_token: Annotated[str, Field(min_length=40, max_length=512)]


class MobileLogoutRequest(BaseModel):
    refresh_token: Annotated[str, Field(min_length=40, max_length=512)] | None = None


class MobileGoogleStartRequest(BaseModel):
    timezone: Annotated[str, Field(min_length=1, max_length=64)]

    @field_validator("timezone")
    @classmethod
    def require_iana_timezone(cls, value: str) -> str:
        if not is_iana_timezone(value):
            raise ValueError("Timezone must be a valid IANA timezone")
        return value


class MobileGoogleExchangeRequest(BaseModel):
    code: Annotated[str, Field(min_length=40, max_length=512)]


class MobileGoogleLinkRequest(BaseModel):
    challenge: Annotated[str, Field(min_length=20, max_length=512)]
    password: Annotated[str, Field(min_length=1, max_length=128)]


class MobileTokenResponse(BaseModel):
    account: AuthenticatedAccount
    access_token: str
    refresh_token: str
    token_type: str
    expires_in: int
    refresh_expires_in: int


def get_login(request: Request) -> Login:
    return cast(Login, request.app.state.login)


def get_login_rate_limit(request: Request) -> LoginRateLimit:
    return cast(LoginRateLimit, request.app.state.login_rate_limiter)


def get_mobile_tokens(request: Request) -> MobileTokenService:
    return cast(MobileTokenService, request.app.state.mobile_tokens)


def get_oidc_login(request: Request) -> OIDCLogin:
    return cast(OIDCLogin, request.app.state.oidc_login)


def get_oidc_start_rate_limit(request: Request) -> OIDCStartRateLimit:
    return cast(OIDCStartRateLimit, request.app.state.oidc_start_rate_limiter)


def get_oidc_link_rate_limit(request: Request) -> OIDCLinkRateLimit:
    return cast(OIDCLinkRateLimit, request.app.state.oidc_link_rate_limiter)


def get_oidc_account_linking(request: Request) -> OIDCAccountLinking:
    return cast(OIDCAccountLinking, request.app.state.oidc_account_linking)


def _mobile_response(issued: MobileTokenResult) -> MobileTokenResponse:
    return MobileTokenResponse(
        account=AuthenticatedAccount(
            id=str(issued.principal.account_id),
            email=issued.principal.email,
            name=issued.principal.name,
            avatar_url=issued.principal.avatar_url,
        ),
        access_token=issued.credentials.access_token,
        refresh_token=issued.credentials.refresh_token,
        token_type=MOBILE_BEARER_SCHEME,
        expires_in=900,
        refresh_expires_in=2_592_000,
    )


def _mobile_callback(error: str | None = None, **params: str) -> RedirectResponse:
    query = urlencode({"error": error, **params} if error is not None else params)
    return RedirectResponse(
        f"studyflow://auth/google?{query}",
        status_code=status.HTTP_303_SEE_OTHER,
        headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"},
    )


@router.post(
    "/google/start",
    response_model=dict[str, str],
    responses={
        status.HTTP_429_TOO_MANY_REQUESTS: {"model": AuthenticationError},
        status.HTTP_503_SERVICE_UNAVAILABLE: {"model": AuthenticationError},
    },
)
async def start_mobile_google(
    payload: MobileGoogleStartRequest,
    request: Request,
    oidc: Annotated[OIDCLogin, Depends(get_oidc_login)],
    rate_limit: Annotated[OIDCStartRateLimit, Depends(get_oidc_start_rate_limit)],
) -> dict[str, str]:
    redirect_uri = getattr(request.app.state.settings, "google_mobile_oidc_redirect_uri", None)
    if redirect_uri is None:
        raise HTTPException(status_code=503, detail="Google sign-in is not configured for mobile")
    try:
        client_ip = request.client.host if request.client is not None else "unknown"
        await rate_limit.check(client_ip)
        started = await oidc.start_mobile(payload.timezone, redirect_uri)
    except OIDCStartRateLimitExceeded as error:
        raise HTTPException(
            status_code=429,
            detail="Too many Google sign-in attempts",
            headers={"Retry-After": "900"},
        ) from error
    except OIDCNotConfiguredError as error:
        raise HTTPException(status_code=503, detail="Google sign-in is not configured") from error
    return {"authorization_url": started.authorization_url}


@router.get("/google/callback", response_class=RedirectResponse)
async def complete_mobile_google(
    oidc: Annotated[OIDCLogin, Depends(get_oidc_login)],
    mobile_tokens: Annotated[MobileTokenService, Depends(get_mobile_tokens)],
    state: Annotated[str, Query(min_length=20, max_length=512)],
    code: Annotated[str | None, Query(min_length=1, max_length=2048)] = None,
    error: Annotated[str | None, Query(max_length=200)] = None,
) -> RedirectResponse:
    if error is not None or code is None:
        return _mobile_callback(error="cancelled" if error == "access_denied" else "invalid")
    try:
        result = await oidc.complete_mobile(code, state)
    except AccountLinkRequiredError as link_error:
        return _mobile_callback(error="account_link_required", challenge=link_error.challenge)
    except OIDCProviderUnavailableError:
        return _mobile_callback(error="provider_unavailable")
    except (InvalidOIDCResponseError, OIDCNotConfiguredError):
        return _mobile_callback(error="invalid")
    exchange_code = await mobile_tokens.create_oauth_code(result.account_id)
    return _mobile_callback(code=exchange_code)


@router.post(
    "/google/exchange",
    response_model=MobileTokenResponse,
    responses={status.HTTP_401_UNAUTHORIZED: {"model": AuthenticationError}},
)
async def exchange_mobile_google_code(
    payload: MobileGoogleExchangeRequest,
    mobile_tokens: Annotated[MobileTokenService, Depends(get_mobile_tokens)],
) -> MobileTokenResponse:
    try:
        issued = await mobile_tokens.exchange_oauth_code(payload.code)
    except InvalidMobileRefreshToken as error:
        raise HTTPException(status_code=401, detail="Google sign-in code expired") from error
    return _mobile_response(issued)


@router.post(
    "/google/link",
    response_model=MobileTokenResponse,
    responses={
        status.HTTP_401_UNAUTHORIZED: {"model": AuthenticationError},
        status.HTTP_429_TOO_MANY_REQUESTS: {"model": AuthenticationError},
    },
)
async def link_mobile_google_account(
    payload: MobileGoogleLinkRequest,
    request: Request,
    linking: Annotated[OIDCAccountLinking, Depends(get_oidc_account_linking)],
    rate_limit: Annotated[OIDCLinkRateLimit, Depends(get_oidc_link_rate_limit)],
    mobile_tokens: Annotated[MobileTokenService, Depends(get_mobile_tokens)],
) -> MobileTokenResponse:
    try:
        client_ip = request.client.host if request.client is not None else "unknown"
        await rate_limit.check(client_ip, payload.challenge)
        result = await linking.link(payload.challenge, payload.password)
    except OIDCLinkRateLimitExceeded as error:
        raise HTTPException(status_code=429, detail="Too many account-link attempts") from error
    except InvalidLinkChallengeError as error:
        raise HTTPException(
            status_code=401, detail="Google account link could not be completed"
        ) from error
    return _mobile_response(await mobile_tokens.issue(result.account_id))


@router.post(
    "/login",
    response_model=MobileTokenResponse,
    response_model_exclude_none=True,
    responses={
        status.HTTP_401_UNAUTHORIZED: {"model": AuthenticationError},
        status.HTTP_403_FORBIDDEN: {"model": AuthenticationError},
        status.HTTP_429_TOO_MANY_REQUESTS: {"model": AuthenticationError},
    },
)
async def mobile_login(
    payload: MobileLoginRequest,
    http_request: Request,
    login: Annotated[Login, Depends(get_login)],
    rate_limit: Annotated[LoginRateLimit, Depends(get_login_rate_limit)],
    mobile_tokens: Annotated[MobileTokenService, Depends(get_mobile_tokens)],
) -> MobileTokenResponse:
    reservation_id: str | None = None
    try:
        client_ip = http_request.client.host if http_request.client is not None else "unknown"
        reservation_id = await rate_limit.check(client_ip, str(payload.email))
        result = await login.login(LoginCommand(email=payload.email, password=payload.password))
    except LoginRateLimitExceeded as error:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many login attempts",
            headers={"Retry-After": "900"},
        ) from error
    except InvalidCredentialsError as error:
        if reservation_id is not None:
            await rate_limit.record_failure(str(payload.email), reservation_id)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        ) from error
    except EmailVerificationRequiredError as error:
        if reservation_id is not None:
            await rate_limit.reset_failures(str(payload.email), reservation_id)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Email verification required",
        ) from error
    if reservation_id is not None:
        await rate_limit.reset_failures(str(payload.email), reservation_id)
    issued = await mobile_tokens.issue(result.account_id)
    return MobileTokenResponse(
        account=AuthenticatedAccount(
            id=str(result.account_id),
            email=result.email,
            name=result.name,
            avatar_url=result.avatar_url,
        ),
        access_token=issued.credentials.access_token,
        refresh_token=issued.credentials.refresh_token,
        token_type=MOBILE_BEARER_SCHEME,
        expires_in=900,
        refresh_expires_in=2_592_000,
    )


@router.post(
    "/refresh",
    response_model=MobileTokenResponse,
    responses={status.HTTP_401_UNAUTHORIZED: {"model": AuthenticationError}},
)
async def refresh_mobile_token(
    payload: MobileRefreshRequest,
    mobile_tokens: Annotated[MobileTokenService, Depends(get_mobile_tokens)],
) -> MobileTokenResponse:
    try:
        issued = await mobile_tokens.rotate(payload.refresh_token)
    except InvalidMobileRefreshToken as error:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Mobile session expired",
        ) from error
    return MobileTokenResponse(
        account=AuthenticatedAccount(
            id=str(issued.principal.account_id),
            email=issued.principal.email,
            name=issued.principal.name,
            avatar_url=issued.principal.avatar_url,
        ),
        access_token=issued.credentials.access_token,
        refresh_token=issued.credentials.refresh_token,
        token_type=MOBILE_BEARER_SCHEME,
        expires_in=900,
        refresh_expires_in=2_592_000,
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout_mobile(
    payload: MobileLogoutRequest,
    mobile_tokens: Annotated[MobileTokenService, Depends(get_mobile_tokens)],
    authorization: Annotated[str | None, Header()] = None,
) -> Response:
    access_token = None
    if authorization is not None and authorization.lower().startswith("bearer "):
        access_token = authorization[7:].strip() or None
    if mobile_tokens is not None:
        await mobile_tokens.revoke(access_token=access_token, refresh_token=payload.refresh_token)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
