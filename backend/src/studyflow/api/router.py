from fastapi import APIRouter

from studyflow.api.health import router as health_router

API_V1_PREFIX = "/api/v1"

api_router = APIRouter(prefix=API_V1_PREFIX)
api_router.include_router(health_router)
