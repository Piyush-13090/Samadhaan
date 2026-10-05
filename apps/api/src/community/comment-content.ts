import { COMMENT_BODY_MAX_LENGTH, COMMENT_BODY_MIN_LENGTH } from '@samadhaan/shared';

/**
 * Normalises a comment body before it is validated or stored.
 *
 * - Strips control characters other than newline and tab. They render as
 *   nothing, so a "comment" made of them would look empty while passing a
 *   length check — and some (bidi overrides) can make text display differently
 *   from what was written.
 * - Normalises line endings and trims each end.
 * - Collapses runs of blank lines to one, so a comment cannot push the rest of
 *   a thread off screen with whitespace.
 *
 * Deliberately **not** HTML escaping. Comments are stored as the text the
 * citizen wrote and rendered as a text node; escaping at write time would
 * double-escape on every render and corrupt an honest `<` or `&`. XSS is
 * prevented where markup could be introduced — at render, by React — not by
 * mangling the data.
 */
export function normalizeCommentBody(raw: string): string {
  return (
    raw
      .replace(/\r\n?/g, '\n')
      // C0 controls except \t (0x09) and \n (0x0A), DEL, C1 controls, and the
      // Unicode bidi overrides/isolates.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F‪-‮⁦-⁩]/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

/** Outcome of a content check. `reason` is safe to show the author. */
export type ContentDecision = { allowed: true } | { allowed: false; reason: string };

/**
 * The moderation extension point.
 *
 * Today this enforces only structural rules — length after normalisation —
 * because there is no moderation model or review queue yet, and inventing a
 * word filter would block legitimate civic speech ("the drain is full of
 * sh*t" is a real report) while missing real abuse.
 *
 * Every write path calls this one function, so a later milestone can add a
 * classifier, a link-spam heuristic or a hold-for-review state here without
 * touching the controllers or the service. A future `HELD` decision would sit
 * alongside `allowed`/`denied` and the comment would be stored hidden.
 */
export function checkCommentContent(body: string): ContentDecision {
  if (body.length < COMMENT_BODY_MIN_LENGTH) {
    return {
      allowed: false,
      reason: `Write at least ${COMMENT_BODY_MIN_LENGTH} characters.`,
    };
  }

  if (body.length > COMMENT_BODY_MAX_LENGTH) {
    return {
      allowed: false,
      reason: `Keep comments under ${COMMENT_BODY_MAX_LENGTH} characters.`,
    };
  }

  return { allowed: true };
}
