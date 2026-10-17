"""Search query understanding — Prompt 25.

A fallback for ambiguous natural-language searches. The model reads one
untrusted query and returns enum-bounded filters plus a cleaned semantic
query. It never returns SQL, identifiers or anything executable; NestJS
re-validates every value against its own taxonomy and known cities.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.analysis import CategoryLiteral, LevelLiteral


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", protected_namespaces=())


EntityLiteral = Literal["PROBLEM", "ORGANIZATION", "KNOWLEDGE", "PROJECT"]
StatusLiteral = Literal[
    "SUBMITTED", "UNDER_REVIEW", "VERIFIED", "IN_PROGRESS", "RESOLVED", "REJECTED"
]
OrgTypeLiteral = Literal["NGO", "UNIVERSITY", "INDUSTRY", "GOVERNMENT"]
TimeRangeLiteral = Literal["today", "last_7_days", "last_30_days", "this_month", "this_year"]


class UnderstandRequest(_Strict):
    query: str = Field(min_length=1, max_length=200)


class SearchFilters(_Strict):
    category: CategoryLiteral | None = None
    severity: LevelLiteral | None = None
    status: StatusLiteral | None = None
    # A place name exactly as written in the query; NestJS keeps it only if
    # it is a city the platform knows.
    city: str | None = Field(default=None, max_length=100)
    organization_type: OrgTypeLiteral | None = None
    time_range: TimeRangeLiteral | None = None


class UnderstandModelOutput(_Strict):
    """What the model must return. No reasoning field."""

    intent: Literal[
        "SEARCH_PROBLEMS",
        "SEARCH_ORGANIZATIONS",
        "SEARCH_KNOWLEDGE",
        "SEARCH_PROJECTS",
        "SEARCH_ALL",
    ]
    entity_type: EntityLiteral | None = None
    filters: SearchFilters = Field(default_factory=SearchFilters)
    semantic_query: str = Field(default="", max_length=200)
    confidence: float = Field(ge=0.0, le=1.0)


class UnderstandResult(UnderstandModelOutput):
    ai_ran: bool
    provider: str
    model_name: str
    prompt_version: str
