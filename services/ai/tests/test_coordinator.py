"""AI Project Coordinator: validation, grounding, provider handling, endpoints."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.prompts.project_coordinator import PROMPT_VERSION, build_user_message
from app.providers.base import ProviderError, ProviderInfo, VisionLanguageProvider
from app.providers.development_provider import DevelopmentProvider
from app.schemas.coordinator import (
    CoordinatorModelOutput,
    CoordinatorRequest,
    ExtractedUpdate,
    ExtractUpdateRequest,
)
from app.services.coordinator_service import (
    CoordinatorService,
    deterministic_extract,
    ground_update,
    similar,
    validate_insight,
)

TASK = "task:11111111-1111-4111-8111-111111111111"
MILESTONE = "milestone:22222222-2222-4222-8222-222222222222"
MESSAGE = "message:33333333-3333-4333-8333-333333333333"


def make_request(**overrides) -> CoordinatorRequest:
    payload = {
        "project_id": "p1",
        "today": "2026-10-08",
        "problem": {
            "public_id": "SAM-1023",
            "title": "Large pothole causing traffic disruption",
            "description": "A deep pothole on the main road near Sector 48.",
            "category": "POTHOLES",
        },
        "project": {
            "name": "Resolve: Large pothole",
            "status": "ACTIVE",
            "task_progress": 25,
            "open_tasks": 3,
            "completed_tasks": 1,
            "cancelled_tasks": 0,
        },
        "tasks": [
            {
                "ref": TASK,
                "title": "Site inspection",
                "status": "IN_PROGRESS",
                "priority": "HIGH",
                "due_date": "2026-10-07",
                "overdue": True,
                "days_overdue": 1,
            }
        ],
        "milestones": [{"ref": MILESTONE, "title": "Repair planning", "status": "UPCOMING"}],
        "messages": [
            {
                "ref": MESSAGE,
                "side": "ORGANIZATION",
                "author": "Aarav",
                "days_ago": 1,
                "text": "We cannot start the repair because the road permit has not been issued.",
            }
        ],
        "signals": [
            {
                "ref": "signal:OVERDUE_TASK:1",
                "code": "OVERDUE_TASK",
                "severity": "HIGH",
                "title": "Site inspection is 1 day overdue",
                "source_ref": TASK,
            }
        ],
        "baseline": {"health": "NEEDS_ATTENTION", "reasons": ["1 task is overdue"]},
    }
    payload.update(overrides)
    return CoordinatorRequest(**payload)


def model_output(**overrides) -> CoordinatorModelOutput:
    payload = {
        "summary": "The site inspection is overdue and the repair permit is pending.",
        "health": "NEEDS_ATTENTION",
        "health_reason": "The site inspection is overdue.",
        "risks": [
            {
                "type": "OVERDUE_TASK",
                "severity": "HIGH",
                "title": "Site inspection overdue",
                "description": "Due 7 Oct.",
                "source_refs": [TASK],
            }
        ],
        "potential_blockers": [],
        "suggestions": [{"text": "Confirm the inspection result.", "source_refs": [TASK]}],
        "questions": [
            {
                "question": "Was the site inspection completed?",
                "category": "TASK_PROGRESS",
                "target_ref": TASK,
                "source_refs": [TASK],
            }
        ],
    }
    payload.update(overrides)
    return CoordinatorModelOutput(**payload)


class FakeProvider(VisionLanguageProvider):
    def __init__(self, output=None, error: Exception | None = None):
        self._output = output
        self._error = error
        self.calls: list[dict] = []

    @property
    def info(self) -> ProviderInfo:
        return ProviderInfo(provider="fake", model_name="fake-llm", model_version="2026-10")

    async def analyze(self, **kwargs):  # pragma: no cover - not used here
        raise NotImplementedError

    async def generate(
        self,
        *,
        system_prompt,
        user_message,
        output_type,
        development_fallback=None,
        max_tokens=2048,
    ):
        self.calls.append({"system": system_prompt, "user": user_message})
        if self._error:
            raise self._error
        return output_type.model_validate(self._output.model_dump())


# ------------------------------------------------------------- grounding


class TestValidation:
    def test_keeps_grounded_findings(self) -> None:
        clean, dropped = validate_insight(model_output(), make_request())
        assert dropped == 0
        assert clean.risks[0].source_refs == [TASK]
        assert clean.questions[0].target_ref == TASK

    def test_drops_findings_that_cite_nothing_real(self) -> None:
        output = model_output(
            risks=[
                {
                    "type": "OTHER",
                    "severity": "HIGH",
                    "title": "Government approval missing",
                    "description": "Invented.",
                    "source_refs": ["task:made-up", "permit:42"],
                }
            ],
            suggestions=[{"text": "Order asphalt.", "source_refs": []}],
        )
        clean, dropped = validate_insight(output, make_request())
        assert clean.risks == []
        assert clean.suggestions == []
        assert dropped == 2

    def test_never_lowers_health_below_the_baseline(self) -> None:
        clean, _ = validate_insight(model_output(health="HEALTHY"), make_request())
        assert clean.health == "NEEDS_ATTENTION"
        assert clean.health_reason == "1 task is overdue"

    def test_escalates_one_level_only_with_message_evidence(self) -> None:
        without = model_output(health="BLOCKED")
        clean, _ = validate_insight(without, make_request())
        assert clean.health == "NEEDS_ATTENTION"

        with_evidence = model_output(
            health="BLOCKED",
            potential_blockers=[
                {
                    "title": "Road permit not issued",
                    "description": "The team says repair cannot start without it.",
                    "source_refs": [MESSAGE],
                }
            ],
        )
        clean, _ = validate_insight(with_evidence, make_request())
        assert clean.health == "AT_RISK"  # one level, not two

    def test_drops_a_repeated_question(self) -> None:
        request = make_request(
            open_questions=[
                {
                    "ref": "question:q1",
                    "question": "Was the site inspection completed yet?",
                    "days_ago": 1,
                }
            ]
        )
        clean, dropped = validate_insight(model_output(), request)
        assert clean.questions == []
        assert dropped == 1

    def test_unknown_target_is_cleared(self) -> None:
        output = model_output(
            questions=[
                {
                    "question": "Any blockers on the next milestone?",
                    "category": "MILESTONE",
                    "target_ref": "milestone:nope",
                    "source_refs": [MILESTONE],
                }
            ]
        )
        clean, _ = validate_insight(output, make_request())
        assert clean.questions[0].target_ref is None

    def test_similarity(self) -> None:
        assert similar(
            "Was the site inspection completed?", "Has the site inspection been completed?"
        )
        assert not similar("Is the permit issued?", "Was the site inspection completed?")


# ---------------------------------------------------------------- service


class TestService:
    @pytest.mark.anyio
    async def test_records_model_and_prompt_version(self) -> None:
        provider = FakeProvider(model_output())
        result = await CoordinatorService(provider).analyze(make_request())
        assert result.model_name == "fake-llm"
        assert result.model_version == "2026-10"
        assert result.prompt_version == PROMPT_VERSION
        assert result.provider == "fake"
        # The prompt is built from the structured context, with refs.
        assert TASK in provider.calls[0]["user"]
        assert "Never invent" in provider.calls[0]["system"]

    @pytest.mark.anyio
    async def test_provider_failure_propagates(self) -> None:
        provider = FakeProvider(error=ProviderError("TIMEOUT", "slow", retryable=True))
        with pytest.raises(ProviderError):
            await CoordinatorService(provider).analyze(make_request())

    @pytest.mark.anyio
    async def test_development_provider_restates_signals_only(self) -> None:
        result = await CoordinatorService(DevelopmentProvider()).analyze(make_request())
        assert result.provider == "development"
        assert result.summary.startswith("Development provider — no AI model ran.")
        assert result.health == "NEEDS_ATTENTION"
        assert result.risks[0].source_refs[0] == "signal:OVERDUE_TASK:1"
        assert result.questions[0].target_ref == TASK
        # The permit message is flagged as a possible blocker, citing it.
        assert result.potential_blockers[0].source_refs == [MESSAGE]

    @pytest.mark.anyio
    async def test_development_provider_refuses_without_a_fallback(self) -> None:
        with pytest.raises(ProviderError):
            await DevelopmentProvider().generate(
                system_prompt="", user_message="", output_type=ExtractedUpdate
            )


class TestPrompt:
    def test_includes_sections_and_refs(self) -> None:
        message = build_user_message(make_request())
        for heading in (
            "PROBLEM:",
            "PROJECT:",
            "BASELINE HEALTH",
            "TASKS:",
            "RECENT ROOM MESSAGES",
        ):
            assert heading in message
        assert f"[{TASK}] Site inspection" in message


# ------------------------------------------------------------- extraction


class TestExtraction:
    def test_grounding_drops_invented_items(self) -> None:
        text = "Inspection is done. Materials are being ordered today."
        update = ExtractedUpdate(
            summary="Inspection done",
            completed=["Site inspection"],
            current=["Material ordering"],
            next_steps=["Government approval received"],  # not in the text
        )
        grounded, dropped = ground_update(update, text)
        assert grounded.completed == ["Site inspection"]
        assert grounded.next_steps == []
        assert dropped == 1

    def test_deterministic_extract(self) -> None:
        update = deterministic_extract(
            "Inspection is done. Materials are being ordered today. "
            "We cannot start until the permit is issued. We will begin repair on Friday."
        )
        assert update.completed == ["Inspection is done"]
        assert update.current == ["Materials are being ordered today"]
        assert update.blockers == ["We cannot start until the permit is issued"]
        assert update.next_steps == ["We will begin repair on Friday"]

    @pytest.mark.anyio
    async def test_extract_reports_versions(self) -> None:
        provider = FakeProvider(
            ExtractedUpdate(
                summary="Inspection done",
                completed=["inspection"],
                current=[],
                blockers=[],
                next_steps=[],
            )
        )
        result = await CoordinatorService(provider).extract_update(
            ExtractUpdateRequest(text="The inspection is done.")
        )
        assert result.completed == ["inspection"]
        assert result.prompt_version.startswith("update-extract")


# --------------------------------------------------------------- endpoint


class TestEndpoints:
    def test_analyze_with_development_provider(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("LLM_PROVIDER", "development")
        from app.core.config import get_settings

        get_settings.cache_clear()
        response = client.post("/coordinator/analyze", json=make_request().model_dump())
        get_settings.cache_clear()
        assert response.status_code == 200
        body = response.json()
        assert body["provider"] == "development"
        assert body["health"] == "NEEDS_ATTENTION"
        assert "chain" not in str(body).lower()

    def test_rejects_malformed_context(self, client: TestClient) -> None:
        response = client.post("/coordinator/analyze", json={"project_id": "x"})
        assert response.status_code == 422

    def test_rejects_unknown_fields(self, client: TestClient) -> None:
        payload = make_request().model_dump()
        payload["database_url"] = "postgres://secret"
        assert client.post("/coordinator/analyze", json=payload).status_code == 422

    def test_unconfigured_provider_is_503(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("LLM_PROVIDER", "anthropic")
        monkeypatch.delenv("LLM_API_KEY", raising=False)
        from app.core.config import get_settings

        get_settings.cache_clear()
        response = client.post("/coordinator/extract-update", json={"text": "Inspection done."})
        get_settings.cache_clear()
        assert response.status_code == 503
