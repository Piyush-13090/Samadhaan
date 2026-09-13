import { describe, expect, it } from 'vitest';
import {
  buildProblemImageKey,
  extensionForContentType,
  isSafeStorageKey,
} from './storage-key.js';

describe('buildProblemImageKey', () => {
  it('produces a date-partitioned key with a random name', () => {
    const key = buildProblemImageKey('image/jpeg', new Date('2026-09-13T00:00:00Z'));

    expect(key).toMatch(/^problems\/2026\/09\/[0-9a-f]{32}\.jpg$/);
  });

  it('derives the extension from the detected type, not the filename', () => {
    expect(buildProblemImageKey('image/png')).toMatch(/\.png$/);
    expect(buildProblemImageKey('image/webp')).toMatch(/\.webp$/);
  });

  it('never repeats a key', () => {
    const keys = new Set(
      Array.from({ length: 200 }, () => buildProblemImageKey('image/jpeg')),
    );

    expect(keys.size).toBe(200);
  });

  // The extension must never be attacker-controlled.
  it('refuses a content type outside the allow-list', () => {
    expect(() => buildProblemImageKey('image/svg+xml')).toThrow();
    expect(() => buildProblemImageKey('application/x-php')).toThrow();
    expect(() => buildProblemImageKey('text/html')).toThrow();
  });

  it('maps only the supported types', () => {
    expect(extensionForContentType('image/jpeg')).toBe('jpg');
    expect(extensionForContentType('image/gif')).toBeNull();
  });
});

describe('isSafeStorageKey', () => {
  it('accepts keys this application generates', () => {
    expect(isSafeStorageKey('problems/2026/09/abc123.jpg')).toBe(true);
    expect(isSafeStorageKey('problems/2026/09/a-b_c.webp')).toBe(true);
  });

  // Every one of these is a path-traversal attempt.
  it('rejects directory traversal', () => {
    expect(isSafeStorageKey('../../../etc/passwd')).toBe(false);
    expect(isSafeStorageKey('problems/../../../etc/passwd')).toBe(false);
    expect(isSafeStorageKey('problems/./secret.jpg')).toBe(false);
    expect(isSafeStorageKey('..')).toBe(false);
  });

  it('rejects absolute paths and Windows separators', () => {
    expect(isSafeStorageKey('/etc/passwd')).toBe(false);
    expect(isSafeStorageKey('problems\\..\\secret')).toBe(false);
  });

  // A NUL byte can truncate a path in a lower-level API.
  it('rejects NUL bytes', () => {
    expect(isSafeStorageKey('problems/a.jpg\0.php')).toBe(false);
  });

  it('rejects characters outside the allow-list', () => {
    expect(isSafeStorageKey('problems/a b.jpg')).toBe(false);
    expect(isSafeStorageKey('problems/a;rm -rf.jpg')).toBe(false);
    expect(isSafeStorageKey('problems/<script>.jpg')).toBe(false);
  });

  it('rejects empty and absurdly long keys', () => {
    expect(isSafeStorageKey('')).toBe(false);
    expect(isSafeStorageKey('a'.repeat(600))).toBe(false);
  });
});
