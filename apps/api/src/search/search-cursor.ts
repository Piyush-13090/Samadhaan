import { AppException } from '../common/app.exception.js';

/**
 * Opaque search cursors (Prompt 25).
 *
 * Two kinds:
 *  - `list`: a position in a ranked, bounded candidate list cached in Redis
 *    under `key`. Ranking happens once; later pages read the same order, so
 *    nothing repeats or disappears mid-scroll, and no deep OFFSET hits SQL.
 *  - `keyset`: (sort value, publicId) for browsing without query text, where
 *    SQL pages directly on the sort expression.
 */
export type SearchCursor =
  | { kind: 'list'; key: string; offset: number }
  | { kind: 'keyset'; value: number; id: string };

export function encodeSearchCursor(cursor: SearchCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeSearchCursor(raw: string | undefined): SearchCursor | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    if (
      value.kind === 'list' &&
      typeof value.key === 'string' &&
      /^search:list:v1:[0-9a-f]{64}$/.test(value.key) &&
      Number.isInteger(value.offset) &&
      (value.offset as number) >= 0 &&
      (value.offset as number) <= 5000
    ) {
      return { kind: 'list', key: value.key, offset: value.offset as number };
    }
    if (
      value.kind === 'keyset' &&
      typeof value.value === 'number' &&
      Number.isFinite(value.value) &&
      typeof value.id === 'string' &&
      /^[A-Z]{2,5}-\d{1,12}$/.test(value.id)
    ) {
      return { kind: 'keyset', value: value.value, id: value.id };
    }
  } catch {
    // fall through
  }
  throw AppException.badRequest('That page cursor is not valid.');
}
