"""Deterministic provider for local development.

⚠️  NOT AI. This runs keyword rules over the report text and returns a
fixed-shape result. It exists so the full pipeline — queue, status transitions,
polling, the UI — can be exercised without an API key, and for nothing else.

Two independent guards stop it reaching production: the factory refuses to
build it when `NODE_ENV=production`, and it must be selected explicitly with
`LLM_PROVIDER=development`. It is never a silent fallback — a missing key
produces a service-unavailable error, because a fabricated severity attached to
a real civic problem is worse than no analysis at all.

Every result it returns is marked `provider="development"` and carries a
capped confidence, so a development analysis is identifiable in the database
long after the fact.
"""

from __future__ import annotations

from app.core.taxonomy import CATEGORIES
from app.providers.base import ProviderInfo, VisionLanguageProvider
from app.schemas.analysis import AnalysisImage, ModelAnalysis

# Keyword rules, most specific first. Deliberately crude — this is a stub, and
# making it cleverer would only make it easier to mistake for real analysis.
_RULES: list[tuple[tuple[str, ...], str, str, str, str]] = [
    (("manhole", "exposed wire", "live wire", "electrocut", "collapse"),
     "PUBLIC_SAFETY", "open hazard", "CRITICAL", "CRITICAL"),
    (("pothole", "crater"), "POTHOLES", "road surface cavity", "HIGH", "HIGH"),
    (("waterlog", "flood", "drain", "sewage", "sewer"),
     "DRAINAGE", "blocked drainage", "HIGH", "MEDIUM"),
    (("streetlight", "street light", "lamp post", "unlit", "dark"),
     "STREETLIGHTS", "light not working", "MEDIUM", "MEDIUM"),
    (("garbage", "trash", "waste", "rubbish", "dump"),
     "GARBAGE", "uncollected waste", "MEDIUM", "MEDIUM"),
    (("water supply", "tap", "pipeline", "leak"),
     "WATER", "supply problem", "MEDIUM", "MEDIUM"),
    (("toilet", "defecat", "sanitation"), "SANITATION", "sanitation problem", "MEDIUM", "MEDIUM"),
    (("signal", "traffic", "parking", "congestion"), "TRAFFIC", "traffic problem", "MEDIUM", "LOW"),
    (("pollution", "smoke", "burning", "noise"), "POLLUTION", "pollution", "MEDIUM", "MEDIUM"),
    (("transformer", "power cut", "electricity"), "ELECTRICITY", "supply problem", "HIGH", "HIGH"),
    (("bus stop", "shelter"), "PUBLIC_TRANSPORT", "transport facility", "LOW", "LOW"),
    (("park", "playground", "garden"), "PARKS", "park maintenance", "LOW", "LOW"),
    (("footpath", "pavement", "bench", "railing"),
     "PUBLIC_INFRASTRUCTURE", "damaged public asset", "MEDIUM", "LOW"),
    (("road", "street"), "ROADS", "road condition", "MEDIUM", "MEDIUM"),
]


class DevelopmentProvider(VisionLanguageProvider):
    """Keyword-matching stand-in. Deterministic for a given input."""

    @property
    def info(self) -> ProviderInfo:
        return ProviderInfo(
            provider="development",
            # Named so nobody reading the database mistakes these rows for real
            # model output.
            model_name="development-keyword-stub",
            model_version="0.0.0-dev",
        )

    async def analyze(
        self,
        *,
        system_prompt: str,
        user_message: str,
        images: list[AnalysisImage],
    ) -> ModelAnalysis:
        text = user_message.lower()

        category, subcategory, severity, urgency = "OTHER", "unclassified", "MEDIUM", "MEDIUM"

        for keywords, rule_category, rule_sub, rule_severity, rule_urgency in _RULES:
            if any(keyword in text for keyword in keywords):
                category, subcategory = rule_category, rule_sub
                severity, urgency = rule_severity, rule_urgency
                break

        assert category in CATEGORIES  # rules must stay inside the taxonomy

        observations = [
            "Classified by keyword matching, not by a vision-language model.",
            f"{len(images)} image(s) were received but not analysed."
            if images
            else "No images were attached.",
        ]

        return ModelAnalysis(
            category=category,  # type: ignore[arg-type]
            subcategory=subcategory,
            severity=severity,  # type: ignore[arg-type]
            urgency=urgency,  # type: ignore[arg-type]
            summary=(
                "Development placeholder analysis. This report was categorised by "
                "keyword matching, not by an AI model."
            ),
            # Capped low on purpose: the UI shows "AI is less certain about this",
            # which is the honest reading of a keyword match.
            confidence=0.35,
            observations=observations,
        )


__all__ = ["DevelopmentProvider"]
