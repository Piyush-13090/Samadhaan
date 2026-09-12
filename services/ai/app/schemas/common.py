"""Schemas shared by more than one route module."""

from __future__ import annotations

from pydantic import BaseModel


class ErrorResponse(BaseModel):
    """Error envelope returned by the global exception handlers.

    Deliberately close to the NestJS error body so the API can forward an AI
    failure without reshaping it.
    """

    code: str
    message: str
    detail: str | None = None
