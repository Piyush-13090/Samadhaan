import { AppException } from './app.exception.js';

/**
 * Opaque cursors over a row id, for lists paginated with Prisma's `cursor`.
 *
 * Base64url so the client treats it as a token rather than an id it might
 * edit, and validated on the way back in: Prisma's `cursor` needs a real UUID,
 * and anything else throws deep in the client with an unhelpful message.
 */
export function encodeIdCursor(id: string): string {
  return Buffer.from(id, 'utf8').toString('base64url');
}

export function decodeIdCursor(cursor: string): string {
  const id = Buffer.from(cursor, 'base64url').toString('utf8');

  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    throw AppException.badRequest('That page cursor is not valid.');
  }

  return id;
}
