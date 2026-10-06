"""Knowledge (RAG) contracts — Prompt 20.

Chunking: NestJS sends a document (text or base64 bytes) and chunking
settings; this service extracts, cleans and chunks it. Embeddings are produced
by the existing ``/embeddings/text`` endpoint, so one embedding provider serves
problems, organisations and knowledge alike.

Answering: NestJS sends the question, bounded application context and only
**authorised** evidence passages. This service never retrieves anything itself.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", protected_namespaces=())


class ChunkRequest(_Strict):
    text: str | None = Field(default=None, max_length=1_000_000)
    # Base64 file bytes, for PDFs and uploaded files. ~10 MB decoded.
    file_base64: str | None = Field(default=None, max_length=14_000_000)
    mime_type: Literal["text/plain", "text/markdown", "text/html", "application/pdf"] | None = None
    max_tokens: int = Field(default=350, ge=50, le=2000)
    overlap_tokens: int = Field(default=50, ge=0, le=500)
    min_tokens: int = Field(default=20, ge=0, le=500)
    max_chunks: int = Field(default=2000, ge=1, le=10_000)

    @model_validator(mode="after")
    def _one_input(self) -> ChunkRequest:
        if (self.text is None) == (self.file_base64 is None):
            raise ValueError("Send exactly one of text or file_base64.")
        if self.overlap_tokens >= self.max_tokens:
            raise ValueError("overlap_tokens must be smaller than max_tokens.")
        return self


class ChunkOut(BaseModel):
    index: int
    content: str
    token_count: int
    section_title: str | None
    page_number: int | None
    content_hash: str


class ChunkResponse(BaseModel):
    detected_type: str
    page_count: int | None
    character_count: int
    chunks: list[ChunkOut]
    chunker_version: str
    processing_ms: int


# ---------------------------------------------------------------- answering


class Evidence(_Strict):
    """One authorised passage. ``ref`` is how the answer cites it (E1, E2…)."""

    ref: str = Field(pattern=r"^E\d{1,3}$")
    title: str = Field(max_length=300)
    section: str | None = Field(default=None, max_length=300)
    content: str = Field(max_length=4000)


class AnswerRequest(_Strict):
    question: str = Field(min_length=3, max_length=1000)
    # Bounded, already-authorised application facts (problem, project…).
    application_context: list[str] = Field(default_factory=list, max_length=40)
    evidence: list[Evidence] = Field(default_factory=list, max_length=12)


class ModelAnswer(_Strict):
    """What the model must return. No reasoning field."""

    answer: str = Field(max_length=4000)
    insufficient_evidence: bool
    evidence_refs: list[str] = Field(default_factory=list, max_length=12)
    suggestions: list[str] = Field(default_factory=list, max_length=5)


class AnswerResult(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    answer: str
    insufficient_evidence: bool
    evidence_refs: list[str]
    suggestions: list[str]
    provider: str
    model_name: str
    model_version: str
    prompt_version: str
    processing_ms: int
    # Citations removed because they named evidence that was not provided.
    dropped_citations: int
