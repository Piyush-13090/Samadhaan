"""Personal-identifier redaction for model inputs (Prompt 28).

Applied identically when a dataset is prepared for training and when a model
predicts, so a model never learns from — and is never fed — an email address,
phone number or identity-document number someone typed into a report. Pattern
redaction is a safety net, not anonymisation: datasets are also restricted to
an allow-list of fields (see `ml/privacy.py`).
"""

from __future__ import annotations

import re
from collections import Counter
from typing import Final

_PATTERNS: Final[tuple[tuple[str, re.Pattern[str]], ...]] = (
    ("EMAIL", re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")),
    ("URL", re.compile(r"\bhttps?://\S+", re.IGNORECASE)),
    # Aadhaar-style 12 digits, optionally grouped 4-4-4. Before PHONE so the
    # longer number is not half-matched as a phone.
    ("ID_NUMBER", re.compile(r"\b\d{4}[ -]?\d{4}[ -]?\d{4}\b")),
    # PAN: five letters, four digits, one letter.
    ("ID_NUMBER", re.compile(r"\b[A-Z]{5}\d{4}[A-Z]\b")),
    # Indian mobile numbers, with or without +91 / 0 and separators.
    ("PHONE", re.compile(r"(?:\+?91[ -]?|\b0)?\b[6-9]\d{4}[ -]?\d{5}\b")),
)


def redact_text(text: str) -> tuple[str, Counter[str]]:
    """Replaces identifiers with `[KIND]` tokens; returns the text and counts per kind."""
    counts: Counter[str] = Counter()
    for kind, pattern in _PATTERNS:

        def _sub(_: re.Match[str], kind: str = kind) -> str:
            counts[kind] += 1
            return f" [{kind}] "

        text = pattern.sub(_sub, text)
    return text, counts
