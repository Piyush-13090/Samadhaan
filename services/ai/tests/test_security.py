"""Internal-token guard behaviour."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.core.config import Settings, get_settings
from app.core.security import require_internal_token


@pytest.fixture(autouse=True)
def _clear_settings_cache():
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _use_settings(monkeypatch: pytest.MonkeyPatch, token: str | None) -> None:
    monkeypatch.setattr(
        "app.core.security.get_settings",
        lambda: Settings(AI_INTERNAL_TOKEN=token),
    )


async def test_allows_any_request_when_no_token_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _use_settings(monkeypatch, None)

    assert await require_internal_token(None) is None


async def test_rejects_missing_token_when_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _use_settings(monkeypatch, "secret")

    with pytest.raises(HTTPException) as raised:
        await require_internal_token(None)

    assert raised.value.status_code == 401


async def test_accepts_matching_token(monkeypatch: pytest.MonkeyPatch) -> None:
    _use_settings(monkeypatch, "secret")

    assert await require_internal_token("secret") is None
