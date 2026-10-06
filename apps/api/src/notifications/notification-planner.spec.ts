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

describe('resolution rooms', () => {
  const posted = {
    type: 'RESOLUTION_MESSAGE_POSTED' as const,
    roomId: '11111111-1111-4111-8111-111111111111',
    messageId: '22222222-2222-4222-8222-222222222222',
    problemPublicId: 'SAM-1023',
    authorUserId: 'author',
    authorName: 'Aarav Sharma',
    authorOrganizationName: 'RoadSafe Foundation',
    mentionedUserIds: ['priya', 'outsider', 'author'],
  };
  const participants = [
    { userId: 'author', lastReadAt: null },
    { userId: 'priya', lastReadAt: null },
    { userId: 'rahul', lastReadAt: '2026-10-06T10:00:00.000Z' },
  ];

  it('mentions participants only, never the author, and does not double-notify them', () => {
    const drafts = planNotifications(posted, { roomParticipants: participants });
    expect(drafts.map((d) => [d.recipientId, d.type])).toEqual([
      ['priya', 'RESOLUTION_MENTION'],
      ['rahul', 'RESOLUTION_MESSAGE'],
    ]);
    expect(drafts[0]?.dedupeKey).toBe(`resolution_mention:${posted.messageId}`);
    expect(drafts.every((d) => !d.message.includes('inspect'))).toBe(true);
  });

  it('keys message notifications on the recipient’s read marker — one per unread streak', () => {
    const [draft] = planNotifications(
      { ...posted, mentionedUserIds: [] },
      { roomParticipants: [{ userId: 'rahul', lastReadAt: '2026-10-06T10:00:00.000Z' }] },
    );
    expect(draft?.dedupeKey).toBe(
      `resolution_message:${posted.roomId}:2026-10-06T10:00:00.000Z`,
    );
    expect(draft?.metadata).toEqual({
      problemPublicId: 'SAM-1023',
      roomId: posted.roomId,
    });
  });

  it('tells everyone but the closer when a room closes', () => {
    const drafts = planNotifications(
      {
        type: 'RESOLUTION_ROOM_CLOSED',
        roomId: posted.roomId,
        problemPublicId: 'SAM-1023',
        governmentName: 'Gurugram MC',
        actorUserId: 'priya',
      },
      { roomParticipants: participants },
    );
    expect(drafts.map((d) => d.recipientId)).toEqual(['author', 'rahul']);
  });
});

describe('projects', () => {
  const base = {
    projectId: 'p1',
    roomId: '11111111-1111-4111-8111-111111111111',
    problemPublicId: 'SAM-1023',
  };

  it('tells the assignee, never someone assigning themselves', () => {
    const event = {
      type: 'PROJECT_TASK_ASSIGNED' as const,
      ...base,
      taskId: 't1',
      taskTitle: 'Inspect affected road section',
      assigneeId: 'aarav',
      taskVersion: 2,
      actorUserId: 'neha',
    };
    const [draft] = planNotifications(event);
    expect(draft).toMatchObject({
      recipientId: 'aarav',
      title: 'New task assigned',
      message: 'You were assigned "Inspect affected road section" in project SAM-1023.',
      entityType: 'RESOLUTION_PROJECT',
      dedupeKey: 'project_task_assigned:t1:v2',
      metadata: { roomId: base.roomId },
    });
    expect(planNotifications({ ...event, actorUserId: 'aarav' })).toEqual([]);
  });

  it('tells the creator when someone else completes a task', () => {
    const event = {
      type: 'PROJECT_TASK_COMPLETED' as const,
      ...base,
      taskId: 't1',
      taskTitle: 'Site visit',
      creatorId: 'neha',
      actorUserId: 'aarav',
      actorName: 'Aarav Sharma',
    };
    expect(planNotifications(event).map((d) => d.recipientId)).toEqual(['neha']);
    expect(planNotifications({ ...event, actorUserId: 'neha' })).toEqual([]);
  });

  it('sends status changes to every participant but the actor, once per change', () => {
    const drafts = planNotifications(
      {
        type: 'PROJECT_STATUS_CHANGED',
        ...base,
        from: 'ACTIVE',
        to: 'PAUSED',
        actorUserId: 'neha',
        actorOrganizationName: 'RoadSafe Foundation',
        changeId: 'e1',
      },
      {
        roomParticipants: [
          { userId: 'neha', lastReadAt: null },
          { userId: 'priya', lastReadAt: null },
        ],
      },
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      recipientId: 'priya',
      title: 'Project paused',
      dedupeKey: 'project_status:e1',
    });
  });

  it('reminds once per task and due date', () => {
    const [draft] = planNotifications({
      type: 'PROJECT_TASK_DUE_SOON',
      ...base,
      taskId: 't1',
      taskTitle: 'Upload inspection report',
      assigneeId: 'aarav',
      dueDate: '2026-10-08',
    });
    expect(draft?.dedupeKey).toBe('project_task_due:t1:2026-10-08');
  });
});

describe('AI coordinator', () => {
  const base = {
    projectId: 'p1',
    roomId: '11111111-1111-4111-8111-111111111111',
    problemPublicId: 'SAM-1023',
    insightId: 'i1',
  };

  it('alerts coordinators once per insight, never the requester', () => {
    const drafts = planNotifications(
      {
        type: 'COORDINATOR_ALERT',
        ...base,
        headline: 'Project health is now at risk: 2 tasks are overdue',
        actorUserId: 'neha',
      },
      { coordinatorRecipientIds: ['neha', 'priya'] },
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      recipientId: 'priya',
      type: 'PROJECT_COORDINATOR_ALERT',
      dedupeKey: 'coordinator_alert:i1',
      metadata: { roomId: base.roomId },
    });
  });

  it('a scheduled analysis notifies everyone relevant', () => {
    const drafts = planNotifications(
      {
        type: 'COORDINATOR_QUESTIONS_ASKED',
        ...base,
        count: 2,
        assigneeIds: ['aarav'],
        actorUserId: null,
      },
      { coordinatorRecipientIds: ['neha', 'aarav'] },
    );
    expect(drafts.map((d) => d.recipientId)).toEqual(['neha', 'aarav']);
    expect(drafts[0]!.message).toBe('2 questions need a response in project SAM-1023.');
  });
});
