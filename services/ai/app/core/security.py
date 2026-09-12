"""Internal-traffic authentication.

The AI service is not public. The NestJS API is the only intended caller, and
it sends a shared secret. When no secret is configured (typical local
development) the check is skipped, which is logged once at startup.
"""

from __future__ import annotations

from fastapi import Header, HTTPException, status

from app.core.config import get_settings
from app.core.constants import INTERNAL_TOKEN_HEADER


async def require_internal_token(
    x_internal_token: str | None = Header(default=None, alias=INTERNAL_TOKEN_HEADER),
) -> None:
    """FastAPI dependency guarding non-public routes.

    Health endpoints are intentionally left unguarded so orchestrators and
    uptime checks can probe the service without a credential.
    """
    expected = get_settings().internal_token

    if not expected:
        return

    if x_internal_token != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing internal service token",
        )
