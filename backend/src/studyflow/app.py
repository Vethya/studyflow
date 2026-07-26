from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from studyflow import __version__
from studyflow.api.router import API_V1_PREFIX, api_router
from studyflow.database import Database, DatabaseRuntime
from studyflow.settings import Settings


@asynccontextmanager
async def lifespan(application: FastAPI) -> AsyncIterator[None]:
    database: DatabaseRuntime = application.state.database
    await database.start()
    try:
        yield
    finally:
        await database.stop()


def create_app(
    settings: Settings | None = None,
    database: DatabaseRuntime | None = None,
) -> FastAPI:
    resolved_settings = settings or Settings()
    resolved_database = database or Database(resolved_settings.database_url.get_secret_value())
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
    application.include_router(api_router)

    return application


app = create_app()
