"""Paragraph- and heading-aware chunking (Prompt 20).

Not "every N characters". The text is cleaned, split into blocks at headings
and blank lines, and blocks are packed into chunks up to ``max_tokens``,
carrying the section heading and page they came from. A paragraph longer than
a chunk is split at sentence boundaries. Consecutive chunks of a section
overlap by about ``overlap_tokens`` so a fact straddling a boundary is still
retrievable whole.

Tokens are estimated (words × 1.3) — close enough to bound model context; the
exact tokenizer belongs to whichever model consumes the chunk.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from dataclasses import dataclass

from app.knowledge.extraction import ExtractedText

CHUNKER_VERSION = "paragraph-v1"

_HEADING_MD = re.compile(r"^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$")
_HEADING_NUMBERED = re.compile(r"^\s*((?:\d+\.)+\d*|[A-Z]\.|[IVX]+\.)\s+([A-Z][^.!?]{2,80})$")
_SENTENCE = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"'(])")
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def estimate_tokens(text: str) -> int:
    words = len(text.split())
    return max(1, round(words * 1.3)) if words else 0


def clean(text: str) -> str:
    """Normalises Unicode and whitespace; removes control characters."""
    text = unicodedata.normalize("NFKC", text)
    text = _CONTROL.sub("", text).replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t ]+", " ", text)
    # Re-join words hyphenated across PDF line breaks.
    text = re.sub(r"(\w)-\n(\w)", r"\1\2", text)
    lines = [line.strip() for line in text.split("\n")]
    text = "\n".join(lines)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _heading(line: str) -> str | None:
    match = _HEADING_MD.match(line)
    if match:
        return match.group(2).strip()
    match = _HEADING_NUMBERED.match(line)
    if match and len(line) <= 90:
        return line.strip()
    if 3 <= len(line) <= 70 and line.isupper() and any(c.isalpha() for c in line):
        return line.strip().title()
    return None


@dataclass(frozen=True)
class Block:
    text: str
    section: str | None
    page: int | None


@dataclass(frozen=True)
class Chunk:
    index: int
    content: str
    token_count: int
    section_title: str | None
    page_number: int | None
    content_hash: str


def _blocks(extracted: ExtractedText) -> list[Block]:
    blocks: list[Block] = []
    section: str | None = None
    for page in extracted.pages:
        for raw in re.split(r"\n\s*\n", clean(page.text)):
            paragraph = raw.strip()
            if not paragraph:
                continue
            first, _, rest = paragraph.partition("\n")
            heading = _heading(first)
            if heading:
                section = heading[:200]
                paragraph = rest.strip()
                if not paragraph:
                    continue
            blocks.append(
                Block(text=" ".join(paragraph.split("\n")), section=section, page=page.number)
            )
    return blocks


def _split_long(block: Block, max_tokens: int) -> list[Block]:
    if estimate_tokens(block.text) <= max_tokens:
        return [block]
    parts: list[Block] = []
    current: list[str] = []
    for sentence in _SENTENCE.split(block.text):
        # A single sentence longer than a chunk is cut by words.
        words = sentence.split()
        while estimate_tokens(" ".join(words)) > max_tokens:
            cut = max(1, int(max_tokens / 1.3))
            parts.append(Block(" ".join(words[:cut]), block.section, block.page))
            words = words[cut:]
        sentence = " ".join(words)
        if current and estimate_tokens(" ".join([*current, sentence])) > max_tokens:
            parts.append(Block(" ".join(current), block.section, block.page))
            current = []
        if sentence:
            current.append(sentence)
    if current:
        parts.append(Block(" ".join(current), block.section, block.page))
    return parts


def _tail(text: str, tokens: int) -> str:
    """The last ~``tokens`` worth of whole sentences, for overlap."""
    if tokens <= 0:
        return ""
    taken: list[str] = []
    for sentence in reversed(_SENTENCE.split(text)):
        if estimate_tokens(" ".join([sentence, *taken])) > tokens:
            break
        taken.insert(0, sentence)
    return " ".join(taken)


def chunk(
    extracted: ExtractedText,
    *,
    max_tokens: int = 350,
    overlap_tokens: int = 50,
    min_tokens: int = 20,
) -> list[Chunk]:
    blocks = [part for block in _blocks(extracted) for part in _split_long(block, max_tokens)]
    chunks: list[tuple[str, str | None, int | None]] = []
    buffer: list[str] = []
    section: str | None = None
    page: int | None = None

    def flush() -> None:
        if buffer:
            chunks.append((" \n".join(buffer).replace(" \n", "\n\n"), section, page))

    for block in blocks:
        new_section = block.section != section
        fits = estimate_tokens("\n\n".join([*buffer, block.text])) <= max_tokens
        if buffer and (new_section or not fits):
            flush()
            # Overlap only within a section: a new heading starts clean.
            carry = _tail(buffer[-1], overlap_tokens) if not new_section else ""
            buffer = [carry] if carry else []
            if buffer and estimate_tokens("\n\n".join([*buffer, block.text])) > max_tokens:
                buffer = []
        if not buffer:
            section, page = block.section, block.page
        buffer.append(block.text)
    flush()

    # Merge a too-small trailing chunk into its predecessor in the same section.
    merged: list[tuple[str, str | None, int | None]] = []
    for content, sec, pg in chunks:
        if (
            merged
            and estimate_tokens(content) < min_tokens
            and merged[-1][1] == sec
            and estimate_tokens(merged[-1][0] + content) <= max_tokens + min_tokens
        ):
            prev = merged.pop()
            merged.append((prev[0] + "\n\n" + content, sec, prev[2]))
        else:
            merged.append((content, sec, pg))

    return [
        Chunk(
            index=index,
            content=content,
            token_count=estimate_tokens(content),
            section_title=sec,
            page_number=pg,
            content_hash=hashlib.sha256(content.encode("utf-8")).hexdigest(),
        )
        for index, (content, sec, pg) in enumerate(merged)
        if content.strip()
    ]
