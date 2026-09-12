"""Health response schemas.

Mirrors the `HealthReport` TypeScript interface in packages/shared so the
NestJS health module can consume this service's report without translation.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

HealthStatus = Literal["ok", "degraded", "down"]


class DependencyHealth(BaseModel):
    name: str
    status: HealthStatus
    latency_ms: float | None = Field(default=None, serialization_alias="latencyMs")
    message: str | None = None

    model_config = {"populate_by_name": True}


class HealthReport(BaseModel):
    status: HealthStatus
    service: str
    version: str
    environment: str
    uptime_seconds: float = Field(serialization_alias="uptimeSeconds")
    timestamp: str
    dependencies: list[DependencyHealth] = Field(default_factory=list)

    model_config = {"populate_by_name": True}
