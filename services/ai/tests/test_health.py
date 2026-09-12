"""Health endpoint contract.

These assertions are what the NestJS health module relies on, so a change here
is a change to a cross-service contract.
"""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_liveness_reports_ok(client: TestClient) -> None:
    response = client.get("/health/live")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.json()["service"] == "samadhaan-ai"


def test_health_returns_full_report(client: TestClient) -> None:
    response = client.get("/health")

    assert response.status_code == 200
    body = response.json()

    # Field names are camelCase: the NestJS HealthReport type consumes these.
    assert set(body) >= {
        "status",
        "service",
        "version",
        "environment",
        "uptimeSeconds",
        "timestamp",
        "dependencies",
    }
    assert body["status"] in {"ok", "degraded", "down"}


def test_health_reports_unconfigured_providers_as_degraded(client: TestClient) -> None:
    """With no LLM/embedding credentials the service is usable but limited —
    that must be visible, not silently reported as healthy."""
    body = client.get("/health").json()
    names = {dep["name"] for dep in body["dependencies"]}

    assert {"llmProvider", "embeddingProvider"} <= names
    assert body["status"] == "degraded"


def test_root_points_at_health(client: TestClient) -> None:
    response = client.get("/")

    assert response.status_code == 200
    assert response.json()["health"] == "/health"
