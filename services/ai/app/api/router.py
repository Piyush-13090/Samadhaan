"""Aggregates every route module into a single router.

Future capability routers — duplicates, classification, verification — are
registered here as their milestones land.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.api.routes import analysis, embeddings, health

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(analysis.router)
api_router.include_router(embeddings.router)
