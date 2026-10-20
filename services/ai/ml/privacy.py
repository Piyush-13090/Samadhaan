"""Dataset privacy controls (Prompt 28).

Two layers. Columns: a dataset may only contain the fields of its task schema
(`extra="forbid"`), and fields that are personal or confidential by name are
refused outright with a clear reason, so a careless export fails loudly
instead of being silently dropped. Text: identifiers inside free text are
redacted with the same function serving uses (`app/models/privacy.py`).
"""

from __future__ import annotations

from typing import Final

from app.models.privacy import redact_text

__all__ = ["FORBIDDEN_FIELDS", "forbidden_fields", "redact_text"]

#: Never acceptable in a training dataset: identity, contact, credentials,
#: precise location, and confidential workflow content (private government
#: notes, resolution-room messages, restricted documents).
FORBIDDEN_FIELDS: Final[frozenset[str]] = frozenset(
    {
        "email",
        "phone",
        "phone_number",
        "full_name",
        "display_name",
        "reporter_id",
        "reporter_name",
        "reporter_email",
        "user_id",
        "author_id",
        "ip_address",
        "user_agent",
        "password",
        "password_hash",
        "token",
        "access_token",
        "refresh_token",
        "latitude",
        "longitude",
        "address",
        "internal_note",
        "internal_notes",
        "resolution_message",
        "resolution_messages",
        "private_document",
        "restricted_document",
    }
)


def forbidden_fields(fields: set[str]) -> list[str]:
    return sorted(f for f in fields if f.strip().lower() in FORBIDDEN_FIELDS)
