"""Email authentication endpoints."""

import hmac
import logging
from typing import Annotated, cast

import httpx
from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    Header,
    HTTPException,
    Query,
    Request,
    Response,
    status,
)
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator
from starlette.responses import JSONResponse

from studyflow.auth.cookies import CookiePolicy
from studyflow.auth.login import (
    EmailVerificationRequiredError,
    InvalidCredentialsError,
    Login,
    LoginCommand,
)
from studyflow.auth.oidc import (
    AccountLinkRequiredError,
    InvalidLinkChallengeError,
    InvalidOIDCResponseError,
    OIDCAccountLinking,
    OIDCLogin,
    OIDCNotConfiguredError,
)
from studyflow.auth.passwords import PasswordPolicyError
from studyflow.auth.rate_limits import (
    EmailVerificationRateLimit,
    EmailVerificationRateLimitExceeded,
    LoginRateLimit,
    LoginRateLimitExceeded,
    OIDCLinkRateLimit,
    OIDCLinkRateLimitExceeded,
    OIDCStartRateLimit,
    OIDCStartRateLimitExceeded,
    PasswordResetAttemptRateLimit,
    PasswordResetAttemptRateLimitExceeded,
    PasswordResetRequestRateLimit,
    PasswordResetRequestRateLimitExceeded,
    RegistrationCompletionRateLimit,
    RegistrationCompletionRateLimitExceeded,
    RegistrationRateLimit,
    RegistrationRateLimitExceeded,
    VerificationResendRateLimit,
    VerificationResendRateLimitExceeded,
)
from studyflow.auth.recovery import InvalidPasswordResetTokenError, PasswordRecovery
from studyflow.auth.registration import Registration, RegistrationCommand
from studyflow.auth.resend import VerificationResend
from studyflow.auth.session_authentication import SessionAuthentication
from studyflow.auth.verification import EmailVerification
from studyflow.timezones import is_iana_timezone

router = APIRouter(prefix="/auth", tags=["Authentication"])
logger = logging.getLogger(__name__)


class RegistrationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: Annotated[EmailStr, Field(max_length=320)]


class RegistrationCompletionRequest(BaseModel):
    signup_token: Annotated[str, Field(min_length=20, max_length=512)]
    name: Annotated[str, Field(min_length=1, max_length=200)]
    password: Annotated[str, Field(min_length=12, max_length=128)]
    timezone: Annotated[str, Field(min_length=1, max_length=64)]

    @field_validator("name")
    @classmethod
    def require_nonempty_name(cls, value: str) -> str:
        name = value.strip()
        if not name:
            raise ValueError("Name is required")
        return name

    @field_validator("timezone")
    @classmethod
    def require_iana_timezone(cls, value: str) -> str:
        if not is_iana_timezone(value):
            raise ValueError("Timezone must be a valid IANA timezone")
        return value


class AuthenticationMessage(BaseModel):
    message: str


class AuthenticationError(BaseModel):
    detail: str


class EmailVerificationRequest(BaseModel):
    token: Annotated[str, Field(min_length=20, max_length=512)]


class EmailVerificationResponse(BaseModel):
    signup_token: str


class LoginRequest(BaseModel):
    email: Annotated[EmailStr, Field(max_length=320)]
    password: Annotated[str, Field(min_length=1, max_length=128)]


class VerificationResendRequest(BaseModel):
    email: Annotated[EmailStr, Field(max_length=320)]


class PasswordResetRequest(BaseModel):
    email: Annotated[EmailStr, Field(max_length=320)]


class PasswordResetConfirmation(BaseModel):
    token: Annotated[str, Field(min_length=20, max_length=512)]
    password: Annotated[str, Field(min_length=12, max_length=128)]


class AuthenticatedAccount(BaseModel):
    id: str
    email: EmailStr
    name: str


class LoginResponse(BaseModel):
    account: AuthenticatedAccount
    csrf_token: str


class CurrentSessionResponse(BaseModel):
    account: AuthenticatedAccount


class OIDCStartResponse(BaseModel):
    authorization_url: str


class OIDCLinkRequiredResponse(AuthenticationError):
    link_challenge: str


class OIDCLinkRequest(BaseModel):
    challenge: Annotated[str, Field(min_length=20, max_length=512)]
    password: Annotated[str, Field(min_length=1, max_length=128)]


def get_registration(request: Request) -> Registration:
    return cast(Registration, request.app.state.registration)


def get_registration_rate_limit(request: Request) -> RegistrationRateLimit:
    return cast(RegistrationRateLimit, request.app.state.registration_rate_limiter)


def get_registration_completion_rate_limit(request: Request) -> RegistrationCompletionRateLimit:
    return cast(
        RegistrationCompletionRateLimit,
        request.app.state.registration_completion_rate_limiter,
    )


def get_email_verification(request: Request) -> EmailVerification:
    return cast(EmailVerification, request.app.state.email_verification)


def get_email_verification_rate_limit(request: Request) -> EmailVerificationRateLimit:
    return cast(EmailVerificationRateLimit, request.app.state.email_verification_rate_limiter)


def get_login(request: Request) -> Login:
    return cast(Login, request.app.state.login)


def get_login_rate_limit(request: Request) -> LoginRateLimit:
    return cast(LoginRateLimit, request.app.state.login_rate_limiter)


def get_oidc_login(request: Request) -> OIDCLogin:
    return cast(OIDCLogin, request.app.state.oidc_login)


def get_oidc_start_rate_limit(request: Request) -> OIDCStartRateLimit:
    return cast(OIDCStartRateLimit, request.app.state.oidc_start_rate_limiter)


def get_oidc_account_linking(request: Request) -> OIDCAccountLinking:
    return cast(OIDCAccountLinking, request.app.state.oidc_account_linking)


def get_oidc_link_rate_limit(request: Request) -> OIDCLinkRateLimit:
    return cast(OIDCLinkRateLimit, request.app.state.oidc_link_rate_limiter)


def get_cookie_policy(request: Request) -> CookiePolicy:
    return cast(CookiePolicy, request.app.state.cookie_policy)


def _oidc_error_response(
    status_code: int, detail: str, cookie_policy: CookiePolicy
) -> JSONResponse:
    response = JSONResponse(
        status_code=status_code,
        content={"detail": detail},
        headers={"Cache-Control": "no-store"},
    )
    cookie_policy.clear_oidc_state(response)
    return response


def _oidc_link_required_response(challenge: str, cookie_policy: CookiePolicy) -> JSONResponse:
    payload = OIDCLinkRequiredResponse(
        detail="Password-confirmed account linking required",
        link_challenge=challenge,
    )
    response = JSONResponse(
        status_code=409,
        content=payload.model_dump(),
        headers={"Cache-Control": "no-store"},
    )
    cookie_policy.clear_oidc_state(response)
    return response


def get_session_authentication(request: Request) -> SessionAuthentication:
    return cast(SessionAuthentication, request.app.state.session_authentication)


def get_verification_resend(request: Request) -> VerificationResend:
    return cast(VerificationResend, request.app.state.verification_resend)


def get_verification_resend_rate_limit(request: Request) -> VerificationResendRateLimit:
    return cast(VerificationResendRateLimit, request.app.state.verification_resend_rate_limiter)


def get_password_recovery(request: Request) -> PasswordRecovery:
    return cast(PasswordRecovery, request.app.state.password_recovery)


def get_password_reset_request_rate_limit(request: Request) -> PasswordResetRequestRateLimit:
    return cast(
        PasswordResetRequestRateLimit, request.app.state.password_reset_request_rate_limiter
    )


def get_password_reset_attempt_rate_limit(request: Request) -> PasswordResetAttemptRateLimit:
    return cast(
        PasswordResetAttemptRateLimit, request.app.state.password_reset_attempt_rate_limiter
    )


@router.get(
    "/google/start",
    response_model=OIDCStartResponse,
    responses={status.HTTP_503_SERVICE_UNAVAILABLE: {"model": AuthenticationError}},
)
async def start_google_oidc(
    response: Response,
    http_request: Request,
    timezone: Annotated[str, Query(min_length=1, max_length=64)],
    oidc: Annotated[OIDCLogin, Depends(get_oidc_login)],
    rate_limit: Annotated[OIDCStartRateLimit, Depends(get_oidc_start_rate_limit)],
) -> OIDCStartResponse:
    try:
        if not is_iana_timezone(timezone):
            raise HTTPException(status_code=422, detail="Timezone must be a valid IANA timezone")
        client_ip = http_request.client.host if http_request.client is not None else "unknown"
        await rate_limit.check(client_ip)
        started = await oidc.start(timezone)
    except OIDCStartRateLimitExceeded as error:
        raise HTTPException(
            status_code=429,
            detail="Too many Google sign-in attempts",
            headers={"Retry-After": "900"},
        ) from error
    except OIDCNotConfiguredError as error:
        raise HTTPException(status_code=503, detail="Google sign-in is not configured") from error
    get_cookie_policy(http_request).set_oidc_state(response, started.state)
    return OIDCStartResponse(authorization_url=started.authorization_url)


@router.get(
    "/google/callback",
    response_model=LoginResponse,
    responses={
        status.HTTP_400_BAD_REQUEST: {"model": AuthenticationError},
        status.HTTP_409_CONFLICT: {"model": OIDCLinkRequiredResponse},
        status.HTTP_503_SERVICE_UNAVAILABLE: {"model": AuthenticationError},
    },
)
async def complete_google_oidc(
    response: Response,
    http_request: Request,
    state: Annotated[str, Query(min_length=20, max_length=512)],
    oidc: Annotated[OIDCLogin, Depends(get_oidc_login)],
    code: Annotated[str | None, Query(min_length=1, max_length=2048)] = None,
    error: Annotated[str | None, Query(max_length=200)] = None,
) -> LoginResponse | Response:
    response.headers["Cache-Control"] = "no-store"
    cookie_policy = get_cookie_policy(http_request)
    state_cookie = http_request.cookies.get(cookie_policy.oidc_state_name)
    try:
        if error is not None or code is None or state_cookie is None:
            raise InvalidOIDCResponseError
        result = await oidc.complete(code, state, state_cookie)
    except AccountLinkRequiredError as error:
        return _oidc_link_required_response(error.challenge, cookie_policy)
    except InvalidOIDCResponseError:
        return _oidc_error_response(400, "Google sign-in could not be completed", cookie_policy)
    except OIDCNotConfiguredError:
        return _oidc_error_response(503, "Google sign-in is not configured", cookie_policy)
    cookie_policy.clear_oidc_state(response)
    cookie_policy.set_authentication(response, result.session_token, result.csrf_token)
    return LoginResponse(
        account=AuthenticatedAccount(
            id=str(result.account_id), email=result.email, name=result.name
        ),
        csrf_token=result.csrf_token,
    )


@router.post(
    "/google/link",
    response_model=LoginResponse,
    responses={
        status.HTTP_401_UNAUTHORIZED: {"model": AuthenticationError},
        status.HTTP_429_TOO_MANY_REQUESTS: {"model": AuthenticationError},
    },
)
async def confirm_google_account_link(
    payload: OIDCLinkRequest,
    response: Response,
    http_request: Request,
    linking: Annotated[OIDCAccountLinking, Depends(get_oidc_account_linking)],
    rate_limit: Annotated[OIDCLinkRateLimit, Depends(get_oidc_link_rate_limit)],
) -> LoginResponse:
    client_ip = http_request.client.host if http_request.client is not None else "unknown"
    try:
        account_id = await linking.resolve_attempt_account_id(payload.challenge)
        account_key = str(account_id) if account_id is not None else f"invalid:{payload.challenge}"
        await rate_limit.check(client_ip, account_key)
        result = await linking.link(payload.challenge, payload.password)
    except OIDCLinkRateLimitExceeded as error:
        raise HTTPException(
            status_code=429,
            detail="Too many account-link attempts",
            headers={"Retry-After": "900"},
        ) from error
    except InvalidLinkChallengeError as error:
        raise HTTPException(status_code=401, detail="Invalid link challenge or password") from error
    get_cookie_policy(http_request).set_authentication(
        response, result.session_token, result.csrf_token
    )
    return LoginResponse(
        account=AuthenticatedAccount(
            id=str(result.account_id), email=result.email, name=result.name
        ),
        csrf_token=result.csrf_token,
    )


@router.post(
    "/forgot-password",
    status_code=status.HTTP_202_ACCEPTED,
    response_model=AuthenticationMessage,
    responses={status.HTTP_429_TOO_MANY_REQUESTS: {"model": AuthenticationError}},
)
async def forgot_password(
    payload: PasswordResetRequest,
    http_request: Request,
    background_tasks: BackgroundTasks,
    recovery: Annotated[PasswordRecovery, Depends(get_password_recovery)],
    rate_limit: Annotated[
        PasswordResetRequestRateLimit, Depends(get_password_reset_request_rate_limit)
    ],
) -> AuthenticationMessage:
    client_ip = http_request.client.host if http_request.client is not None else "unknown"
    try:
        await rate_limit.check(client_ip, str(payload.email))
        await recovery.request_reset(str(payload.email), background_tasks)
    except PasswordResetRequestRateLimitExceeded as error:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many password reset requests",
            headers={"Retry-After": "900"},
        ) from error
    return AuthenticationMessage(
        message="If the address is eligible, a password reset email has been sent."
    )


@router.post(
    "/reset-password",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={
        status.HTTP_400_BAD_REQUEST: {"model": AuthenticationError},
        status.HTTP_422_UNPROCESSABLE_CONTENT: {
            "description": "Invalid request or disallowed password",
            "content": {
                "application/json": {
                    "schema": {
                        "oneOf": [
                            {"$ref": "#/components/schemas/AuthenticationError"},
                            {"$ref": "#/components/schemas/HTTPValidationError"},
                        ]
                    }
                }
            },
        },
        status.HTTP_429_TOO_MANY_REQUESTS: {"model": AuthenticationError},
        status.HTTP_503_SERVICE_UNAVAILABLE: {"model": AuthenticationError},
    },
)
async def reset_password(
    payload: PasswordResetConfirmation,
    http_request: Request,
    recovery: Annotated[PasswordRecovery, Depends(get_password_recovery)],
    rate_limit: Annotated[
        PasswordResetAttemptRateLimit, Depends(get_password_reset_attempt_rate_limit)
    ],
) -> None:
    client_ip = http_request.client.host if http_request.client is not None else "unknown"
    try:
        await rate_limit.check(client_ip, payload.token)
        await recovery.reset_password(payload.token, payload.password)
    except PasswordResetAttemptRateLimitExceeded as error:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many password reset attempts",
            headers={"Retry-After": "900"},
        ) from error
    except InvalidPasswordResetTokenError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password reset token is invalid or expired",
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


@router.post(
    "/resend-verification",
    status_code=status.HTTP_202_ACCEPTED,
    response_model=AuthenticationMessage,
    responses={status.HTTP_429_TOO_MANY_REQUESTS: {"model": AuthenticationError}},
)
async def resend_verification(
    payload: VerificationResendRequest,
    http_request: Request,
    background_tasks: BackgroundTasks,
    resend: Annotated[VerificationResend, Depends(get_verification_resend)],
    rate_limit: Annotated[VerificationResendRateLimit, Depends(get_verification_resend_rate_limit)],
) -> AuthenticationMessage:
    client_ip = http_request.client.host if http_request.client is not None else "unknown"
    try:
        await rate_limit.check(client_ip, str(payload.email))
        await resend.resend(str(payload.email), background_tasks)
    except VerificationResendRateLimitExceeded as error:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many verification resend attempts",
            headers={"Retry-After": "900"},
        ) from error
    return AuthenticationMessage(
        message="If the address is eligible, a verification email has been sent."
    )


@router.get(
    "/session",
    response_model=CurrentSessionResponse,
    responses={status.HTTP_401_UNAUTHORIZED: {"model": AuthenticationError}},
)
async def get_current_session(
    http_request: Request,
    authentication: Annotated[SessionAuthentication, Depends(get_session_authentication)],
) -> CurrentSessionResponse:
    session_token = http_request.cookies.get(get_cookie_policy(http_request).session_name)
    principal = (
        await authentication.authenticate(session_token) if session_token is not None else None
    )
    if principal is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return CurrentSessionResponse(
        account=AuthenticatedAccount(
            id=str(principal.account_id), email=principal.email, name=principal.name
        )
    )


@router.post(
    "/logout",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={
        status.HTTP_403_FORBIDDEN: {"model": AuthenticationError},
        status.HTTP_503_SERVICE_UNAVAILABLE: {"model": AuthenticationError},
    },
)
async def logout(
    http_request: Request,
    authentication: Annotated[SessionAuthentication, Depends(get_session_authentication)],
    csrf_token: Annotated[str | None, Header(alias="X-CSRF-Token")] = None,
) -> Response:
    cookie_policy = get_cookie_policy(http_request)
    session_token = http_request.cookies.get(cookie_policy.session_name)
    if session_token is None:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    csrf_cookie = http_request.cookies.get(cookie_policy.csrf_name)
    if (
        csrf_token is None
        or csrf_cookie is None
        or not hmac.compare_digest(csrf_token.encode(), csrf_cookie.encode())
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="CSRF validation failed")
    try:
        await authentication.revoke(session_token, csrf_token)
    except Exception:
        logger.exception("Failed to revoke session during logout")
        error_response = JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={"detail": "Logout could not be completed"},
            headers={"Cache-Control": "no-store"},
        )
        cookie_policy.clear_authentication(error_response)
        return error_response
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    cookie_policy.clear_authentication(response)
    return response


@router.post(
    "/login",
    response_model=LoginResponse,
    responses={
        status.HTTP_401_UNAUTHORIZED: {"model": AuthenticationError},
        status.HTTP_403_FORBIDDEN: {"model": AuthenticationError},
        status.HTTP_429_TOO_MANY_REQUESTS: {"model": AuthenticationError},
    },
)
async def login_with_email(
    payload: LoginRequest,
    response: Response,
    http_request: Request,
    login: Annotated[Login, Depends(get_login)],
    rate_limit: Annotated[LoginRateLimit, Depends(get_login_rate_limit)],
) -> LoginResponse:
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
        try:
            if reservation_id is None:
                raise RuntimeError("Login reservation was not created")
            await rate_limit.record_failure(str(payload.email), reservation_id)
        except LoginRateLimitExceeded as rate_limit_error:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many login attempts",
                headers={"Retry-After": "900"},
            ) from rate_limit_error
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        ) from error
    except EmailVerificationRequiredError as error:
        if reservation_id is None:
            raise RuntimeError("Login reservation was not created") from error
        await rate_limit.reset_failures(str(payload.email), reservation_id)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Email verification required",
        ) from error
    except Exception:
        if reservation_id is not None:
            await rate_limit.release(str(payload.email), reservation_id)
        raise
    if reservation_id is None:
        raise RuntimeError("Login reservation was not created")
    await rate_limit.reset_failures(str(payload.email), reservation_id)
    get_cookie_policy(http_request).set_authentication(
        response, result.session_token, result.csrf_token
    )
    return LoginResponse(
        account=AuthenticatedAccount(
            id=str(result.account_id),
            email=result.email,
            name=result.name,
        ),
        csrf_token=result.csrf_token,
    )


@router.post(
    "/register",
    status_code=status.HTTP_202_ACCEPTED,
    response_model=AuthenticationMessage,
    responses={
        status.HTTP_429_TOO_MANY_REQUESTS: {
            "model": AuthenticationError,
            "description": "Too many registration attempts",
        },
    },
)
async def register(
    payload: RegistrationRequest,
    http_request: Request,
    background_tasks: BackgroundTasks,
    registration: Annotated[Registration, Depends(get_registration)],
    rate_limit: Annotated[RegistrationRateLimit, Depends(get_registration_rate_limit)],
) -> AuthenticationMessage:
    client_ip = http_request.client.host if http_request.client is not None else "unknown"
    try:
        await rate_limit.check(client_ip, str(payload.email))
        await registration.register(
            RegistrationCommand(email=payload.email),
            background_tasks,
        )
    except RegistrationRateLimitExceeded as error:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many registration attempts",
            headers={"Retry-After": "900"},
        ) from error
    return AuthenticationMessage(
        message="Check your email to continue registration if the address is eligible."
    )


@router.post(
    "/complete-registration",
    status_code=status.HTTP_201_CREATED,
    response_model=AuthenticationMessage,
    responses={
        status.HTTP_400_BAD_REQUEST: {"model": AuthenticationError},
        status.HTTP_429_TOO_MANY_REQUESTS: {
            "model": AuthenticationError,
            "description": "Too many registration completion attempts",
        },
        status.HTTP_503_SERVICE_UNAVAILABLE: {
            "model": AuthenticationError,
            "description": "Password safety service is unavailable",
        },
    },
)
async def complete_registration(
    payload: RegistrationCompletionRequest,
    http_request: Request,
    registration: Annotated[Registration, Depends(get_registration)],
    rate_limit: Annotated[
        RegistrationCompletionRateLimit,
        Depends(get_registration_completion_rate_limit),
    ],
) -> AuthenticationMessage:
    try:
        client_ip = http_request.client.host if http_request.client is not None else "unknown"
        await rate_limit.check(client_ip, payload.signup_token)
        completed = await registration.complete(
            payload.signup_token,
            payload.name,
            payload.password,
            payload.timezone,
        )
    except RegistrationCompletionRateLimitExceeded as error:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many registration completion attempts",
            headers={"Retry-After": "900"},
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
    if not completed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Signup token is invalid or expired",
        )
    return AuthenticationMessage(message="Registration complete.")


@router.post(
    "/verify-email",
    response_model=EmailVerificationResponse,
    responses={
        status.HTTP_400_BAD_REQUEST: {
            "model": AuthenticationError,
            "description": "Verification token is invalid or expired",
        },
        status.HTTP_429_TOO_MANY_REQUESTS: {
            "model": AuthenticationError,
            "description": "Too many verification attempts",
        },
    },
)
async def verify_email(
    payload: EmailVerificationRequest,
    http_request: Request,
    verification: Annotated[EmailVerification, Depends(get_email_verification)],
    rate_limit: Annotated[EmailVerificationRateLimit, Depends(get_email_verification_rate_limit)],
) -> EmailVerificationResponse:
    client_ip = http_request.client.host if http_request.client is not None else "unknown"
    try:
        await rate_limit.check(client_ip, payload.token)
    except EmailVerificationRateLimitExceeded as error:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many verification attempts",
            headers={"Retry-After": "900"},
        ) from error
    signup_token = await verification.verify(payload.token)
    if signup_token is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Verification token is invalid or expired",
        )
    return EmailVerificationResponse(signup_token=signup_token)
