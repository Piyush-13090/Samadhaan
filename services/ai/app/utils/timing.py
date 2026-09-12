"""Timing helpers for health probes and, later, model inference latency."""

from __future__ import annotations

import time
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass


@dataclass
class Elapsed:
    """Mutable holder populated when the `measure` block exits."""

    milliseconds: float = 0.0


@contextmanager
def measure() -> Iterator[Elapsed]:
    """Measures wall-clock duration of a block in milliseconds.

    >>> with measure() as elapsed:
    ...     pass
    >>> elapsed.milliseconds >= 0
    True
    """
    elapsed = Elapsed()
    started = time.perf_counter()
    try:
        yield elapsed
    finally:
        elapsed.milliseconds = round((time.perf_counter() - started) * 1000, 2)
