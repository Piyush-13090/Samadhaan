"""The vision-language provider contract."""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Callable
from dataclasses import dataclass
from typing import TypeVar

from pydantic import BaseModel

from app.schemas.analysis import AnalysisImage, ModelAnalysis


class ProviderError(Exception):
    """A provider call that failed.

    `retryable` is the important field: it decides whether the caller tries
    again or gives up. Getting it wrong in one direction burns paid API calls
    on a request that can never succeed; in the other, it abandons a report
    over a transient blip.
    """

    def __init__(
        self,
        code: str,
        message: str,
        *,
        retryable: bool = False,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable


@dataclass(frozen=True)
class ProviderInfo:
    """Which model produced a result.

    Recorded on every analysis so a regression can be traced to the model that
    caused it, and so results from different models are never silently compared.
    """

    provider: str
    model_name: str
    model_version: str


T = TypeVar("T", bound=BaseModel)


class VisionLanguageProvider(ABC):
    """A model that can read an image and some text and return structured output.

    Deliberately narrow. Everything provider-specific — auth, request shape,
    retries, how structured output is enforced — lives behind this one method,
    so swapping vendors cannot leak into the analysis service.
    """

    @property
    @abstractmethod
    def info(self) -> ProviderInfo:
        """Identifies the model. Read after a call to record what ran."""

    @abstractmethod
    async def analyze(
        self,
        *,
        system_prompt: str,
        user_message: str,
        images: list[AnalysisImage],
    ) -> ModelAnalysis:
        """Returns a validated analysis, or raises `ProviderError`.

        Implementations must not return unvalidated model output: the caller
        trusts the returned object, so schema enforcement belongs here.
        """

    async def generate(
        self,
        *,
        system_prompt: str,
        user_message: str,
        output_type: type[T],
        development_fallback: Callable[[], T] | None = None,
        max_tokens: int = 2048,
        images: list[AnalysisImage] | None = None,
    ) -> T:
        """Text in, a validated instance of ``output_type`` out (Prompt 19).

        The general structured-generation entry point: the coordinator and the
        update extractor use it. Like ``analyze``, the result is schema-checked
        before it is returned, and failures raise ``ProviderError``.

        ``images`` (Prompt 22) are sent before the text, for tasks that compare
        photographs; text-only callers omit them.

        ``development_fallback`` is used **only** by the development provider,
        which runs no model: the caller supplies a deterministic result built
        from its own inputs, so nothing is invented. Real providers ignore it.
        """
        raise ProviderError(
            "PROVIDER_UNAVAILABLE",
            "This provider does not support structured text generation.",
            retryable=False,
        )


__all__ = ["ProviderError", "ProviderInfo", "VisionLanguageProvider"]
