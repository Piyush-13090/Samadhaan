import { describe, expect, it } from 'vitest';
import { hrefFor, sanitizeMetadata } from './notification-metadata.js';

describe('sanitizeMetadata', () => {
  it('keeps allow-listed, well-formed values', () => {
    expect(
      sanitizeMetadata({
        problemPublicId: 'SAM-1023',
        candidatePublicId: 'SAM-900',
        commentId: '6f1c2c3e-1b2a-4c5d-8e9f-0a1b2c3d4e5f',
        similarity: 0.91234,
        fromStatus: 'SUBMITTED',
        toStatus: 'IN_PROGRESS',
      }),
    ).toEqual({
      problemPublicId: 'SAM-1023',
      candidatePublicId: 'SAM-900',
      commentId: '6f1c2c3e-1b2a-4c5d-8e9f-0a1b2c3d4e5f',
      similarity: 0.912,
      fromStatus: 'SUBMITTED',
      toStatus: 'IN_PROGRESS',
    });
  });

  it('drops unknown keys and malformed values — metadata is untrusted', () => {
    expect(
      sanitizeMetadata({
        problemPublicId: 'javascript:alert(1)',
        candidatePublicId: '../../admin',
        commentId: '<script>',
        similarity: 7,
        toStatus: 'HACKED',
        email: 'someone@example.com',
        href: 'https://evil.example',
      }),
    ).toEqual({});
  });

  it('survives non-objects', () => {
    for (const raw of [null, undefined, 'x', 3, ['SAM-1']]) {
      expect(sanitizeMetadata(raw)).toEqual({});
    }
  });
});

describe('hrefFor', () => {
  it('builds in-app paths only', () => {
    expect(hrefFor('AI_ANALYSIS_COMPLETED', { problemPublicId: 'SAM-1' })).toBe(
      '/problems/SAM-1',
    );
    expect(hrefFor('COMMENT_REPLIED', { problemPublicId: 'SAM-1' })).toBe(
      '/problems/SAM-1#discussion',
    );
    expect(hrefFor('POSSIBLE_DUPLICATE_FOUND', { problemPublicId: 'SAM-1' })).toBe(
      '/problems/SAM-1#similar',
    );
  });

  it('never leaves a notification without a destination', () => {
    expect(hrefFor('PROBLEM_SUPPORTED', {})).toBe('/notifications');
    expect(hrefFor('ALLOCATION_REQUESTED', {})).toBe('/notifications');
  });

  it('sends an organisation to its allocation, an office to its review page', () => {
    const metadata = sanitizeMetadata({
      problemPublicId: 'SAM-1023',
      allocationId: '4b46f0d5-c1a9-44b1-9b31-1558b3770c69',
      organizationSlug: 'green-earth',
      governmentSlug: 'gurugram-mc',
    });
    expect(hrefFor('ALLOCATION_REQUESTED', metadata)).toBe(
      '/organization/green-earth/allocations/4b46f0d5-c1a9-44b1-9b31-1558b3770c69',
    );
    expect(hrefFor('ALLOCATION_CANCELLED', metadata)).toBe(
      '/organization/green-earth/allocations/4b46f0d5-c1a9-44b1-9b31-1558b3770c69',
    );
    expect(hrefFor('ALLOCATION_ACCEPTED', metadata)).toBe(
      '/government/gurugram-mc/problems/SAM-1023#allocation',
    );
  });

  it('drops allocation metadata that could build a hostile link', () => {
    expect(
      sanitizeMetadata({
        allocationId: '../../admin',
        organizationSlug: 'evil/../x',
        governmentSlug: 'https://evil.example',
      }),
    ).toEqual({});
  });
});
