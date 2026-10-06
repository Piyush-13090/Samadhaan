import { describe, expect, it } from 'vitest';
import { planNotifications } from './notification-planner.js';

const problem = { problemId: 'p1', problemPublicId: 'SAM-1023', reporterId: 'reporter' };

describe('planNotifications', () => {
  describe('AI analysis', () => {
    it('tells the reporter, keyed on the analysis so a retried job notifies once', () => {
      const [draft, ...rest] = planNotifications({
        type: 'AI_ANALYSIS_COMPLETED',
        ...problem,
        analysisId: 'a1',
        category: 'POTHOLES',
      });

      expect(rest).toHaveLength(0);
      expect(draft).toMatchObject({
        recipientId: 'reporter',
        type: 'AI_ANALYSIS_COMPLETED',
        dedupeKey: 'analysis:a1',
        metadata: { problemPublicId: 'SAM-1023' },
      });
      expect(draft?.message).toContain('as a potholes issue');
    });

    it('tells the reporter when analysis fails', () => {
      const [draft] = planNotifications({
        type: 'AI_ANALYSIS_FAILED',
        ...problem,
        analysisId: 'a1',
      });
      expect(draft).toMatchObject({
        recipientId: 'reporter',
        type: 'AI_ANALYSIS_FAILED',
      });
      expect(draft?.message).toContain('try again');
    });
  });

  describe('duplicates', () => {
    it('names the best match with a percentage, never a vector', () => {
      const [draft] = planNotifications({
        type: 'LIKELY_DUPLICATES_FOUND',
        ...problem,
        matches: [
          { candidateProblemId: 'c1', candidatePublicId: 'SAM-900', similarity: 0.912 },
          { candidateProblemId: 'c2', candidatePublicId: 'SAM-901', similarity: 0.8 },
        ],
      });

      expect(draft).toMatchObject({
        recipientId: 'reporter',
        type: 'POSSIBLE_DUPLICATE_FOUND',
        dedupeKey: 'duplicate:p1:c1',
      });
      expect(draft?.message).toContain('SAM-900 (91% match) and 1 more');
    });

    it('produces nothing without matches', () => {
      expect(
        planNotifications({ type: 'LIKELY_DUPLICATES_FOUND', ...problem, matches: [] }),
      ).toEqual([]);
    });
  });

  describe('support', () => {
    it('tells the reporter without naming the supporter, once per supporter', () => {
      const [draft] = planNotifications({
        type: 'PROBLEM_SUPPORTED',
        ...problem,
        actorUserId: 'arjun',
      });

      expect(draft).toMatchObject({
        recipientId: 'reporter',
        dedupeKey: 'support:p1:arjun',
      });
      expect(draft?.message).not.toContain('arjun');
    });

    it('never tells a reporter they supported their own problem', () => {
      expect(
        planNotifications({
          type: 'PROBLEM_SUPPORTED',
          ...problem,
          actorUserId: 'reporter',
        }),
      ).toEqual([]);
    });
  });

  describe('comments', () => {
    it('tells the reporter about a comment, by the commenter’s public name', () => {
      const [draft] = planNotifications(
        { type: 'COMMENT_CREATED', ...problem, commentId: 'c1', actorUserId: 'arjun' },
        { actorName: 'arjun' },
      );
      expect(draft).toMatchObject({ recipientId: 'reporter', type: 'PROBLEM_COMMENTED' });
      expect(draft?.message).toBe('arjun commented on SAM-1023.');
    });

    it('stays silent when the reporter comments on their own problem', () => {
      expect(
        planNotifications({
          type: 'COMMENT_CREATED',
          ...problem,
          commentId: 'c1',
          actorUserId: 'reporter',
        }),
      ).toEqual([]);
    });

    it('tells the parent author about a reply, and the reporter too', () => {
      const drafts = planNotifications({
        type: 'COMMENT_REPLIED',
        ...problem,
        commentId: 'r1',
        parentCommentId: 'c1',
        parentAuthorId: 'fatima',
        actorUserId: 'arjun',
      });

      expect(drafts.map((draft) => [draft.recipientId, draft.type])).toEqual([
        ['fatima', 'COMMENT_REPLIED'],
        ['reporter', 'PROBLEM_COMMENTED'],
      ]);
    });

    it('tells a reporter who wrote the parent only once', () => {
      const drafts = planNotifications({
        type: 'COMMENT_REPLIED',
        ...problem,
        commentId: 'r1',
        parentCommentId: 'c1',
        parentAuthorId: 'reporter',
        actorUserId: 'arjun',
      });

      expect(drafts.map((draft) => draft.type)).toEqual(['COMMENT_REPLIED']);
    });

    it('stays silent when someone replies under their own comment', () => {
      const drafts = planNotifications({
        type: 'COMMENT_REPLIED',
        ...problem,
        commentId: 'r1',
        parentCommentId: 'c1',
        parentAuthorId: 'reporter',
        actorUserId: 'reporter',
      });
      expect(drafts).toEqual([]);
    });
  });

  describe('status changes', () => {
    const change = {
      type: 'PROBLEM_STATUS_CHANGED' as const,
      ...problem,
      fromStatus: 'SUBMITTED' as const,
      toStatus: 'IN_PROGRESS' as const,
      actorUserId: 'official',
      changeId: 'chg-1',
    };

    it('tells the reporter and every other follower, excluding the actor', () => {
      const drafts = planNotifications(change, {
        followerIds: ['reporter', 'follower-a', 'follower-b', 'official'],
      });

      expect(drafts.map((draft) => [draft.recipientId, draft.type])).toEqual([
        ['reporter', 'PROBLEM_STATUS_CHANGED'],
        ['follower-a', 'FOLLOWED_PROBLEM_UPDATED'],
        ['follower-b', 'FOLLOWED_PROBLEM_UPDATED'],
      ]);
      expect(drafts[1]).toMatchObject({
        title: "You're following SAM-1023",
        message: 'SAM-1023 is now In progress.',
        dedupeKey: 'status:chg-1',
      });
    });

    it('does nothing when the status did not actually change', () => {
      expect(
        planNotifications({ ...change, toStatus: 'SUBMITTED' }, { followerIds: ['a'] }),
      ).toEqual([]);
    });

    it('does not tell a reporter about a change they made themselves', () => {
      const drafts = planNotifications(
        { ...change, actorUserId: 'reporter' },
        { followerIds: ['reporter', 'follower-a'] },
      );
      expect(drafts.map((draft) => draft.recipientId)).toEqual(['follower-a']);
    });
  });

  it('ignores events that are not news for anyone', () => {
    expect(
      planNotifications({ type: 'PROBLEM_FOLLOWED', ...problem, actorUserId: 'a' }),
    ).toEqual([]);
  });
});

describe('allocation', () => {
  const allocation = {
    allocationId: '4b46f0d5-c1a9-44b1-9b31-1558b3770c69',
    problemId: 'p1',
    problemPublicId: 'SAM-1023',
    organizationId: 'org',
    organizationSlug: 'green-earth',
    organizationName: 'Green Earth NGO',
    governmentOrganizationId: 'gov',
    governmentSlug: 'gurugram-mc',
    governmentName: 'Gurugram Municipal Corporation',
  };

  it('tells each recipient but never the actor', () => {
    const drafts = planNotifications(
      { type: 'ALLOCATION_CREATED', ...allocation, actorUserId: 'owner' },
      { allocationRecipientIds: ['owner', 'admin'] },
    );
    expect(drafts.map((draft) => draft.recipientId)).toEqual(['admin']);
    expect(drafts[0]).toMatchObject({
      type: 'ALLOCATION_REQUESTED',
      entityType: 'ALLOCATION',
      entityId: allocation.allocationId,
      dedupeKey: `allocation_created:${allocation.allocationId}`,
      metadata: {
        allocationId: allocation.allocationId,
        organizationSlug: 'green-earth',
        governmentSlug: 'gurugram-mc',
      },
    });
    expect(drafts[0]?.title).toBe('New allocation request');
    expect(drafts[0]?.message).toContain('Gurugram Municipal Corporation');
  });

  it.each([
    ['ALLOCATION_ACCEPTED', 'Allocation accepted'],
    ['ALLOCATION_DECLINED', 'Allocation declined'],
    ['ALLOCATION_CANCELLED', 'Allocation withdrawn'],
  ] as const)('words %s plainly, with no reasons or notes', (type, title) => {
    const [draft] = planNotifications(
      { type, ...allocation, actorUserId: 'someone' },
      { allocationRecipientIds: ['official'] },
    );
    expect(draft).toMatchObject({ recipientId: 'official', title, type });
  });

  it('sends nothing without recipients', () => {
    expect(
      planNotifications({ type: 'ALLOCATION_CREATED', ...allocation, actorUserId: 'a' }),
    ).toEqual([]);
  });
});
