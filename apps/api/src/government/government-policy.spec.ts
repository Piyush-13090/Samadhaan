import { describe, expect, it } from 'vitest';
import {
  GOVERNMENT_STATUS_FILTERS,
  PROBLEM_STATUSES,
  allowedReviewTransitions,
} from '@samadhaan/shared';
import { planNotifications } from '../notifications/notification-planner.js';
import { greetingName } from './government.service.js';

describe('government review transitions', () => {
  it('allows exactly the three review steps of this milestone', () => {
    const allowed = PROBLEM_STATUSES.flatMap((from) =>
      allowedReviewTransitions(from).map((to) => `${from}→${to}`),
    );
    expect(allowed.sort()).toEqual([
      'SUBMITTED→UNDER_REVIEW',
      'UNDER_REVIEW→REJECTED',
      'UNDER_REVIEW→VERIFIED',
    ]);
  });

  it('leaves allocation and resolution steps to later milestones', () => {
    expect(allowedReviewTransitions('VERIFIED')).toEqual([]);
    expect(allowedReviewTransitions('IN_PROGRESS')).toEqual([]);
    expect(allowedReviewTransitions('DRAFT')).toEqual([]);
  });

  it('never lets a list filter by DRAFT', () => {
    expect(GOVERNMENT_STATUS_FILTERS).not.toContain('DRAFT');
  });
});

describe('review notifications', () => {
  const base = {
    type: 'PROBLEM_STATUS_CHANGED' as const,
    problemId: 'p',
    problemPublicId: 'SAM-1023',
    reporterId: 'reporter',
    actorUserId: 'official',
    changeId: 'change-1',
  };

  it('tells the reporter who verified their problem', () => {
    const [draft] = planNotifications({
      ...base,
      fromStatus: 'UNDER_REVIEW',
      toStatus: 'VERIFIED',
      reviewedBy: 'Gurugram Municipal Corporation',
    });
    expect(draft).toMatchObject({
      recipientId: 'reporter',
      title: 'Your problem was verified',
      message: 'SAM-1023 has been verified by Gurugram Municipal Corporation.',
    });
  });

  it('words a rejection plainly, without any internal note', () => {
    const [draft] = planNotifications({
      ...base,
      fromStatus: 'UNDER_REVIEW',
      toStatus: 'REJECTED',
    });
    expect(draft).toMatchObject({
      title: 'Your report was not accepted',
      message: 'SAM-1023 was reviewed and not accepted as a civic problem for action.',
    });
  });
});

describe('greetingName', () => {
  it('uses the first name, or the whole name when that is an initial', () => {
    expect(greetingName('Priya Mehta')).toBe('Priya');
    expect(greetingName('S. Krishnan')).toBe('S. Krishnan');
    expect(greetingName('Krishnan')).toBe('Krishnan');
  });
});
