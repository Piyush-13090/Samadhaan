import { describe, expect, it } from 'vitest';
import { hrefFor } from '../notifications/notification-metadata.js';
import { planNotifications } from '../notifications/notification-planner.js';
import {
  attributeResolution,
  type ResolutionInput,
} from './contribution-attribution.service.js';
import {
  BADGES,
  CURRENT_RULES,
  POINT_RULES_V1,
  TIERS,
  earnedBadges,
  idempotencyKey,
  nextTier,
  reputationScore,
  smoothed,
  tierFor,
  type ReputationSignals,
} from './impact-rules.js';

describe('point rules', () => {
  it('are versioned, and reward outcomes rather than activity', () => {
    expect(CURRENT_RULES).toBe(POINT_RULES_V1);
    expect(CURRENT_RULES.version).toBe('POINT_RULES_V1');
    expect(CURRENT_RULES.points.PROBLEM_REPORTED).toBe(0);
    expect(CURRENT_RULES.points.PROBLEM_VERIFIED).toBe(20);
    expect(CURRENT_RULES.points.PROBLEM_RESOLVED_REPORTER).toBe(30);
  });

  it('builds one idempotency key per user and event, independent of the rule version', () => {
    expect(idempotencyKey('PROBLEM_VERIFIED', 'p1', 'u1')).toBe('PROBLEM_VERIFIED:p1:u1');
    expect(idempotencyKey('PROBLEM_RESOLVED', 'p1', 'u1', 'reporter')).toBe(
      'PROBLEM_RESOLVED:p1:u1:reporter',
    );
    expect(idempotencyKey('PROBLEM_VERIFIED', 'p1', 'u1')).not.toContain(
      CURRENT_RULES.version,
    );
  });
});

describe('tiers', () => {
  it('need points and, higher up, reputation', () => {
    expect(tierFor(0, 90)).toBe('NEW_CONTRIBUTOR');
    expect(tierFor(100, 10)).toBe('ACTIVE_CONTRIBUTOR');
    expect(tierFor(400, 50)).toBe('ACTIVE_CONTRIBUTOR'); // volume without quality
    expect(tierFor(400, 60)).toBe('TRUSTED_CONTRIBUTOR');
    expect(tierFor(2000, 70)).toBe('CIVIC_CHAMPION');
    expect(tierFor(2000, 80)).toBe('CIVIC_LEADER');
  });

  it('are ordered and say what comes next', () => {
    for (let i = 1; i < TIERS.length; i += 1)
      expect(TIERS[i]!.minPoints).toBeGreaterThan(TIERS[i - 1]!.minPoints);
    expect(nextTier('ACTIVE_CONTRIBUTOR')?.tier).toBe('TRUSTED_CONTRIBUTOR');
    expect(nextTier('CIVIC_LEADER')).toBeNull();
  });
});

describe('reputation', () => {
  const base: ReputationSignals = {
    verifiedReports: 0,
    rejectedReports: 0,
    approvedEvidence: 0,
    rejectedEvidence: 0,
    resolvedContributions: 0,
    activeMonths: 0,
  };

  it('stays within 0–100 and starts near the middle', () => {
    const fresh = reputationScore(base);
    expect(fresh).toBeGreaterThan(30);
    expect(fresh).toBeLessThan(50);
    const best = reputationScore({
      ...base,
      verifiedReports: 500,
      approvedEvidence: 500,
      resolvedContributions: 500,
      activeMonths: 12,
    });
    expect(best).toBeLessThanOrEqual(100);
    expect(
      reputationScore({ ...base, rejectedReports: 500, rejectedEvidence: 500 }),
    ).toBeGreaterThanOrEqual(0);
  });

  it('does not swing on one event', () => {
    const before = reputationScore({ ...base, verifiedReports: 1 });
    expect(
      Math.abs(
        reputationScore({ ...base, verifiedReports: 1, rejectedReports: 1 }) - before,
      ),
    ).toBeLessThan(10);
    expect(
      Math.abs(reputationScore({ ...base, verifiedReports: 2 }) - before),
    ).toBeLessThan(10);
  });

  it('ranks a few reliable contributions above many rejected ones', () => {
    const reliable = reputationScore({
      ...base,
      verifiedReports: 5,
      resolvedContributions: 2,
      activeMonths: 3,
    });
    const spammy = reputationScore({
      ...base,
      verifiedReports: 10,
      rejectedReports: 40,
      resolvedContributions: 2,
      activeMonths: 3,
    });
    expect(reliable).toBeGreaterThan(spammy + 15);
  });

  it('smooths rates with a prior', () => {
    expect(smoothed(0, 0, 0.6, 3)).toBeCloseTo(0.6);
    expect(smoothed(1, 0, 0.6, 3)).toBeCloseTo(0.7);
  });
});

describe('badges', () => {
  const input = {
    counts: {},
    impactPoints: 0,
    resolvedContributions: 0,
    tier: 'NEW_CONTRIBUTOR' as const,
  };

  it('are earned through real conditions only', () => {
    expect(earnedBadges(input)).toEqual([]);
    expect(earnedBadges({ ...input, counts: { PROBLEM_VERIFIED: 1 } })).toEqual([
      'FIRST_REPORT',
    ]);
    expect(
      earnedBadges({ ...input, counts: { USEFUL_COMMENT: 2, PROBLEM_SUPPORTED: 1 } }),
    ).toContain('COMMUNITY_HELPER');
    expect(earnedBadges({ ...input, impactPoints: 100 })).toContain('CIVIC_CONTRIBUTOR');
    expect(earnedBadges({ ...input, resolvedContributions: 5 })).toContain(
      'RESOLUTION_CHAMPION',
    );
    expect(earnedBadges({ ...input, tier: 'CIVIC_LEADER' })).toContain('CIVIC_CHAMPION');
    expect(BADGES.map((b) => b.key)).toHaveLength(new Set(BADGES.map((b) => b.key)).size);
  });
});

describe('contribution attribution', () => {
  const input = (overrides: Partial<ResolutionInput> = {}): ResolutionInput => ({
    problem: { id: 'p', publicId: 'SAM-1', reporterId: 'reporter' },
    duplicateReporters: [
      { problemId: 'd1', reporterId: 'dup' },
      { problemId: 'd2', reporterId: 'dup' },
      { problemId: 'd3', reporterId: 'reporter' },
    ],
    community: [
      { userId: 'early-commenter', commented: true },
      { userId: 'supporter', commented: false },
      { userId: 'reporter', commented: true },
      { userId: 'member', commented: true },
    ],
    projectMembers: new Set(['member', 'manager']),
    project: {
      id: 'proj',
      tasks: [
        { id: 't1', completedById: 'member' },
        { id: 't2', completedById: 'member' },
        { id: 't3', completedById: 'member' },
        { id: 't4', completedById: 'member' },
        { id: 't5', completedById: 'outsider' },
        { id: 't6', completedById: null },
      ],
      milestones: [{ id: 'm1', completedById: 'manager' }],
      evidence: [
        { submittedById: 'member', quality: 70 },
        { submittedById: 'member', quality: 88 },
      ],
      requesterId: 'manager',
    },
    ...overrides,
  });

  const byUser = (drafts: ReturnType<typeof attributeResolution>) => {
    const out: Record<string, number> = {};
    for (const d of drafts) out[d.userId] = (out[d.userId] ?? 0) + d.amount;
    return out;
  };

  it('credits each role deterministically, with configured values', () => {
    const drafts = attributeResolution(input());
    const totals = byUser(drafts);
    const P = CURRENT_RULES.points;
    expect(totals.reporter).toBe(P.PROBLEM_RESOLVED_REPORTER);
    expect(totals.dup).toBe(P.PROBLEM_RESOLVED_CORROBORATOR); // once, though two duplicates
    expect(totals['early-commenter']).toBe(P.USEFUL_COMMENT);
    expect(totals.supporter).toBe(P.PROBLEM_SUPPORTED);
    // Project members are credited for project work, not as community.
    expect(totals.member).toBe(
      CURRENT_RULES.caps.tasksPerUserPerProject * P.TASK_COMPLETED +
        P.RESOLUTION_EVIDENCE_SUBMITTED +
        P.QUALITY_BONUS,
    );
    expect(totals.manager).toBe(P.MILESTONE_COMPLETED + P.PROJECT_CONTRIBUTION);
    expect(totals.outsider).toBeUndefined(); // not a member of the assigned organisation
    expect(attributeResolution(input())).toEqual(drafts);
  });

  it('gives every award a unique, stable key', () => {
    const keys = attributeResolution(input()).map((d) => d.idempotencyKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain('PROBLEM_RESOLVED:p:reporter:reporter');
    expect(keys).toContain('TASK_COMPLETED:t1:member');
  });

  it('caps community credit per problem', () => {
    const crowd = Array.from({ length: 60 }, (_, i) => ({
      userId: `u${i}`,
      commented: false,
    }));
    const drafts = attributeResolution(
      input({ community: crowd, project: null, duplicateReporters: [] }),
    );
    expect(drafts.filter((d) => d.type === 'PROBLEM_SUPPORTED')).toHaveLength(
      CURRENT_RULES.caps.communityContributorsPerProblem,
    );
  });

  it('works without a project', () => {
    const drafts = attributeResolution(input({ project: null }));
    expect(drafts.some((d) => d.type === 'TASK_COMPLETED')).toBe(false);
  });
});

describe('notifications', () => {
  it('announce meaningful achievements, each at most once', () => {
    const [points] = planNotifications({
      type: 'IMPACT_POINTS_AWARDED',
      userId: 'u',
      points: 30,
      headline: 'SAM-1023 was resolved.',
      problemPublicId: 'SAM-1023',
      eventKey: 'resolved:p',
    });
    expect(points).toMatchObject({
      title: 'You earned 30 Impact Points',
      dedupeKey: 'impact:resolved:p',
    });
    expect(hrefFor('IMPACT_POINTS_AWARDED', points!.metadata)).toBe('/profile/impact');
    const [tier] = planNotifications({
      type: 'REPUTATION_TIER_REACHED',
      userId: 'u',
      tier: 'TRUSTED_CONTRIBUTOR',
    });
    expect(tier!.message).toBe('You are now a Trusted Contributor.');
    const [badge] = planNotifications({
      type: 'BADGE_EARNED',
      userId: 'u',
      badgeKey: 'FIRST_REPORT',
      badgeName: 'First Report',
    });
    expect(badge!.dedupeKey).toBe('badge:FIRST_REPORT');
  });
});
