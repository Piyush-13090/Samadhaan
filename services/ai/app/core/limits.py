"""Shared concurrency limits for CPU-bound work (Prompts 27 and 29).

PDF text extraction is pure-Python and CPU-bound. It runs on worker threads so
it never blocks the event loop, and at most two run at once across the whole
service — knowledge ingestion and evidence verification share this limit.
"""

from __future__ import annotations

import anyio

EXTRACTION_LIMITER = anyio.CapacityLimiter(2)
