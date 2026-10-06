"""Text extraction for knowledge documents.

Accepts plain text, Markdown, HTML and PDF — detected from the bytes where the
format has a signature, never trusted from the declared type alone. HTML is
reduced to its visible text: scripts, styles and markup never reach a chunk.
Anything else is refused.
"""

from __future__ import annotations

import io
from dataclasses import dataclass
from html.parser import HTMLParser

from app.providers.base import ProviderError

SUPPORTED_TYPES = ("text/plain", "text/markdown", "text/html", "application/pdf")


@dataclass(frozen=True)
class ExtractedPage:
    number: int | None
    text: str


@dataclass(frozen=True)
class ExtractedText:
    pages: list[ExtractedPage]
    page_count: int | None

    @property
    def text(self) -> str:
        return "\n\n".join(page.text for page in self.pages)


class _VisibleText(HTMLParser):
    """Collects visible text; drops script, style and similar elements."""

    _SKIP = {"script", "style", "noscript", "template", "iframe", "object", "svg", "head"}
    _BLOCK = {
        "p",
        "div",
        "br",
        "li",
        "tr",
        "section",
        "article",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
    }

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._skip_depth = 0
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in self._SKIP:
            self._skip_depth += 1
        elif tag in self._BLOCK:
            self.parts.append("\n\n")
            if tag.startswith("h") and len(tag) == 2:
                self.parts.append("#" * int(tag[1]) + " ")

    def handle_endtag(self, tag: str) -> None:
        if tag in self._SKIP and self._skip_depth > 0:
            self._skip_depth -= 1
        elif tag in self._BLOCK:
            self.parts.append("\n\n")

    def handle_data(self, data: str) -> None:
        if self._skip_depth == 0:
            self.parts.append(data)


def html_to_text(html: str) -> str:
    parser = _VisibleText()
    parser.feed(html)
    parser.close()
    return "".join(parser.parts)


def detect_type(data: bytes, declared: str | None) -> str:
    """The type from the bytes; the declaration only separates text dialects."""
    if data.startswith(b"%PDF-"):
        return "application/pdf"
    if b"\x00" in data[:4096]:
        raise ProviderError(
            "UNSUPPORTED_DOCUMENT", "That file type is not supported.", retryable=False
        )
    try:
        head = data[:2048].decode("utf-8").lstrip().lower()
    except UnicodeDecodeError as error:
        raise ProviderError(
            "UNSUPPORTED_DOCUMENT", "Text documents must be UTF-8.", retryable=False
        ) from error
    if declared == "text/html" or head.startswith(("<!doctype html", "<html")):
        return "text/html"
    if declared == "text/markdown":
        return "text/markdown"
    return "text/plain"


def extract(data: bytes, declared: str | None, max_pages: int = 500) -> ExtractedText:
    kind = detect_type(data, declared)
    if kind == "application/pdf":
        return _extract_pdf(data, max_pages)
    text = data.decode("utf-8", errors="strict")
    if kind == "text/html":
        text = html_to_text(text)
    return ExtractedText(pages=[ExtractedPage(number=None, text=text)], page_count=None)


def _extract_pdf(data: bytes, max_pages: int) -> ExtractedText:
    try:
        from pypdf import PdfReader
        from pypdf.errors import PdfReadError
    except ImportError as error:  # pragma: no cover - dependency is required
        raise ProviderError(
            "UNSUPPORTED_DOCUMENT", "PDF extraction is not available.", retryable=False
        ) from error
    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            raise ProviderError(
                "UNSUPPORTED_DOCUMENT", "Encrypted PDFs are not supported.", retryable=False
            )
        if len(reader.pages) > max_pages:
            raise ProviderError(
                "DOCUMENT_TOO_LARGE",
                f"PDFs are limited to {max_pages} pages.",
                retryable=False,
            )
        pages = [
            ExtractedPage(number=index + 1, text=page.extract_text() or "")
            for index, page in enumerate(reader.pages)
        ]
    except ProviderError:
        raise
    except (PdfReadError, ValueError, KeyError) as error:
        raise ProviderError(
            "MALFORMED_DOCUMENT", "That PDF could not be read.", retryable=False
        ) from error
    return ExtractedText(pages=pages, page_count=len(pages))
