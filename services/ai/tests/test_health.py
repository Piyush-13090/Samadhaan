"""Health endpoint contract.

These assertions are what the NestJS health module relies on, so a change here
is a change to a cross-service contract.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.services.health_service import HealthService


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


def test_health_lists_both_ai_capabilities(client: TestClient) -> None:
    """Each AI capability is reported separately, so an operator can see which
    one is unavailable rather than only that something is."""
    body = client.get("/health").json()
    names = {dep["name"] for dep in body["dependencies"]}

    assert {"llmProvider", "embeddingProvider"} <= names


def test_unconfigured_providers_report_degraded() -> None:
    """With nothing configured the service is usable but limited — that must be
    visible, not silently reported as healthy.

    Built from explicit settings rather than the endpoint: the endpoint reads
    the ambient `.env`, so asserting on it would make this test pass or fail
    depending on how the developer's machine happens to be configured.
    """
    report = HealthService(
        Settings(LLM_PROVIDER="", LLM_API_KEY="", EMBEDDING_PROVIDER="")
    ).readiness()

    assert report.status == "degraded"
    assert {dep.name: dep.status for dep in report.dependencies} == {
        "llmProvider": "degraded",
        "embeddingProvider": "degraded",
    }


def test_configured_providers_report_ok() -> None:
    report = HealthService(
        Settings(
            LLM_PROVIDER="anthropic",
            LLM_API_KEY="test-key",
            EMBEDDING_PROVIDER="sentence-transformers",
            EMBEDDING_MODEL="sentence-transformers/all-MiniLM-L6-v2",
        )
    ).readiness()

    assert report.status == "ok"


def test_embedding_health_names_the_model() -> None:
    """Two deployments running different encoders produce vectors that must
    never be compared. This is where that becomes visible."""
    report = HealthService(
        Settings(
            EMBEDDING_PROVIDER="sentence-transformers",
            EMBEDDING_MODEL="sentence-transformers/all-MiniLM-L6-v2",
            EMBEDDING_DIMENSIONS=384,
        )
    ).readiness()

    embedding = next(
        dep for dep in report.dependencies if dep.name == "embeddingProvider"
    )
    assert embedding.message is not None
    assert "all-MiniLM-L6-v2" in embedding.message
    assert "384d" in embedding.message


def test_root_points_at_health(client: TestClient) -> None:
    response = client.get("/")

    assert response.status_code == 200
    assert response.json()["health"] == "/health"
