"""Per-request deadlines (Prompt 29).

The NestJS API waits a fixed time for each call (8 s for search
understanding, 60–120 s for the rest) and then gives up. Before this, the
provider call underneath kept running — the Anthropic SDK's own timeout and
retries allow about three minutes — so the API had moved on while work it no
longer wanted was still being done and billed.

The API now sends how long it will wait (`x-deadline-ms`). Provider calls run
under `provider_budget()`: the smaller of that (minus a margin for the
response to travel back) and `LLM_DEADLINE_SECONDS`, which also bounds calls
that arrive without the header. When it expires the call is cancelled and a
retryable TIMEOUT is returned, before the caller has given up.
"""

from __future__ import annotations

import time
from contextvars import ContextVar

DEADLINE_HEADER = "x-deadline-ms"
#: Time left for the response to reach the caller after the work stops.
RESPONSE_MARGIN_SECONDS = 1.0
#: Never schedule work with less than this; it would only ever time out.
MIN_BUDGET_SECONDS = 1.0
MAX_DEADLINE_MS = 600_000

_deadline: ContextVar[float | None] = ContextVar("request_deadline", default=None)


def set_deadline_from_header(value: str | None) -> None:
    """Records the caller's deadline; malformed or out-of-range values are ignored."""
    if value is None or not value.isdigit():
        _deadline.set(None)
        return
    ms = int(value)
    if not 0 < ms <= MAX_DEADLINE_MS:
        _deadline.set(None)
        return
    _deadline.set(time.monotonic() + ms / 1000)


def provider_budget(cap_seconds: float) -> float:
    """Seconds a provider call may take: within the caller's deadline and the cap."""
    deadline = _deadline.get()
    budget = cap_seconds
    if deadline is not None:
        budget = min(budget, deadline - time.monotonic() - RESPONSE_MARGIN_SECONDS)
    return max(MIN_BUDGET_SECONDS, budget)
