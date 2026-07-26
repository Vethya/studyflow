from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel

from studyflow import __version__

router = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    service: str
    status: Literal["ok"]
    version: str


@router.get("/health", operation_id="get_health", response_model=HealthResponse)
async def get_health() -> HealthResponse:
    return HealthResponse(service="studyflow-api", status="ok", version=__version__)
