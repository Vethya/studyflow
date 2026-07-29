"""Email authentication endpoints."""

from typing import Annotated, cast
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx
from fastapi import (
    APIRouter,
    BackgroundTasks,
    Cookie,
    Depends,
    Header,
    HTTPException,
    Request,
    Response,
    status,
)
from pydantic import BaseModel, EmailStr, Field, field_validator

from studyflow.auth.login import (
    EmailVerificationRequiredError,
    InvalidCredentialsError,
    Login,
    LoginCommand,
)
from studyflow.auth.passwords import PasswordPolicyError
from studyflow.auth.rate_limits import (
    EmailVerificationRateLimit,
    EmailVerificationRateLimitExceeded,
    LoginRateLimit,
    LoginRateLimitExceeded,
    PasswordResetAttemptRateLimit,
    PasswordResetAttemptRateLimitExceeded,
    PasswordResetRequestRateLimit,
    PasswordResetRequestRateLimitExceeded,
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

router = APIRouter(prefix="/auth", tags=["Authentication"])


class RegistrationRequest(BaseModel):
    email: Annotated[EmailStr, Field(max_length=320)]
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
        try:
            ZoneInfo(value)
        except ZoneInfoNotFoundError as error:
            raise ValueError("Timezone must be a valid IANA timezone") from error
        return value


class AuthenticationMessage(BaseModel):
    message: str


class AuthenticationError(BaseModel):
    detail: str


class EmailVerificationRequest(BaseModel):
    token: Annotated[str, Field(min_length=20, max_length=512)]


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


def get_registration(request: Request) -> Registration:
    return cast(Registration, request.app.state.registration)


def get_registration_rate_limit(request: Request) -> RegistrationRateLimit:
    return cast(RegistrationRateLimit, request.app.state.registration_rate_limiter)


def get_email_verification(request: Request) -> EmailVerification:
    return cast(EmailVerification, request.app.state.email_verification)


def get_email_verification_rate_limit(request: Request) -> EmailVerificationRateLimit:
    return cast(EmailVerificationRateLimit, request.app.state.email_verification_rate_limiter)


def get_login(request: Request) -> Login:
    return cast(Login, request.app.state.login)


def get_login_rate_limit(request: Request) -> LoginRateLimit:
    return cast(LoginRateLimit, request.app.state.login_rate_limiter)


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
    authentication: Annotated[SessionAuthentication, Depends(get_session_authentication)],
    session_token: Annotated[str | None, Cookie(alias="__Host-studyflow_session")] = None,
) -> CurrentSessionResponse:
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
    responses={status.HTTP_403_FORBIDDEN: {"model": AuthenticationError}},
)
async def logout(
    response: Response,
    authentication: Annotated[SessionAuthentication, Depends(get_session_authentication)],
    session_token: Annotated[str | None, Cookie(alias="__Host-studyflow_session")] = None,
    csrf_token: Annotated[str | None, Header(alias="X-CSRF-Token")] = None,
) -> None:
    if (
        session_token is None
        or csrf_token is None
        or not await authentication.revoke(session_token, csrf_token)
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="CSRF validation failed")
    response.delete_cookie(
        "__Host-studyflow_session", path="/", secure=True, httponly=True, samesite="strict"
    )
    response.delete_cookie(
        "__Host-studyflow_csrf", path="/", secure=True, httponly=False, samesite="strict"
    )


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
    try:
        client_ip = http_request.client.host if http_request.client is not None else "unknown"
        await rate_limit.check(client_ip, str(payload.email))
        result = await login.login(LoginCommand(email=payload.email, password=payload.password))
    except LoginRateLimitExceeded as error:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many login attempts",
            headers={"Retry-After": "900"},
        ) from error
    except InvalidCredentialsError as error:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        ) from error
    except EmailVerificationRequiredError as error:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Email verification required",
        ) from error
    response.set_cookie(
        key="__Host-studyflow_session",
        value=result.session_token,
        max_age=7 * 24 * 60 * 60,
        path="/",
        secure=True,
        httponly=True,
        samesite="strict",
    )
    response.set_cookie(
        key="__Host-studyflow_csrf",
        value=result.csrf_token,
        max_age=7 * 24 * 60 * 60,
        path="/",
        secure=True,
        httponly=False,
        samesite="strict",
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
        status.HTTP_503_SERVICE_UNAVAILABLE: {
            "model": AuthenticationError,
            "description": "Password safety service is unavailable",
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
            RegistrationCommand(
                email=payload.email,
                name=payload.name,
                password=payload.password,
                timezone=payload.timezone,
            ),
            background_tasks,
        )
    except RegistrationRateLimitExceeded as error:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many registration attempts",
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
    return AuthenticationMessage(
        message="Check your email to continue registration if the address is eligible."
    )


@router.post(
    "/verify-email",
    status_code=status.HTTP_204_NO_CONTENT,
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
) -> None:
    client_ip = http_request.client.host if http_request.client is not None else "unknown"
    try:
        await rate_limit.check(client_ip, payload.token)
    except EmailVerificationRateLimitExceeded as error:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many verification attempts",
            headers={"Retry-After": "900"},
        ) from error
    if not await verification.verify(payload.token):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Verification token is invalid or expired",
        )
