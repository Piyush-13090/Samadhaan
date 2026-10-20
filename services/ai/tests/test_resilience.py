"""Provider resilience (Prompt 29): deadlines, error codes, client reuse."""

from __future__ import annotations

import base64
import time

import anthropic
import anyio
import httpx
import pytest

from app.core import deadline
from app.core.config import Settings
from app.providers import factory
from app.providers.anthropic_provider import AnthropicVisionProvider
from app.providers.base import ProviderError
from app.schemas.analysis import ModelAnalysis
from app.services import verification_service


class _SlowMessages:
    def __init__(self, delay: float = 0.0, error: Exception | None = None) -> None:
        self.delay = delay
        self.error = error
        self.calls = 0

    async def parse(self, **_: object) -> object:
        self.calls += 1
        if self.error:
            raise self.error
        await anyio.sleep(self.delay)
        raise AssertionError("should have been cancelled")


class _FakeClient:
    def __init__(self, messages: _SlowMessages) -> None:
        self.messages = messages
        self.closed = False

    async def close(self) -> None:
        self.closed = True


def _provider(messages: _SlowMessages, deadline_seconds: float = 55.0) -> AnthropicVisionProvider:
    provider = AnthropicVisionProvider(
        api_key="test-key", model="claude-test", deadline_seconds=deadline_seconds
    )
    provider._client = _FakeClient(messages)  # type: ignore[assignment]
    return provider


async def test_caller_deadline_cancels_the_provider_call() -> None:
    # The API said it will wait 2.5 s: the call must stop ~1 s before that.
    deadline.set_deadline_from_header("2500")
    messages = _SlowMessages(delay=30)
    started = time.monotonic()
    with pytest.raises(ProviderError) as error:
        await _provider(messages).analyze(system_prompt="s", user_message="u", images=[])
    elapsed = time.monotonic() - started
    assert error.value.code == "TIMEOUT" and error.value.retryable is True
    assert 1.0 <= elapsed < 2.4
    deadline.set_deadline_from_header(None)


async def test_configured_cap_applies_without_a_header() -> None:
    deadline.set_deadline_from_header(None)
    with pytest.raises(ProviderError) as error:
        await _provider(_SlowMessages(delay=30), deadline_seconds=1.0).generate(
            system_prompt="s", user_message="u", output_type=ModelAnalysis
        )
    assert error.value.code == "TIMEOUT"


def test_deadline_header_is_validated() -> None:
    for bad in ["abc", "-5", "0", "999999999", ""]:
        deadline.set_deadline_from_header(bad)
        assert deadline.provider_budget(42.0) == 42.0
    deadline.set_deadline_from_header("100")  # nearly expired: floor, not negative
    assert deadline.provider_budget(42.0) == deadline.MIN_BUDGET_SECONDS
    deadline.set_deadline_from_header(None)


async def test_rate_limits_have_their_own_retryable_code() -> None:
    request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    error = anthropic.RateLimitError(
        "slow down", response=httpx.Response(429, request=request), body=None
    )
    with pytest.raises(ProviderError) as raised:
        await _provider(_SlowMessages(error=error)).generate(
            system_prompt="s", user_message="u", output_type=ModelAnalysis
        )
    assert raised.value.code == "RATE_LIMITED" and raised.value.retryable is True


async def test_provider_client_is_reused_and_closed() -> None:
    settings = Settings(LLM_PROVIDER="anthropic", LLM_API_KEY="k" * 40, LLM_MODEL="claude-test")
    first = factory.build_provider(settings)
    second = factory.build_provider(settings)
    assert first is second
    fake = _FakeClient(_SlowMessages())
    first._client = fake  # type: ignore[attr-defined]
    await factory.close_providers()
    assert fake.closed
    assert factory.build_provider(settings) is not first


def test_malformed_documents_are_skipped_not_fatal(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(*_: object, **__: object) -> object:
        raise RecursionError("pathological PDF")

    monkeypatch.setattr(verification_service, "extract", boom)

    class _Doc:
        ref = "D1"
        file_base64 = base64.b64encode(b"%PDF-1.4 broken").decode()

    class _Request:
        documents = [_Doc()]

    assert verification_service.read_documents(_Request()) == {}  # type: ignore[arg-type]
