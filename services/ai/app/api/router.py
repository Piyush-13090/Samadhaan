"""Aggregates every route module into a single router.

Future capability routers — duplicates, classification, verification — are
registered here as their milestones land.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.api.routes import (
    analysis,
    coordinator,
    embeddings,
    health,
    insights,
    knowledge,
    matching,
    priority,
    verification,
)

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(analysis.router)
api_router.include_router(embeddings.router)
api_router.include_router(matching.router)
api_router.include_router(coordinator.router)
api_router.include_router(knowledge.router)
api_router.include_router(priority.router)
api_router.include_router(verification.router)
api_router.include_router(insights.router)
