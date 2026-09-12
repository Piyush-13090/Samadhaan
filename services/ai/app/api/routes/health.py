"""Health endpoints.

Intentionally unauthenticated so orchestrators, uptime checks and the NestJS
health module can probe the service without a credential.
"""

from __future__ import annotations

from fastapi import APIRouter, Response, status

from app.api.deps import HealthServiceDep
from app.schemas.health import HealthReport

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthReport, response_model_by_alias=True)
async def health(service: HealthServiceDep, response: Response) -> HealthReport:
    """Full readiness report, consumed by the NestJS `/api/v1/health` endpoint.

    Returns 503 only when the service genuinely cannot serve requests;
    unconfigured AI providers report as `degraded` with a 200.
    """
    report = service.readiness()

    if report.status == "down":
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE

    return report


@router.get("/health/live")
async def liveness(service: HealthServiceDep) -> dict[str, str]:
    """Cheap dependency-free liveness probe for container restart policies."""
    return service.liveness()
