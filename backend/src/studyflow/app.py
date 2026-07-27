from fastapi import FastAPI

from studyflow import __version__
from studyflow.api.router import API_V1_PREFIX, api_router
from studyflow.settings import Settings


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved_settings = settings or Settings()
    application = FastAPI(
        title="StudyFlow API",
        version=__version__,
        debug=resolved_settings.debug,
        docs_url=f"{API_V1_PREFIX}/docs",
        openapi_url=f"{API_V1_PREFIX}/openapi.json",
        redoc_url=None,
        swagger_ui_oauth2_redirect_url=f"{API_V1_PREFIX}/docs/oauth2-redirect",
    )
    application.state.settings = resolved_settings
    application.include_router(api_router)

    return application


app = create_app()
