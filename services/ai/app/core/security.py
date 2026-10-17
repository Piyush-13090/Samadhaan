"""Internal-traffic authentication.

The AI service is not public. The NestJS API is the only intended caller, and
it sends a shared secret in ``x-internal-token``.

- Production: the token is mandatory (settings refuse to start without one),
  and a request without the right token is refused.
- Development/test: when no token is configured the check is skipped, which is
  logged once at startup. Bind the service to localhost in that case.

The comparison is constant-time, so response timing reveals nothing about the
expected value.
"""

from __future__ import annotations

import hmac

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
    settings = get_settings()
    expected = settings.internal_token

    if not expected:
        if settings.is_production:
            # Defence in depth: settings validation already refuses this.
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Service authentication is not configured",
            )
        return

    if not x_internal_token or not hmac.compare_digest(
        x_internal_token.encode(), expected.encode()
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing internal service token",
        )
