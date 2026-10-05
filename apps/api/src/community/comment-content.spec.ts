import { describe, expect, it } from 'vitest';
import { COMMENT_BODY_MAX_LENGTH } from '@samadhaan/shared';
import { checkCommentContent, normalizeCommentBody } from './comment-content.js';

describe('normalizeCommentBody', () => {
  it('trims and normalises line endings', () => {
    expect(normalizeCommentBody('  hello\r\nworld  ')).toBe('hello\nworld');
  });

  it('collapses runs of blank lines to one', () => {
    expect(normalizeCommentBody('a\n\n\n\n\nb')).toBe('a\n\nb');
  });

  it('strips invisible control and bidi characters but keeps tabs and newlines', () => {
    expect(normalizeCommentBody('a\u0000b‮c\td\ne')).toBe('abc\td\ne');
  });

  it('leaves markup alone — escaping is the renderer’s job', () => {
    expect(normalizeCommentBody('<b>x</b> & y')).toBe('<b>x</b> & y');
  });

  it('reduces a body of only invisible characters to nothing', () => {
    expect(normalizeCommentBody('\u0001\u0002  \n\t ')).toBe('');
  });
});

describe('checkCommentContent', () => {
  it('rejects bodies below the minimum', () => {
    expect(checkCommentContent('')).toMatchObject({ allowed: false });
    expect(checkCommentContent('k')).toMatchObject({ allowed: false });
  });

  it('accepts bodies at the bounds', () => {
    expect(checkCommentContent('ok')).toEqual({ allowed: true });
    expect(checkCommentContent('a'.repeat(COMMENT_BODY_MAX_LENGTH))).toEqual({
      allowed: true,
    });
  });

  it('rejects bodies over the maximum', () => {
    expect(checkCommentContent('a'.repeat(COMMENT_BODY_MAX_LENGTH + 1))).toMatchObject({
      allowed: false,
    });
  });
});
