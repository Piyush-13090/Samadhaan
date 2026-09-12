"""Assembles the service health report."""

from __future__ import annotations

import time
from datetime import UTC, datetime

from app.core.config import Settings
from app.core.constants import SERVICE_NAME, SERVICE_VERSION
from app.schemas.health import DependencyHealth, HealthReport, HealthStatus

_STARTED_AT = time.monotonic()

_SEVERITY: dict[HealthStatus, int] = {"ok": 0, "degraded": 1, "down": 2}


def _uptime_seconds() -> float:
    return round(time.monotonic() - _STARTED_AT, 2)


def _now() -> str:
    return datetime.now(UTC).isoformat()


class HealthService:
    """Reports whether the service is alive and whether its AI capabilities
    are actually usable.

    No model or provider clients exist yet, so readiness currently reflects
    configuration only. As providers are introduced, each gains a real probe
    here and appears as another dependency in the report.
    """

    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    def liveness(self) -> dict[str, str]:
        """Process-level check with no dependencies, for restart policies."""
        return {
            "status": "ok",
            "service": SERVICE_NAME,
            "version": SERVICE_VERSION,
            "timestamp": _now(),
        }

    def readiness(self) -> HealthReport:
        dependencies = [
            self._capability("llmProvider", self._settings.llm_configured),
            self._capability("embeddingProvider", self._settings.embeddings_configured),
        ]

        return HealthReport(
            status=self._aggregate(dependencies),
            service=SERVICE_NAME,
            version=SERVICE_VERSION,
            environment=self._settings.environment,
            uptime_seconds=_uptime_seconds(),
            timestamp=_now(),
            dependencies=dependencies,
        )

    @staticmethod
    def _capability(name: str, configured: bool) -> DependencyHealth:
        """An unconfigured provider is `degraded`, not `down`: the service
        itself is healthy, it simply cannot perform that class of work yet."""
        return DependencyHealth(
            name=name,
            status="ok" if configured else "degraded",
            latency_ms=None,
            message=None if configured else "Not configured",
        )

    @staticmethod
    def _aggregate(dependencies: list[DependencyHealth]) -> HealthStatus:
        worst: HealthStatus = "ok"
        for dependency in dependencies:
            if _SEVERITY[dependency.status] > _SEVERITY[worst]:
                worst = dependency.status
        return worst
