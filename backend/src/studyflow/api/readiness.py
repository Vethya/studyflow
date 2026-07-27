import asyncio
from typing import Literal, cast

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel

from studyflow.database import DatabaseReadiness
from studyflow.settings import Settings

router = APIRouter(tags=["health"])


class ReadinessResponse(BaseModel):
    service: str
    status: Literal["ready"]
    database: Literal["reachable"]


class DatabaseUnavailableResponse(BaseModel):
    detail: Literal["Database is unavailable"]


@router.get(
    "/ready",
    operation_id="get_readiness",
    response_model=ReadinessResponse,
    responses={
        status.HTTP_503_SERVICE_UNAVAILABLE: {
            "model": DatabaseUnavailableResponse,
            "description": "Database is unavailable",
        }
    },
)
async def get_readiness(request: Request) -> ReadinessResponse:
    database = cast(DatabaseReadiness, request.app.state.database)
    settings = cast(Settings, request.app.state.settings)
    try:
        async with asyncio.timeout(settings.database_readiness_timeout_seconds):
            await database.ping()
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database is unavailable",
        ) from None
    return ReadinessResponse(
        service="studyflow-api",
        status="ready",
        database="reachable",
    )
