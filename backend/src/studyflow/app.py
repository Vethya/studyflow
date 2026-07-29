from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import cast

import httpx
from fastapi import FastAPI

from studyflow import __version__
from studyflow.api.router import API_V1_PREFIX, api_router
from studyflow.auth.breached_passwords import PwnedPasswordsClient
from studyflow.auth.email_delivery import (
    AiosmtplibEmailTransport,
    SmtpAuthenticationEmailSender,
)
from studyflow.auth.login import Login, LoginService
from studyflow.auth.passwords import PasswordService
from studyflow.auth.rate_limits import (
    DatabaseEmailVerificationRateLimiter,
    DatabaseLoginRateLimiter,
    DatabasePasswordResetAttemptRateLimiter,
    DatabasePasswordResetRequestRateLimiter,
    DatabaseRegistrationRateLimiter,
    DatabaseVerificationResendRateLimiter,
    EmailVerificationRateLimit,
    LoginRateLimit,
    PasswordResetAttemptRateLimit,
    PasswordResetRequestRateLimit,
    RegistrationRateLimit,
    VerificationResendRateLimit,
)
from studyflow.auth.recovery import PasswordRecovery, PasswordRecoveryService
from studyflow.auth.registration import Registration, RegistrationService
from studyflow.auth.repositories import (
    SessionTransactions,
    SqlAlchemyEmailVerificationRepository,
    SqlAlchemyLoginRepository,
    SqlAlchemyPasswordRecoveryRepository,
    SqlAlchemyRegistrationRepository,
    SqlAlchemySessionAuthenticationRepository,
    SqlAlchemySessionRepository,
    SqlAlchemyVerificationResendRepository,
)
from studyflow.auth.resend import VerificationResend, VerificationResendService
from studyflow.auth.session_authentication import (
    SessionAuthentication,
    SessionAuthenticationService,
)
from studyflow.auth.sessions import SessionService
from studyflow.auth.verification import EmailVerification, EmailVerificationService
from studyflow.database import Database, DatabaseRuntime
from studyflow.settings import Settings


@asynccontextmanager
async def lifespan(application: FastAPI) -> AsyncIterator[None]:
    database: DatabaseRuntime = application.state.database
    await database.start()
    try:
        yield
    finally:
        try:
            await database.stop()
        finally:
            authentication_http_client: httpx.AsyncClient | None = (
                application.state.authentication_http_client
            )
            if authentication_http_client is not None:
                await authentication_http_client.aclose()


def create_app(
    settings: Settings | None = None,
    database: DatabaseRuntime | None = None,
    registration: Registration | None = None,
    registration_rate_limiter: RegistrationRateLimit | None = None,
    email_verification: EmailVerification | None = None,
    email_verification_rate_limiter: EmailVerificationRateLimit | None = None,
    login: Login | None = None,
    login_rate_limiter: LoginRateLimit | None = None,
    session_authentication: SessionAuthentication | None = None,
    verification_resend: VerificationResend | None = None,
    verification_resend_rate_limiter: VerificationResendRateLimit | None = None,
    password_recovery: PasswordRecovery | None = None,
    password_reset_request_rate_limiter: PasswordResetRequestRateLimit | None = None,
    password_reset_attempt_rate_limiter: PasswordResetAttemptRateLimit | None = None,
) -> FastAPI:
    resolved_settings = settings or Settings()
    resolved_database = database or Database(resolved_settings.database_url.get_secret_value())
    transactions = cast(SessionTransactions, resolved_database)
    authentication_http_client: httpx.AsyncClient | None = None
    resolved_registration = registration
    resolved_login = login
    resolved_verification_resend = verification_resend
    resolved_password_recovery = password_recovery
    if (
        resolved_registration is None
        or resolved_login is None
        or resolved_password_recovery is None
    ):
        authentication_http_client = httpx.AsyncClient(
            timeout=resolved_settings.password_breach_timeout_seconds
        )
        password_service = PasswordService(PwnedPasswordsClient(authentication_http_client))
    if (
        resolved_registration is None
        or resolved_verification_resend is None
        or resolved_password_recovery is None
    ):
        smtp_password = (
            resolved_settings.smtp_password.get_secret_value()
            if resolved_settings.smtp_password is not None
            else None
        )
        email_sender = SmtpAuthenticationEmailSender(
            transport=AiosmtplibEmailTransport(
                hostname=resolved_settings.smtp_host,
                port=resolved_settings.smtp_port,
                username=resolved_settings.smtp_username,
                password=smtp_password,
                start_tls=resolved_settings.smtp_start_tls,
            ),
            from_address=str(resolved_settings.email_from_address),
            public_app_url=resolved_settings.public_app_url,
        )
    if resolved_registration is None:
        resolved_registration = RegistrationService(
            repository=SqlAlchemyRegistrationRepository(transactions),
            passwords=password_service,
            email_sender=email_sender,
        )
    if resolved_verification_resend is None:
        resolved_verification_resend = VerificationResendService(
            SqlAlchemyVerificationResendRepository(transactions), email_sender
        )
    if resolved_login is None:
        resolved_login = LoginService(
            repository=SqlAlchemyLoginRepository(transactions),
            passwords=password_service,
            sessions=SessionService(SqlAlchemySessionRepository(transactions)),
        )
    if resolved_password_recovery is None:
        resolved_password_recovery = PasswordRecoveryService(
            repository=SqlAlchemyPasswordRecoveryRepository(transactions),
            email_sender=email_sender,
            passwords=password_service,
        )
    application = FastAPI(
        title="StudyFlow API",
        version=__version__,
        debug=resolved_settings.debug,
        lifespan=lifespan,
        docs_url=f"{API_V1_PREFIX}/docs",
        openapi_url=f"{API_V1_PREFIX}/openapi.json",
        redoc_url=None,
        swagger_ui_oauth2_redirect_url=f"{API_V1_PREFIX}/docs/oauth2-redirect",
    )
    application.state.settings = resolved_settings
    application.state.database = resolved_database
    application.state.authentication_http_client = authentication_http_client
    application.state.registration = resolved_registration
    application.state.registration_rate_limiter = registration_rate_limiter or (
        DatabaseRegistrationRateLimiter(transactions)
    )
    application.state.email_verification = email_verification or EmailVerificationService(
        SqlAlchemyEmailVerificationRepository(transactions)
    )
    application.state.email_verification_rate_limiter = email_verification_rate_limiter or (
        DatabaseEmailVerificationRateLimiter(transactions)
    )
    application.state.login = resolved_login
    application.state.login_rate_limiter = login_rate_limiter or DatabaseLoginRateLimiter(
        transactions
    )
    application.state.session_authentication = session_authentication or (
        SessionAuthenticationService(SqlAlchemySessionAuthenticationRepository(transactions))
    )
    application.state.verification_resend = resolved_verification_resend
    application.state.verification_resend_rate_limiter = (
        verification_resend_rate_limiter or DatabaseVerificationResendRateLimiter(transactions)
    )
    application.state.password_recovery = resolved_password_recovery
    application.state.password_reset_request_rate_limiter = (
        password_reset_request_rate_limiter or DatabasePasswordResetRequestRateLimiter(transactions)
    )
    application.state.password_reset_attempt_rate_limiter = (
        password_reset_attempt_rate_limiter or DatabasePasswordResetAttemptRateLimiter(transactions)
    )
    application.include_router(api_router)

    return application


app = create_app()
