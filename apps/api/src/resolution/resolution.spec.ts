import { describe, expect, it } from 'vitest';
import {
  detectAttachmentType,
  sanitizeFileName,
} from './resolution-attachments.service.js';
import {
  cleanBody,
  decodeMessageCursor,
  encodeMessageCursor,
} from './resolution-rooms.service.js';

describe('detectAttachmentType', () => {
  it('reads the type from the bytes', () => {
    expect(detectAttachmentType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(
      'image/jpeg',
    );
    expect(
      detectAttachmentType(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]),
      ),
    ).toBe('image/png');
    expect(detectAttachmentType(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(detectAttachmentType(Buffer.from('%PDF-1.7\n'))).toBe('application/pdf');
  });

  it('refuses everything else, whatever it is called', () => {
    for (const bytes of ['MZ\x90\x00', '<html><script>', '#!/bin/sh', 'PK\x03\x04', '']) {
      expect(detectAttachmentType(Buffer.from(bytes, 'latin1'))).toBeNull();
    }
  });
});

describe('sanitizeFileName', () => {
  it('drops paths and control characters, and bounds the length', () => {
    expect(sanitizeFileName('../../etc/passwd.png', 'image/png')).toBe('passwd.png');
    expect(sanitizeFileName('C:\\Users\\a\\report.pdf', 'application/pdf')).toBe(
      'report.pdf',
    );
    expect(sanitizeFileName('a\u0000b<c>.png', 'image/png')).toBe('abc.png');
    expect(sanitizeFileName('x'.repeat(300), 'image/png')).toHaveLength(120);
    expect(sanitizeFileName(undefined, 'application/pdf')).toBe('attachment.pdf');
  });
});

describe('message cursors', () => {
  it('round-trip (createdAt, id)', () => {
    const at = new Date('2026-10-06T10:42:00.123Z');
    const id = '4b46f0d5-c1a9-44b1-9b31-1558b3770c69';
    expect(decodeMessageCursor(encodeMessageCursor(at, id))).toEqual({
      createdAt: at,
      id,
    });
  });

  it('refuse anything else', () => {
    for (const bad of ['', 'bogus', Buffer.from('not-a-date|x').toString('base64url')]) {
      expect(() => decodeMessageCursor(bad)).toThrow();
    }
  });
});

describe('cleanBody', () => {
  it('keeps text and line breaks, drops control characters', () => {
    expect(cleanBody('  Line one\nLine two\u0007  ')).toBe('Line one\nLine two');
    expect(cleanBody('<b>not markup</b>')).toBe('<b>not markup</b>');
  });

  it('refuses an empty message', () => {
    expect(() => cleanBody(' \n\t ')).toThrow();
  });
});
