import { canTransitionAllocation } from '@samadhaan/shared';
import { describe, expect, it } from 'vitest';
import { ineligibility } from './allocations.service.js';

const org = (overrides: Partial<Parameters<typeof ineligibility>[0]> = {}) => ({
  type: 'NGO',
  isActive: true,
  deletedAt: null,
  verificationStatus: 'VERIFIED',
  ...overrides,
});

describe('ineligibility', () => {
  it('accepts an active, verified NGO, university or industry organisation', () => {
    for (const type of ['NGO', 'UNIVERSITY', 'INDUSTRY']) {
      expect(ineligibility(org({ type }))).toBeNull();
    }
  });

  it.each([
    [{ verificationStatus: 'PENDING' }, 'NOT_VERIFIED'],
    [{ verificationStatus: 'UNVERIFIED' }, 'NOT_VERIFIED'],
    [{ verificationStatus: 'SUSPENDED' }, 'SUSPENDED'],
    [{ verificationStatus: 'REJECTED' }, 'REJECTED'],
    [{ isActive: false }, 'INACTIVE'],
    [{ deletedAt: new Date() }, 'INACTIVE'],
    [{ type: 'GOVERNMENT' }, 'INACTIVE'],
  ])('refuses %o as %s', (overrides, expected) => {
    expect(ineligibility(org(overrides))).toBe(expected);
  });
});

describe('allocation state machine', () => {
  it('moves only out of PENDING, to one of three ends', () => {
    expect(canTransitionAllocation('PENDING', 'ACCEPTED')).toBe(true);
    expect(canTransitionAllocation('PENDING', 'DECLINED')).toBe(true);
    expect(canTransitionAllocation('PENDING', 'CANCELLED')).toBe(true);
    expect(canTransitionAllocation('PENDING', 'EXPIRED')).toBe(false);
    for (const from of ['ACCEPTED', 'DECLINED', 'CANCELLED', 'EXPIRED'] as const) {
      for (const to of ['PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED'] as const) {
        expect(canTransitionAllocation(from, to)).toBe(false);
      }
    }
  });
});
