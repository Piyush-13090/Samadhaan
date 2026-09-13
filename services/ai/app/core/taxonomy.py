"""Canonical civic problem taxonomy.

Mirrors the `ProblemCategory`, `ProblemSeverity` and `ProblemUrgency` enums in
the Prisma schema. The database is the source of truth; this file is how the AI
service learns it.

A model cannot be trusted to emit exactly these strings, so everything that
comes back is normalised here before it reaches the API. A value that cannot be
normalised is rejected rather than guessed at — a misfiled problem reaches the
wrong department and stalls, which is worse than a low-confidence OTHER.
"""

from __future__ import annotations

from typing import Final

# ---------------------------------------------------------------------------
# Controlled vocabularies
# ---------------------------------------------------------------------------

CATEGORIES: Final[tuple[str, ...]] = (
    "ROADS",
    "POTHOLES",
    "STREETLIGHTS",
    "WATER",
    "DRAINAGE",
    "SANITATION",
    "GARBAGE",
    "TRAFFIC",
    "PUBLIC_SAFETY",
    "POLLUTION",
    "ELECTRICITY",
    "PUBLIC_TRANSPORT",
    "PARKS",
    "PUBLIC_INFRASTRUCTURE",
    "OTHER",
)

SEVERITIES: Final[tuple[str, ...]] = ("LOW", "MEDIUM", "HIGH", "CRITICAL")

URGENCIES: Final[tuple[str, ...]] = ("LOW", "MEDIUM", "HIGH", "CRITICAL")

# ---------------------------------------------------------------------------
# Category guidance, given to the model verbatim
# ---------------------------------------------------------------------------

CATEGORY_GUIDANCE: Final[dict[str, str]] = {
    "ROADS": "Road surface, signage, kerbs, footpaths and road markings — excluding potholes.",
    "POTHOLES": "Potholes and road-surface cavities specifically.",
    "STREETLIGHTS": "Street lighting that is broken, unlit, flickering or damaged.",
    "WATER": "Drinking-water supply: outages, leaks, contamination, pressure.",
    "DRAINAGE": "Stormwater and sewage drainage, waterlogging, blocked or open drains.",
    "SANITATION": "Public toilets, open defecation, unclean public areas.",
    "GARBAGE": "Uncollected waste, overflowing bins, illegal dumping.",
    "TRAFFIC": "Signals, congestion, illegal parking, traffic management.",
    "PUBLIC_SAFETY": (
        "Immediate physical hazards: open manholes, exposed wiring, unsafe structures."
    ),
    "POLLUTION": "Air, noise or water pollution, burning of waste.",
    "ELECTRICITY": "Power supply, damaged transformers, exposed cables.",
    "PUBLIC_TRANSPORT": "Bus stops, shelters, transport infrastructure.",
    "PARKS": "Parks, playgrounds and open spaces.",
    "PUBLIC_INFRASTRUCTURE": "Other public assets: benches, railings, civic buildings.",
    "OTHER": "A genuine civic problem that fits none of the above.",
}

# ---------------------------------------------------------------------------
# Severity and urgency rubric, given to the model verbatim
# ---------------------------------------------------------------------------

SEVERITY_RUBRIC: Final[str] = """\
LOW      Cosmetic or minor inconvenience. No safety implication.
MEDIUM   Meaningful disruption to daily life, or damage likely to worsen.
HIGH     Significant disruption, or a plausible risk of injury.
CRITICAL Immediate danger to life or limb, or a large population affected."""

URGENCY_RUBRIC: Final[str] = """\
LOW      Can wait for routine scheduled maintenance.
MEDIUM   Should be addressed within a few weeks.
HIGH     Should be addressed within days.
CRITICAL Requires attention today; someone could be hurt before tomorrow."""

# ---------------------------------------------------------------------------
# Normalisation
# ---------------------------------------------------------------------------

# Forms a model plausibly emits, mapped to the canonical value. Deliberately
# conservative: only unambiguous synonyms, because a wrong mapping is worse
# than a rejection the caller can see.
_CATEGORY_ALIASES: Final[dict[str, str]] = {
    "ROAD": "ROADS",
    "ROAD_INFRASTRUCTURE": "ROADS",
    "POTHOLE": "POTHOLES",
    "STREET_LIGHT": "STREETLIGHTS",
    "STREET_LIGHTS": "STREETLIGHTS",
    "STREETLIGHT": "STREETLIGHTS",
    "LIGHTING": "STREETLIGHTS",
    "WATER_SUPPLY": "WATER",
    "SEWAGE": "DRAINAGE",
    "SEWERAGE": "DRAINAGE",
    "WATERLOGGING": "DRAINAGE",
    "WASTE": "GARBAGE",
    "WASTE_MANAGEMENT": "GARBAGE",
    "TRASH": "GARBAGE",
    "SAFETY": "PUBLIC_SAFETY",
    "POWER": "ELECTRICITY",
    "TRANSPORT": "PUBLIC_TRANSPORT",
    "TRANSPORTATION": "PUBLIC_TRANSPORT",
    "PARK": "PARKS",
    "ENVIRONMENT": "POLLUTION",
    "INFRASTRUCTURE": "PUBLIC_INFRASTRUCTURE",
    "PUBLIC_INFRA": "PUBLIC_INFRASTRUCTURE",
}


def _canonicalise(value: str) -> str:
    """Upper-cases and collapses separators: `road infrastructure` -> `ROAD_INFRASTRUCTURE`."""
    return "_".join(value.strip().upper().replace("-", " ").replace("_", " ").split())


def normalise_category(value: str | None) -> str | None:
    """Maps a model's category onto the taxonomy, or `None` if it cannot be."""
    if not value:
        return None

    candidate = _canonicalise(value)

    if candidate in CATEGORIES:
        return candidate

    return _CATEGORY_ALIASES.get(candidate)


def _normalise_level(value: str | None, allowed: tuple[str, ...]) -> str | None:
    if not value:
        return None

    candidate = _canonicalise(value)

    if candidate in allowed:
        return candidate

    # A handful of models phrase these as words rather than the enum.
    return {
        "VERY_HIGH": "CRITICAL",
        "SEVERE": "CRITICAL",
        "URGENT": "CRITICAL",
        "MODERATE": "MEDIUM",
        "MINOR": "LOW",
        "VERY_LOW": "LOW",
    }.get(candidate)


def normalise_severity(value: str | None) -> str | None:
    return _normalise_level(value, SEVERITIES)


def normalise_urgency(value: str | None) -> str | None:
    return _normalise_level(value, URGENCIES)


def clamp_confidence(value: float | int | None) -> float | None:
    """Clamps confidence into 0–1.

    Models occasionally return a percentage (`94`) where a fraction was asked
    for. A bare clamp would turn that into `1.0` — maximum certainty, exactly
    backwards from the caution the value is meant to express — so a plausible
    percentage is divided down first.
    """
    if value is None:
        return None

    try:
        number = float(value)
    except (TypeError, ValueError):
        return None

    if number != number:  # NaN
        return None

    if 1.0 < number <= 100.0:
        number = number / 100.0

    return max(0.0, min(1.0, number))
