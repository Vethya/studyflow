from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import cast

import httpx
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware

from studyflow import __version__
from studyflow.accounts.password import AccountPasswords, PasswordChangeService
from studyflow.accounts.preferences import AccountPreferences, StudyPreferencesService
from studyflow.accounts.profile import AccountProfiles, AccountProfileService
from studyflow.accounts.repositories import (
    SqlAlchemyAccountProfileRepository,
    SqlAlchemyPasswordChangeRepository,
    SqlAlchemyStudyPreferencesRepository,
)
from studyflow.api.auth import handle_google_callback_validation_error
from studyflow.api.router import API_V1_PREFIX, api_router
from studyflow.auth.breached_passwords import PwnedPasswordsClient
from studyflow.auth.cookies import CookiePolicy
from studyflow.auth.email_delivery import (
    AiosmtplibEmailTransport,
    SmtpAuthenticationEmailSender,
)
from studyflow.auth.login import Login, LoginService
from studyflow.auth.oidc import (
    GoogleOIDCProvider,
    OIDCAccountLinking,
    OIDCAccountLinkService,
    OIDCLogin,
    OIDCLoginService,
    UnconfiguredOIDCLogin,
)
from studyflow.auth.passwords import PasswordService
from studyflow.auth.rate_limits import (
    AccountPasswordChangeRateLimit,
    DatabaseAccountPasswordChangeRateLimiter,
    DatabaseEmailVerificationRateLimiter,
    DatabaseLoginRateLimiter,
    DatabaseOIDCLinkRateLimiter,
    DatabaseOIDCStartRateLimiter,
    DatabasePasswordResetAttemptRateLimiter,
    DatabasePasswordResetRequestRateLimiter,
    DatabaseRegistrationCompletionRateLimiter,
    DatabaseRegistrationRateLimiter,
    DatabaseVerificationResendRateLimiter,
    EmailVerificationRateLimit,
    LoginRateLimit,
    OIDCLinkRateLimit,
    OIDCStartRateLimit,
    PasswordResetAttemptRateLimit,
    PasswordResetRequestRateLimit,
    RegistrationCompletionRateLimit,
    RegistrationRateLimit,
    VerificationResendRateLimit,
)
from studyflow.auth.recovery import PasswordRecovery, PasswordRecoveryService
from studyflow.auth.registration import Registration, RegistrationService
from studyflow.auth.repositories import (
    SessionTransactions,
    SqlAlchemyEmailVerificationRepository,
    SqlAlchemyLoginRepository,
    SqlAlchemyOIDCRepository,
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
from studyflow.availability.repositories import (
    NoFutureSessions,
    SqlAlchemyAvailabilityWindowRepository,
    SqlAlchemyUnavailablePeriodRepository,
)
from studyflow.availability.unavailable import (
    UnavailablePeriods,
    UnavailablePeriodService,
)
from studyflow.availability.windows import AvailabilityWindows, AvailabilityWindowService
from studyflow.database import Database, DatabaseRuntime
from studyflow.scheduling.proposals import ScheduleProposalRepository
from studyflow.scheduling.repositories import SqlAlchemyScheduleProposalRepository
from studyflow.scheduling.service import ScheduleGeneration, ScheduleGenerationService
from studyflow.settings import Settings
from studyflow.tasks.repositories import SqlAlchemyAcademicTaskRepository
from studyflow.tasks.service import AcademicTasks, AcademicTaskService


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
    registration_completion_rate_limiter: RegistrationCompletionRateLimit | None = None,
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
    account_profiles: AccountProfiles | None = None,
    account_preferences: AccountPreferences | None = None,
    account_passwords: AccountPasswords | None = None,
    account_password_change_rate_limiter: AccountPasswordChangeRateLimit | None = None,
    academic_tasks: AcademicTasks | None = None,
    availability_windows: AvailabilityWindows | None = None,
    unavailable_periods: UnavailablePeriods | None = None,
    schedule_generation: ScheduleGeneration | None = None,
    schedule_proposals: ScheduleProposalRepository | None = None,
    oidc_login: OIDCLogin | None = None,
    oidc_start_rate_limiter: OIDCStartRateLimit | None = None,
    oidc_account_linking: OIDCAccountLinking | None = None,
    oidc_link_rate_limiter: OIDCLinkRateLimit | None = None,
) -> FastAPI:
    resolved_settings = settings or Settings()
    resolved_database = database or Database(resolved_settings.database_url.get_secret_value())
    transactions = cast(SessionTransactions, resolved_database)
    authentication_http_client: httpx.AsyncClient | None = None
    resolved_registration = registration
    resolved_login = login
    resolved_verification_resend = verification_resend
    resolved_password_recovery = password_recovery
    resolved_account_passwords = account_passwords
    resolved_oidc_login = oidc_login
    resolved_oidc_account_linking = oidc_account_linking
    if (
        resolved_registration is None
        or resolved_login is None
        or resolved_password_recovery is None
        or resolved_account_passwords is None
        or (resolved_oidc_login is None and resolved_settings.google_oidc_client_id is not None)
        or resolved_oidc_account_linking is None
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
    if resolved_account_passwords is None:
        resolved_account_passwords = PasswordChangeService(
            SqlAlchemyPasswordChangeRepository(transactions), password_service
        )
    if resolved_oidc_login is None:
        if (
            resolved_settings.google_oidc_client_id is not None
            and resolved_settings.google_oidc_client_secret is not None
            and resolved_settings.google_oidc_redirect_uri is not None
            and authentication_http_client is not None
        ):
            resolved_oidc_login = OIDCLoginService(
                SqlAlchemyOIDCRepository(transactions),
                GoogleOIDCProvider(
                    authentication_http_client,
                    resolved_settings.google_oidc_client_id,
                    resolved_settings.google_oidc_client_secret.get_secret_value(),
                    resolved_settings.google_oidc_redirect_uri,
                ),
                SessionService(SqlAlchemySessionRepository(transactions)),
                resolved_settings.google_oidc_client_id,
                resolved_settings.google_oidc_redirect_uri,
            )
        else:
            resolved_oidc_login = UnconfiguredOIDCLogin()
    if resolved_oidc_account_linking is None:
        resolved_oidc_account_linking = OIDCAccountLinkService(
            SqlAlchemyOIDCRepository(transactions),
            password_service,
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
    application.add_exception_handler(
        RequestValidationError, handle_google_callback_validation_error
    )
    if resolved_settings.cors_origins:
        application.add_middleware(
            CORSMiddleware,
            allow_origins=resolved_settings.cors_origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )
    resolved_account_preferences = account_preferences or StudyPreferencesService(
        SqlAlchemyStudyPreferencesRepository(transactions)
    )
    resolved_academic_tasks = academic_tasks or AcademicTaskService(
        SqlAlchemyAcademicTaskRepository(transactions)
    )
    resolved_availability_windows = availability_windows or AvailabilityWindowService(
        SqlAlchemyAvailabilityWindowRepository(transactions)
    )
    resolved_unavailable_periods = unavailable_periods or UnavailablePeriodService(
        SqlAlchemyUnavailablePeriodRepository(transactions, NoFutureSessions())
    )
    resolved_schedule_proposals = schedule_proposals or SqlAlchemyScheduleProposalRepository(
        transactions
    )
    resolved_schedule_generation = schedule_generation or ScheduleGenerationService(
        resolved_academic_tasks,
        resolved_availability_windows,
        resolved_unavailable_periods,
        resolved_account_preferences,
        resolved_schedule_proposals,
    )
    application.state.settings = resolved_settings
    application.state.cookie_policy = CookiePolicy.for_environment(resolved_settings.environment)
    application.state.database = resolved_database
    application.state.authentication_http_client = authentication_http_client
    application.state.registration = resolved_registration
    application.state.registration_rate_limiter = registration_rate_limiter or (
        DatabaseRegistrationRateLimiter(transactions)
    )
    application.state.registration_completion_rate_limiter = (
        registration_completion_rate_limiter
        or DatabaseRegistrationCompletionRateLimiter(transactions)
    )
    application.state.email_verification = email_verification or EmailVerificationService(
        SqlAlchemyEmailVerificationRepository(transactions)
    )
    application.state.email_verification_rate_limiter = email_verification_rate_limiter or (
        DatabaseEmailVerificationRateLimiter(transactions)
    )
    application.state.login = resolved_login
    application.state.oidc_login = resolved_oidc_login
    application.state.oidc_start_rate_limiter = (
        oidc_start_rate_limiter or DatabaseOIDCStartRateLimiter(transactions)
    )
    application.state.oidc_account_linking = resolved_oidc_account_linking
    application.state.oidc_link_rate_limiter = (
        oidc_link_rate_limiter or DatabaseOIDCLinkRateLimiter(transactions)
    )
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
    application.state.account_profiles = account_profiles or AccountProfileService(
        SqlAlchemyAccountProfileRepository(transactions)
    )
    application.state.account_preferences = resolved_account_preferences
    application.state.account_passwords = resolved_account_passwords
    application.state.account_password_change_rate_limiter = (
        account_password_change_rate_limiter
        or DatabaseAccountPasswordChangeRateLimiter(transactions)
    )
    application.state.academic_tasks = resolved_academic_tasks
    application.state.availability_windows = resolved_availability_windows
    application.state.unavailable_periods = resolved_unavailable_periods
    application.state.schedule_generation = resolved_schedule_generation
    application.state.schedule_proposals = resolved_schedule_proposals
    application.include_router(api_router)

    return application


app = create_app()
