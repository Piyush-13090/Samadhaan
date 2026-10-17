import type { HighlightSegment, SearchHighlight } from '@samadhaan/shared';

/**
 * Safe highlighting (Prompt 25). Returns text segments flagged `match`, never
 * HTML: the client renders `<mark>` around matched segments as React text, so
 * nothing in a title or description can become markup.
 *
 * Terms match case-insensitively at word starts, and a term matches the
 * front of a longer word ("drain" marks "drainage"), as stemming would.
 */

const MIN_TERM = 2;

export function searchTerms(text: string): string[] {
  const terms = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= MIN_TERM);
  // A crude stem so "drains" also finds "drainage" and "drain".
  return [
    ...new Set(terms.map((t) => (t.length > 4 && t.endsWith('s') ? t.slice(0, -1) : t))),
  ].slice(0, 12);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function highlight(text: string, terms: string[]): HighlightSegment[] {
  if (!text) return [];
  if (terms.length === 0) return [{ text, match: false }];
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])(${terms.map(escape).join('|')})[\\p{L}\\p{N}]*`,
    'giu',
  );
  const segments: HighlightSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    const start = m.index ?? 0;
    if (start > last) segments.push({ text: text.slice(last, start), match: false });
    segments.push({ text: m[0], match: true });
    last = start + m[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last), match: false });
  return segments;
}

/** A ≤ `width`-character window around the first match, with ellipses. */
export function excerpt(text: string, terms: string[], width = 180): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= width) return clean;
  const lower = clean.toLowerCase();
  const hits = terms
    .map((t) => lower.search(new RegExp(`(?<![\\p{L}\\p{N}])${escape(t)}`, 'u')))
    .filter((i) => i >= 0);
  const first = hits.length ? Math.min(...hits) : 0;
  const start = Math.max(
    0,
    Math.min(first - Math.floor(width / 3), clean.length - width),
  );
  const end = Math.min(clean.length, start + width);
  return `${start > 0 ? '…' : ''}${clean.slice(start, end).trim()}${end < clean.length ? '…' : ''}`;
}

export function hasMatch(segments: HighlightSegment[]): boolean {
  return segments.some((s) => s.match);
}

/** Highlights for the fields that matched; the title is always returned. */
export function highlightFields(
  fields: Array<{ field: string; text: string | null; excerpt?: boolean }>,
  terms: string[],
): SearchHighlight[] {
  const out: SearchHighlight[] = [];
  for (const { field, text, excerpt: shorten } of fields) {
    if (!text) continue;
    const segments = highlight(shorten ? excerpt(text, terms) : text, terms);
    if (field === 'title' || hasMatch(segments)) out.push({ field, segments });
  }
  return out;
}
