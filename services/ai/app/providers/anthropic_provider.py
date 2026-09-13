"""Claude vision provider."""

from __future__ import annotations

import anthropic

from app.core.logging import get_logger
from app.providers.base import ProviderError, ProviderInfo, VisionLanguageProvider
from app.schemas.analysis import AnalysisImage, ModelAnalysis

logger = get_logger(__name__)

# Enough for a summary, a handful of observations and the model's thinking.
MAX_TOKENS = 4096


class AnthropicVisionProvider(VisionLanguageProvider):
    """Analyses a problem with Claude.

    Uses `messages.parse()` with a Pydantic output format, so the model is
    *constrained* to the schema rather than asked for JSON and parsed
    hopefully. That removes the whole class of "the model wrapped it in
    markdown" failures, and what comes back is already validated.
    """

    def __init__(self, *, api_key: str, model: str, timeout_seconds: float = 60.0) -> None:
        self._model = model
        self._client = anthropic.AsyncAnthropic(
            api_key=api_key,
            timeout=timeout_seconds,
            # The SDK retries connection errors, 429 and 5xx itself. Two is
            # enough here — the caller has its own retry policy on top, and
            # stacking long backoffs would hold a worker for minutes.
            max_retries=2,
        )

    @property
    def info(self) -> ProviderInfo:
        return ProviderInfo(
            provider="anthropic",
            model_name=self._model,
            # The model id carries the version; a separate field would drift.
            model_version=self._model,
        )

    async def analyze(
        self,
        *,
        system_prompt: str,
        user_message: str,
        images: list[AnalysisImage],
    ) -> ModelAnalysis:
        content: list[dict[str, object]] = [
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": image.media_type,
                    "data": image.data,
                },
            }
            for image in images
        ]
        # Text after the images: the prose refers to them, and the model reads
        # in order.
        content.append({"type": "text", "text": user_message})

        try:
            response = await self._client.messages.parse(
                model=self._model,
                max_tokens=MAX_TOKENS,
                system=system_prompt,
                messages=[{"role": "user", "content": content}],
                output_format=ModelAnalysis,
            )
        except anthropic.AuthenticationError as error:
            # A bad key will not fix itself; retrying wastes calls.
            raise ProviderError(
                "PROVIDER_UNAVAILABLE",
                "The AI provider rejected our credentials.",
                retryable=False,
            ) from error
        except anthropic.PermissionDeniedError as error:
            raise ProviderError(
                "PROVIDER_UNAVAILABLE",
                "The AI provider denied access to this model.",
                retryable=False,
            ) from error
        except anthropic.RateLimitError as error:
            raise ProviderError(
                "PROVIDER_ERROR",
                "The AI provider is rate limiting requests.",
                retryable=True,
            ) from error
        except anthropic.APITimeoutError as error:
            raise ProviderError(
                "TIMEOUT", "The AI provider took too long to respond.", retryable=True
            ) from error
        except anthropic.APIConnectionError as error:
            raise ProviderError(
                "PROVIDER_ERROR", "Could not reach the AI provider.", retryable=True
            ) from error
        except anthropic.BadRequestError as error:
            # Usually a malformed or unsupported image. Retrying the identical
            # payload produces the identical rejection.
            raise ProviderError(
                "UNSUPPORTED_IMAGE",
                "The AI provider could not process this report's images.",
                retryable=False,
            ) from error
        except anthropic.APIStatusError as error:
            raise ProviderError(
                "PROVIDER_ERROR",
                "The AI provider returned an error.",
                retryable=error.status_code >= 500,
            ) from error

        # A refusal is a deliberate decline, not a transient failure.
        if response.stop_reason == "refusal":
            logger.warning(
                "provider_refused",
                category=getattr(response.stop_details, "category", None),
            )
            raise ProviderError(
                "PROVIDER_ERROR",
                "The AI model declined to analyse this report.",
                retryable=False,
            )

        parsed = response.parsed_output

        if parsed is None:
            # Constrained decoding makes this rare; when it happens the output
            # is unusable and a retry may well produce the same thing.
            raise ProviderError(
                "INVALID_MODEL_OUTPUT",
                "The AI model returned an unusable response.",
                retryable=True,
            )

        return parsed


__all__ = ["AnthropicVisionProvider"]
