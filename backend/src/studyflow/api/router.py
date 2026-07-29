from fastapi import APIRouter

from studyflow.api.account import router as account_router
from studyflow.api.auth import router as auth_router
from studyflow.api.availability import router as availability_router
from studyflow.api.health import router as health_router
from studyflow.api.readiness import router as readiness_router
from studyflow.api.tasks import router as tasks_router

API_V1_PREFIX = "/api/v1"

api_router = APIRouter(prefix=API_V1_PREFIX)
api_router.include_router(account_router)
api_router.include_router(availability_router)
api_router.include_router(auth_router)
api_router.include_router(health_router)
api_router.include_router(readiness_router)
api_router.include_router(tasks_router)
