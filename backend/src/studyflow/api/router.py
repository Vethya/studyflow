from fastapi import APIRouter

from studyflow.api.auth import router as auth_router
from studyflow.api.health import router as health_router
from studyflow.api.readiness import router as readiness_router

API_V1_PREFIX = "/api/v1"

api_router = APIRouter(prefix=API_V1_PREFIX)
api_router.include_router(auth_router)
api_router.include_router(health_router)
api_router.include_router(readiness_router)
