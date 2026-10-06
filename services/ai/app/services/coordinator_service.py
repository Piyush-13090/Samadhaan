"""AI Project Coordinator orchestration (Prompt 19).

Builds the prompt from NestJS's structured context, asks the provider for a
constrained ``CoordinatorModelOutput``, then **validates it against the
context** before returning anything:

* every finding must cite refs that exist in the request — otherwise dropped;
* a question's ``target_ref`` must be a real task or milestone;
* questions that repeat an open one are dropped;
* health is never below the deterministic baseline, and may rise above it by
  at most one level, and only with cited evidence from messages, updates or
  events.

The development provider runs no model; for it the caller's deterministic
result (``deterministic_insight``) is used — assembled from the same signals,
never invented.
"""

from __future__ import annotations

import re

from app.core.logging import get_logger
from app.prompts.project_coordinator import (
    EXTRACT_PROMPT_VERSION,
    EXTRACT_SYSTEM_PROMPT,
    PROMPT_VERSION,
    SYSTEM_PROMPT,
    build_extract_message,
    build_user_message,
)
from app.providers.base import VisionLanguageProvider
from app.schemas.coordinator import (
    HEALTH_ORDER,
    CoordinatorModelOutput,
    CoordinatorRequest,
    CoordinatorResult,
    ExtractedUpdate,
    ExtractUpdateRequest,
    ExtractUpdateResult,
    ModelBlocker,
    ModelQuestion,
    ModelRisk,
    ModelSuggestion,
)
from app.utils.timing import measure

logger = get_logger(__name__)

_HEALTH_BY_ORDER = {v: k for k, v in HEALTH_ORDER.items()}
_EVIDENCE_PREFIXES = ("message:", "update:", "event:", "question:")
_WORD = re.compile(r"[a-z0-9]+")
_STOP = {
    "the",
    "a",
    "an",
    "and",
    "or",
    "of",
    "to",
    "in",
    "on",
    "for",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "it",
    "this",
    "that",
    "with",
    "at",
    "by",
    "from",
    "has",
    "have",
    "had",
    "we",
    "our",
    "will",
    "not",
    "no",
    "yet",
    "as",
    "so",
    "up",
}


def _words(text: str) -> set[str]:
    """Content-word stems: the first five letters, so "materials", "material"
    and "ordered"/"ordering" match without a stemming dependency."""
    return {w[:5] for w in _WORD.findall(text.lower()) if w not in _STOP and len(w) > 2}


def similar(a: str, b: str, threshold: float = 0.6) -> bool:
    """Token-overlap similarity, for spotting a repeated question."""
    wa, wb = _words(a), _words(b)
    if not wa or not wb:
        return False
    return len(wa & wb) / len(wa | wb) >= threshold


class CoordinatorService:
    def __init__(self, provider: VisionLanguageProvider) -> None:
        self._provider = provider

    # ------------------------------------------------------------ analysis

    async def analyze(self, request: CoordinatorRequest) -> CoordinatorResult:
        info = self._provider.info
        with measure() as elapsed:
            raw = await self._provider.generate(
                system_prompt=SYSTEM_PROMPT,
                user_message=build_user_message(request),
                output_type=CoordinatorModelOutput,
                development_fallback=lambda: deterministic_insight(request),
                max_tokens=3000,
            )
        result, dropped = validate_insight(raw, request)
        logger.info(
            "coordinator_completed",
            project_id=request.project_id,
            provider=info.provider,
            health=result.health,
            dropped=dropped,
        )
        return CoordinatorResult(
            **result.model_dump(),
            provider=info.provider,
            model_name=info.model_name,
            model_version=info.model_version,
            prompt_version=PROMPT_VERSION,
            processing_ms=int(elapsed.milliseconds),
            dropped_items=dropped,
        )

    # ----------------------------------------------------------- extraction

    async def extract_update(self, request: ExtractUpdateRequest) -> ExtractUpdateResult:
        info = self._provider.info
        raw = await self._provider.generate(
            system_prompt=EXTRACT_SYSTEM_PROMPT,
            user_message=build_extract_message(request.text, request.project_name),
            output_type=ExtractedUpdate,
            development_fallback=lambda: deterministic_extract(request.text),
            max_tokens=1200,
        )
        grounded, dropped = ground_update(raw, request.text)
        return ExtractUpdateResult(
            **grounded.model_dump(),
            provider=info.provider,
            model_name=info.model_name,
            model_version=info.model_version,
            prompt_version=EXTRACT_PROMPT_VERSION,
            dropped_items=dropped,
        )


# ------------------------------------------------------------- validation


def validate_insight(
    output: CoordinatorModelOutput, request: CoordinatorRequest
) -> tuple[CoordinatorModelOutput, int]:
    """Keeps only findings grounded in the request. Returns (clean, dropped)."""
    known = request.refs()
    targets = {t.ref for t in request.tasks} | {m.ref for m in request.milestones}
    dropped = 0

    def cited(refs: list[str]) -> list[str]:
        return [r for r in dict.fromkeys(refs) if r in known]

    risks: list[ModelRisk] = []
    for risk in output.risks:
        refs = cited(risk.source_refs)
        if not refs:
            dropped += 1
            continue
        risks.append(risk.model_copy(update={"source_refs": refs}))

    blockers: list[ModelBlocker] = []
    for blocker in output.potential_blockers:
        refs = cited(blocker.source_refs)
        if not refs:
            dropped += 1
            continue
        blockers.append(blocker.model_copy(update={"source_refs": refs}))

    suggestions: list[ModelSuggestion] = []
    for suggestion in output.suggestions:
        refs = cited(suggestion.source_refs)
        if not refs:
            dropped += 1
            continue
        suggestions.append(suggestion.model_copy(update={"source_refs": refs}))

    questions: list[ModelQuestion] = []
    asked = [q.question for q in request.open_questions] + [
        q.question for q in request.answered_questions
    ]
    for question in output.questions:
        refs = cited(question.source_refs)
        target = question.target_ref if question.target_ref in targets else None
        if target and target not in refs:
            refs.append(target)
        repeated = any(similar(question.question, previous) for previous in asked)
        if not refs or repeated:
            dropped += 1
            continue
        asked.append(question.question)
        questions.append(question.model_copy(update={"source_refs": refs, "target_ref": target}))

    # Health: never below the baseline; at most one level above it, and only
    # with evidence the signals do not carry.
    baseline = HEALTH_ORDER[request.baseline.health]
    proposed = HEALTH_ORDER[output.health]
    evidence = any(
        ref.startswith(_EVIDENCE_PREFIXES)
        for item in (*risks, *blockers)
        for ref in item.source_refs
    )
    final = baseline
    if proposed > baseline and evidence:
        final = min(proposed, baseline + 1)
    health = _HEALTH_BY_ORDER[final]
    reason = (
        output.health_reason.strip()
        if final == proposed and output.health_reason.strip()
        else "; ".join(request.baseline.reasons) or "No warning signals in the project data."
    )

    summary = output.summary.strip() or "This could not be determined from the project data."
    return (
        CoordinatorModelOutput(
            summary=summary,
            health=health,  # type: ignore[arg-type]
            health_reason=reason[:600],
            risks=risks,
            potential_blockers=blockers,
            suggestions=suggestions,
            questions=questions[:3],
        ),
        dropped,
    )


def ground_update(update: ExtractedUpdate, text: str) -> tuple[ExtractedUpdate, int]:
    """Drops extracted items that share no meaningful word with the source."""
    source = _words(text)
    dropped = 0

    def keep(items: list[str]) -> list[str]:
        nonlocal dropped
        kept = []
        for item in items:
            item = item.strip()
            if item and _words(item) & source:
                kept.append(item[:200])
            elif item:
                dropped += 1
        return kept

    return (
        ExtractedUpdate(
            summary=update.summary.strip()[:400] or "Progress update",
            completed=keep(update.completed),
            current=keep(update.current),
            blockers=keep(update.blockers),
            next_steps=keep(update.next_steps),
        ),
        dropped,
    )


# ------------------------------------------- deterministic (development)

_RISK_TYPE = {
    "OVERDUE_TASK": "OVERDUE_TASK",
    "BLOCKED_TASK": "BLOCKED_TASK",
    "MILESTONE_OVERDUE": "MILESTONE_DELAY",
    "DEADLINE_APPROACHING": "UPCOMING_DEADLINE",
    "TARGET_DATE_PASSED": "INSUFFICIENT_PROGRESS",
    "INACTIVITY": "MISSING_UPDATE",
}
_BLOCKER_WORDS = (
    "cannot",
    "can't",
    "unable",
    "waiting for",
    "pending",
    "not issued",
    "not available",
    "unavailable",
    "blocked",
    "stuck",
    "no permit",
    "awaiting",
)


def deterministic_insight(request: CoordinatorRequest) -> CoordinatorModelOutput:
    """The development provider's output: the signals, restated. No model ran."""
    tasks = {t.ref: t for t in request.tasks}
    milestones = {m.ref: m for m in request.milestones}
    risks: list[ModelRisk] = []
    questions: list[ModelQuestion] = []
    suggestions: list[ModelSuggestion] = []

    for signal in request.signals:
        refs = [signal.ref] + ([signal.source_ref] if signal.source_ref else [])
        risks.append(
            ModelRisk(
                type=_RISK_TYPE.get(signal.code, "OTHER"),  # type: ignore[arg-type]
                severity=signal.severity,
                title=signal.title[:160],
                description=signal.title[:600],
                source_refs=refs,
            )
        )
        task = tasks.get(signal.source_ref or "")
        milestone = milestones.get(signal.source_ref or "")
        if signal.code == "OVERDUE_TASK" and task:
            questions.append(
                ModelQuestion(
                    question=(
                        f"Was “{task.title}” completed? If not, what is preventing completion?"
                    ),
                    category="TASK_PROGRESS",
                    target_ref=task.ref,
                    source_refs=refs,
                )
            )
            suggestions.append(
                ModelSuggestion(
                    text=f"Ask for a status update on “{task.title}”.", source_refs=refs
                )
            )
        elif signal.code == "BLOCKED_TASK" and task:
            questions.append(
                ModelQuestion(
                    question=f"What is needed to unblock “{task.title}”?",
                    category="BLOCKER",
                    target_ref=task.ref,
                    source_refs=refs,
                )
            )
        elif signal.code == "MILESTONE_OVERDUE" and milestone:
            questions.append(
                ModelQuestion(
                    question=f"What remains before “{milestone.title}” can be completed?",
                    category="MILESTONE",
                    target_ref=milestone.ref,
                    source_refs=refs,
                )
            )
        elif signal.code == "DEADLINE_APPROACHING" and task:
            questions.append(
                ModelQuestion(
                    question=f"Is “{task.title}” on track for its due date ({task.due_date})?",
                    category="DEADLINE",
                    target_ref=task.ref,
                    source_refs=refs,
                )
            )
        elif signal.code == "INACTIVITY":
            questions.append(
                ModelQuestion(
                    question="What progress has been made since the last project update?",
                    category="MISSING_UPDATE",
                    source_refs=refs,
                )
            )

    blockers = [
        ModelBlocker(
            title="Possible blocker mentioned in a message",
            description=message.text[:300],
            source_refs=[message.ref],
        )
        for message in request.messages
        if any(word in message.text.lower() for word in _BLOCKER_WORDS)
    ][:3]

    reasons = "; ".join(request.baseline.reasons) or "no warning signals"
    summary = (
        f"Development provider — no AI model ran. {request.project.name} is "
        f"{request.baseline.health.replace('_', ' ').lower()} ({reasons}). "
        f"{request.project.task_progress}% of tasks are complete."
    )
    return CoordinatorModelOutput(
        summary=summary[:1200],
        health=request.baseline.health,
        health_reason=reasons[:600],
        risks=risks[:8],
        potential_blockers=blockers,
        suggestions=suggestions[:5],
        questions=questions[:4],
    )


_DONE = ("done", "completed", "finished", "complete", "inspected")
_NEXT = ("will ", "next", "tomorrow", "plan to", "going to", "on monday", "on friday", "next week")


def deterministic_extract(text: str) -> ExtractedUpdate:
    """Sentence-by-sentence keyword sorting. Development only; no model."""
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+|\n+", text) if s.strip()]
    completed, current, blockers, next_steps = [], [], [], []
    for sentence in sentences:
        lower = sentence.lower()
        clean = sentence.rstrip(".!")[:200]
        if any(word in lower for word in _BLOCKER_WORDS):
            blockers.append(clean)
        elif any(word in lower for word in _DONE):
            completed.append(clean)
        elif any(word in lower for word in _NEXT):
            next_steps.append(clean)
        else:
            current.append(clean)
    return ExtractedUpdate(
        summary=(sentences[0][:400] if sentences else "Progress update"),
        completed=completed[:8],
        current=current[:8],
        blockers=blockers[:8],
        next_steps=next_steps[:8],
    )
