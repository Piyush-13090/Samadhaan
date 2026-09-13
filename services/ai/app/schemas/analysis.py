"""Request and response contracts for problem analysis."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.core.taxonomy import CATEGORIES, SEVERITIES, URGENCIES

CategoryLiteral = Literal[
    "ROADS", "POTHOLES", "STREETLIGHTS", "WATER", "DRAINAGE", "SANITATION",
    "GARBAGE", "TRAFFIC", "PUBLIC_SAFETY", "POLLUTION", "ELECTRICITY",
    "PUBLIC_TRANSPORT", "PARKS", "PUBLIC_INFRASTRUCTURE", "OTHER",
]

LevelLiteral = Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]


class AnalysisImage(BaseModel):
    """One image, inlined as base64.

    The API sends bytes rather than a URL on purpose. A URL would mean the AI
    service fetching a caller-supplied address, which is an SSRF hole — and it
    would need storage credentials it has no other reason to hold.
    """

    media_type: Literal["image/jpeg", "image/png", "image/webp"]
    data: str = Field(min_length=1, description="Base64-encoded image bytes")


class AnalyzeProblemRequest(BaseModel):
    """What NestJS sends to have a problem analysed."""

    problem_id: str = Field(min_length=1, max_length=64)
    public_id: str | None = Field(default=None, max_length=32)

    title: str = Field(min_length=1, max_length=200)
    description: str = Field(min_length=1, max_length=4000)

    # The citizen's own choice, offered as a hint. Never binding: reporters
    # routinely pick the nearest-looking option, and treating it as ground
    # truth would make the model agree with mistakes.
    category_hint: str | None = Field(default=None, max_length=64)
    subcategory_hint: str | None = Field(default=None, max_length=120)

    # Coarse locality only. Enough for the model to say "near a marketplace";
    # never coordinates, which it does not need and should not repeat.
    locality: str | None = Field(default=None, max_length=200)

    images: list[AnalysisImage] = Field(default_factory=list, max_length=4)

    @field_validator("images")
    @classmethod
    def _cap_payload(cls, images: list[AnalysisImage]) -> list[AnalysisImage]:
        """Rejects a payload no legitimate caller would send.

        Base64 inflates by about a third, so 24 MB of encoded data is roughly
        18 MB of image — already far past what the caller downsizes to.
        """
        total = sum(len(image.data) for image in images)
        if total > 24 * 1024 * 1024:
            raise ValueError("Combined image payload is too large")
        return images


class ModelAnalysis(BaseModel):
    """The structured output the vision-language model must return.

    This schema is handed to the provider, so the model is constrained to it
    rather than asked politely for JSON.
    """

    category: CategoryLiteral
    subcategory: str = Field(max_length=80)
    severity: LevelLiteral
    urgency: LevelLiteral
    summary: str = Field(min_length=10, max_length=400)
    confidence: float = Field(ge=0.0, le=1.0)
    # Short, evidence-based statements shown to citizens — never the model's
    # private reasoning. See `prompts/problem_analysis.py`.
    observations: list[str] = Field(default_factory=list, max_length=5)


class AnalysisResult(BaseModel):
    """What the AI service returns to NestJS."""

    problem_id: str
    provider: str
    model_name: str
    model_version: str

    category: CategoryLiteral
    subcategory: str | None
    severity: LevelLiteral
    urgency: LevelLiteral
    summary: str
    confidence: float
    observations: list[str]

    # 0–10, derived from the severity band. Finer-grained ordering for the
    # triage queue without asking the model for a number it cannot calibrate.
    severity_score: float = Field(ge=0.0, le=10.0)

    processing_ms: int
    image_count: int
    # True when the analysis rested on text alone — no usable image was sent.
    text_only: bool


class AnalysisError(BaseModel):
    """A failure the caller can act on."""

    code: Literal[
        "PROVIDER_UNAVAILABLE",
        "PROVIDER_ERROR",
        "INVALID_MODEL_OUTPUT",
        "TIMEOUT",
        "UNSUPPORTED_IMAGE",
    ]
    message: str
    # Whether trying again could plausibly succeed. Drives the caller's retry
    # policy, so a permanent failure does not burn paid API calls.
    retryable: bool


__all__ = [
    "CATEGORIES",
    "SEVERITIES",
    "URGENCIES",
    "AnalysisError",
    "AnalysisImage",
    "AnalysisResult",
    "AnalyzeProblemRequest",
    "ModelAnalysis",
]
