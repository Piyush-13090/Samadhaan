import { randomBytes } from 'node:crypto';

/**
 * Server-generated storage keys.
 *
 * **The client's filename is never part of the path.** A user-supplied name
 * invites path traversal (`../../etc/passwd`), collisions between two people
 * uploading `photo.jpg`, and leaking whatever the filename discloses about its
 * author. The original name is kept as *metadata* on the database row, where it
 * is displayed but never resolved as a path.
 *
 * Keys are date-prefixed so a bucket stays browsable and lifecycle rules can
 * target a period, and the random component is 128 bits — enough that a key
 * cannot be guessed by someone who knows the scheme.
 */

/** Extensions we are willing to write, keyed by the *detected* content type. */
const EXTENSION_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export function extensionForContentType(contentType: string): string | null {
  return EXTENSION_BY_TYPE[contentType] ?? null;
}

/**
 * Builds a key of the form `problems/2026/09/<32 hex>.jpg`.
 *
 * `contentType` must be the type detected from the file's own bytes, not the
 * one the client claimed — otherwise the extension is attacker-controlled.
 */
export function buildProblemImageKey(contentType: string, now = new Date()): string {
  const extension = extensionForContentType(contentType);
  if (!extension) {
    throw new Error(`Refusing to build a storage key for ${contentType}`);
  }

  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');

  return `problems/${year}/${month}/${randomBytes(16).toString('hex')}.${extension}`;
}

/**
 * Rejects anything that is not a key this application generated.
 *
 * Defence in depth for the local driver, which resolves keys against a
 * directory: a key containing `..`, a leading slash, a backslash or a NUL byte
 * must never reach `path.join`. Checked on every read and write rather than
 * only at creation, because a key also arrives from the client at problem
 * creation time.
 */
export function isSafeStorageKey(key: string): boolean {
  if (key.length === 0 || key.length > 512) return false;
  if (key.startsWith('/') || key.includes('\\')) return false;
  if (key.includes('\0')) return false;

  // Explicit `..` check as well as the character allow-list below: clearer
  // about what is being prevented, and survives the pattern being relaxed.
  if (key.split('/').some((segment) => segment === '..' || segment === '.')) return false;

  return /^[a-zA-Z0-9._/-]+$/.test(key);
}
