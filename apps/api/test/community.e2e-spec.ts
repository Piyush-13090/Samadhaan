import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { COMMENT_BODY_MAX_LENGTH, REPLY_PREVIEW_COUNT } from '@samadhaan/shared';
import { AppModule } from '../src/app.module.js';
import { AiService } from '../src/ai/ai.service.js';
import { configureApp, registerNotFoundHandler } from '../src/bootstrap.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { RedisService } from '../src/redis/redis.service.js';

/**
 * Community engagement end to end: support, follow, comments and replies.
 *
 * Real guards, real database, real unique constraints — the concurrency cases
 * only mean something against PostgreSQL. Problems are created directly through
 * Prisma so each test owns a clean one with zeroed counters.
 */
describe('Community (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let server: Parameters<typeof request>[0];

  const PASSWORD = 'DevPassword123!';
  const createdProblemIds: string[] = [];

  let citizenId: string;
  let citizen: string[];
  let other: string[];
  let admin: string[];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AiService)
      .useValue({
        analyzeProblem: async () => ({
          ok: false as const,
          failure: { code: 'PROVIDER_UNAVAILABLE', message: 'n/a', retryable: false },
        }),
        embedText: async () => ({
          ok: false as const,
          failure: { code: 'PROVIDER_UNAVAILABLE', message: 'n/a', retryable: false },
        }),
        getHealth: async () => null,
      })
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    registerNotFoundHandler(app);

    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    server = app.getHttpServer();

    citizenId = (
      await prisma.user.findUniqueOrThrow({ where: { email: 'citizen@samadhaan.dev' } })
    ).id;

    citizen = await loginAs('citizen@samadhaan.dev');
    other = await loginAs('citizen2@samadhaan.dev');
    admin = await loginAs('admin@samadhaan.dev');
  });

  // Rate limits are per user and would otherwise accumulate across tests.
  beforeEach(clearRateLimits);

  afterAll(async () => {
    if (createdProblemIds.length > 0) {
      // Comments restrict their parent's deletion, so replies go first.
      await prisma.problemComment
        .deleteMany({
          where: { problemId: { in: createdProblemIds }, parentCommentId: { not: null } },
        })
        .catch(() => undefined);
      await prisma.problemComment
        .deleteMany({ where: { problemId: { in: createdProblemIds } } })
        .catch(() => undefined);
      await prisma.problem
        .deleteMany({ where: { id: { in: createdProblemIds } } })
        .catch(() => undefined);
    }
    await app?.close();
  });

  async function clearRateLimits(): Promise<void> {
    const keys = await redis.connection.keys('ratelimit:*');
    if (keys.length > 0) await redis.connection.del(...keys);
  }

  async function loginAs(email: string): Promise<string[]> {
    await clearRateLimits();
    const response = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    const header = response.headers['set-cookie'];
    return Array.isArray(header) ? header : header ? [header] : [];
  }

  /** A fresh, published problem with zeroed counters. Returns its public id. */
  async function newProblem(
    overrides: { status?: string; reporterId?: string } = {},
  ): Promise<{ id: string; publicId: string }> {
    const problem = await prisma.problem.create({
      data: {
        reporterId: overrides.reporterId ?? citizenId,
        title: 'Community probe: broken footpath slab',
        description:
          'A fixture created by the community e2e suite to exercise engagement.',
        category: 'ROADS',
        status: (overrides.status ?? 'SUBMITTED') as never,
        latitude: 28.4595,
        longitude: 77.0266,
        city: 'Gurugram',
      },
      select: { id: true, publicId: true },
    });
    createdProblemIds.push(problem.id);
    return problem;
  }

  const base = (publicId: string) => `/api/v1/problems/${publicId}`;

  // ================================================================ support

  describe('support', () => {
    it('lets an authenticated user support a problem', async () => {
      const { publicId } = await newProblem();

      const response = await request(server)
        .post(`${base(publicId)}/support`)
        .set('Cookie', other)
        .expect(200);

      expect(response.body.data).toEqual({
        supportCount: 1,
        supportedByCurrentUser: true,
      });
    });

    it('does not count the same user twice', async () => {
      const { publicId } = await newProblem();

      await request(server)
        .post(`${base(publicId)}/support`)
        .set('Cookie', other)
        .expect(200);
      const second = await request(server)
        .post(`${base(publicId)}/support`)
        .set('Cookie', other)
        .expect(200);

      expect(second.body.data.supportCount).toBe(1);
      expect(await prisma.problemVote.count({ where: { problem: { publicId } } })).toBe(
        1,
      );
    });

    /**
     * The case a read-then-write check gets wrong. Only the unique constraint
     * and a counter moved by rows actually inserted keep this at one.
     */
    it('stays at one support under simultaneous requests', async () => {
      const { publicId } = await newProblem();

      await Promise.all(
        Array.from({ length: 8 }, () =>
          request(server)
            .post(`${base(publicId)}/support`)
            .set('Cookie', other),
        ),
      );

      const row = await prisma.problem.findUniqueOrThrow({
        where: { publicId },
        select: { voteCount: true, _count: { select: { votes: true } } },
      });
      expect(row._count.votes).toBe(1);
      expect(row.voteCount).toBe(1);
    });

    it('removes support, and removing it again is a harmless no-op', async () => {
      const { publicId } = await newProblem();

      await request(server)
        .post(`${base(publicId)}/support`)
        .set('Cookie', other)
        .expect(200);
      const removed = await request(server)
        .delete(`${base(publicId)}/support`)
        .set('Cookie', other)
        .expect(200);
      expect(removed.body.data).toEqual({
        supportCount: 0,
        supportedByCurrentUser: false,
      });

      const again = await request(server)
        .delete(`${base(publicId)}/support`)
        .set('Cookie', other)
        .expect(200);
      // Never negative — the counter moves by rows deleted, which is zero.
      expect(again.body.data.supportCount).toBe(0);
    });

    it('counts supporters accurately across users', async () => {
      const { publicId } = await newProblem();

      for (const cookie of [citizen, other, admin]) {
        await request(server)
          .post(`${base(publicId)}/support`)
          .set('Cookie', cookie)
          .expect(200);
      }
      await request(server)
        .delete(`${base(publicId)}/support`)
        .set('Cookie', admin)
        .expect(200);

      const state = await request(server)
        .get(`${base(publicId)}/support`)
        .set('Cookie', other)
        .expect(200);
      expect(state.body.data).toEqual({ supportCount: 2, supportedByCurrentUser: true });

      // Anonymous readers see the count but no personal state.
      const anonymous = await request(server)
        .get(`${base(publicId)}/support`)
        .expect(200);
      expect(anonymous.body.data).toEqual({
        supportCount: 2,
        supportedByCurrentUser: false,
      });
    });

    it('does not move the problem’s updatedAt', async () => {
      const { publicId } = await newProblem();
      const before = await prisma.problem.findUniqueOrThrow({ where: { publicId } });

      await request(server)
        .post(`${base(publicId)}/support`)
        .set('Cookie', other)
        .expect(200);

      const after = await prisma.problem.findUniqueOrThrow({ where: { publicId } });
      expect(after.updatedAt.toISOString()).toBe(before.updatedAt.toISOString());
    });

    it('refuses new support on a confirmed duplicate, pointing at the canonical report', async () => {
      const canonical = await newProblem();
      const duplicate = await newProblem({ status: 'DUPLICATE' });
      await prisma.problem.update({
        where: { id: duplicate.id },
        data: { duplicateOfId: canonical.id },
      });

      const response = await request(server)
        .post(`${base(duplicate.publicId)}/support`)
        .set('Cookie', other)
        .expect(409);
      expect(response.body.error.message).toContain(canonical.publicId);
    });
  });

  // ================================================================= follow

  describe('follow', () => {
    it('lets an authenticated user follow, once', async () => {
      const { publicId } = await newProblem();

      const first = await request(server)
        .post(`${base(publicId)}/follow`)
        .set('Cookie', other)
        .expect(200);
      expect(first.body.data).toEqual({ followerCount: 1, followedByCurrentUser: true });

      const second = await request(server)
        .post(`${base(publicId)}/follow`)
        .set('Cookie', other)
        .expect(200);
      expect(second.body.data.followerCount).toBe(1);
      expect(await prisma.problemFollow.count({ where: { problem: { publicId } } })).toBe(
        1,
      );
    });

    it('stays at one follow under simultaneous requests', async () => {
      const { publicId } = await newProblem();

      await Promise.all(
        Array.from({ length: 8 }, () =>
          request(server)
            .post(`${base(publicId)}/follow`)
            .set('Cookie', other),
        ),
      );

      const row = await prisma.problem.findUniqueOrThrow({
        where: { publicId },
        select: { followCount: true, _count: { select: { follows: true } } },
      });
      expect(row._count.follows).toBe(1);
      expect(row.followCount).toBe(1);
    });

    it('unfollows', async () => {
      const { publicId } = await newProblem();

      await request(server)
        .post(`${base(publicId)}/follow`)
        .set('Cookie', other)
        .expect(200);
      const response = await request(server)
        .delete(`${base(publicId)}/follow`)
        .set('Cookie', other)
        .expect(200);

      expect(response.body.data).toEqual({
        followerCount: 0,
        followedByCurrentUser: false,
      });
    });

    /** Support and follow are separate signals and must not move each other. */
    it('keeps follow independent of support', async () => {
      const { publicId } = await newProblem();

      await request(server)
        .post(`${base(publicId)}/follow`)
        .set('Cookie', other)
        .expect(200);

      const engagement = await request(server)
        .get(`${base(publicId)}/engagement`)
        .set('Cookie', other)
        .expect(200);
      expect(engagement.body.data).toMatchObject({
        supportCount: 0,
        supportedByCurrentUser: false,
        followerCount: 1,
        followedByCurrentUser: true,
        commentCount: 0,
        acceptsEngagement: true,
      });
    });

    it('makes a reporter follow the report they file', async () => {
      const response = await request(server)
        .post('/api/v1/problems')
        .set('Cookie', citizen)
        .send({
          title: 'Community probe: reporter auto-follow',
          description: 'Checks that filing a report follows it on the reporter’s behalf.',
          category: 'ROADS',
          location: { latitude: 28.4595, longitude: 77.0266, city: 'Gurugram' },
        })
        .expect(201);

      const publicId = response.body.data.publicId as string;
      createdProblemIds.push(response.body.data.id as string);

      const follow = await request(server)
        .get(`${base(publicId)}/follow`)
        .set('Cookie', citizen)
        .expect(200);
      expect(follow.body.data).toEqual({ followerCount: 1, followedByCurrentUser: true });
    });
  });

  // =============================================================== comments

  describe('comments', () => {
    it('creates a comment and moves the count', async () => {
      const { publicId } = await newProblem();

      const response = await request(server)
        .post(`${base(publicId)}/comments`)
        .set('Cookie', other)
        .send({ body: 'This road becomes very dangerous after rain.' })
        .expect(201);

      const { comment, commentCount } = response.body.data;
      expect(commentCount).toBe(1);
      expect(comment.body).toBe('This road becomes very dangerous after rain.');
      expect(comment.canEdit).toBe(true);
      expect(comment.author.name).toBeTruthy();
      // Public author view: name and avatar, never contact details.
      expect(comment.author).not.toHaveProperty('email');
    });

    it('normalises whitespace before storing', async () => {
      const { publicId } = await newProblem();

      const response = await request(server)
        .post(`${base(publicId)}/comments`)
        .set('Cookie', other)
        .send({ body: '   Water is back.\r\n\r\n\r\n\r\nSecond line.   ' })
        .expect(201);

      expect(response.body.data.comment.body).toBe('Water is back.\n\nSecond line.');
    });

    it('rejects empty and whitespace-only comments', async () => {
      const { publicId } = await newProblem();

      for (const body of ['', '     ', '\n\n\t', '\u0000\u0001']) {
        await request(server)
          .post(`${base(publicId)}/comments`)
          .set('Cookie', other)
          .send({ body })
          .expect(400);
      }
      await request(server)
        .post(`${base(publicId)}/comments`)
        .set('Cookie', other)
        .send({})
        .expect(400);
    });

    it('rejects oversized comments', async () => {
      const { publicId } = await newProblem();

      await request(server)
        .post(`${base(publicId)}/comments`)
        .set('Cookie', other)
        .send({ body: 'a'.repeat(COMMENT_BODY_MAX_LENGTH + 1) })
        .expect(400);

      await request(server)
        .post(`${base(publicId)}/comments`)
        .set('Cookie', other)
        .send({ body: 'a'.repeat(COMMENT_BODY_MAX_LENGTH) })
        .expect(201);
    });

    it('stores markup as text, not as anything executable', async () => {
      const { publicId } = await newProblem();
      const body = '<script>alert(1)</script> & <b>bold</b>';

      const response = await request(server)
        .post(`${base(publicId)}/comments`)
        .set('Cookie', other)
        .send({ body })
        .expect(201);

      // Returned verbatim as JSON text; rendering it as a text node is the
      // client's half of the contract.
      expect(response.body.data.comment.body).toBe(body);
    });

    it('lets the author edit, marking the comment edited', async () => {
      const { publicId } = await newProblem();
      const created = await request(server)
        .post(`${base(publicId)}/comments`)
        .set('Cookie', other)
        .send({ body: 'Original text here.' })
        .expect(201);
      const commentId = created.body.data.comment.id as string;

      const edited = await request(server)
        .patch(`${base(publicId)}/comments/${commentId}`)
        .set('Cookie', other)
        .send({ body: 'Corrected text here.' })
        .expect(200);

      expect(edited.body.data.comment).toMatchObject({
        id: commentId,
        body: 'Corrected text here.',
        isEdited: true,
      });
      // One record, updated in place.
      expect(
        await prisma.problemComment.count({ where: { problem: { publicId } } }),
      ).toBe(1);
    });

    it('does not mark an unchanged save as edited', async () => {
      const { publicId } = await newProblem();
      const created = await request(server)
        .post(`${base(publicId)}/comments`)
        .set('Cookie', other)
        .send({ body: 'Same words.' })
        .expect(201);

      const saved = await request(server)
        .patch(`${base(publicId)}/comments/${created.body.data.comment.id}`)
        .set('Cookie', other)
        .send({ body: '  Same words.  ' })
        .expect(200);

      expect(saved.body.data.comment.isEdited).toBe(false);
    });

    it("refuses to let a user edit someone else's comment — admins included", async () => {
      const { publicId } = await newProblem();
      const created = await request(server)
        .post(`${base(publicId)}/comments`)
        .set('Cookie', other)
        .send({ body: 'Words that belong to their author.' })
        .expect(201);
      const commentId = created.body.data.comment.id as string;

      for (const cookie of [citizen, admin]) {
        await request(server)
          .patch(`${base(publicId)}/comments/${commentId}`)
          .set('Cookie', cookie)
          .send({ body: 'Rewritten by someone else.' })
          .expect(403);
      }

      const row = await prisma.problemComment.findUniqueOrThrow({
        where: { id: commentId },
      });
      expect(row.body).toBe('Words that belong to their author.');
    });

    it('lets the author delete, softly, and hides the content', async () => {
      const { publicId } = await newProblem();
      const created = await request(server)
        .post(`${base(publicId)}/comments`)
        .set('Cookie', other)
        .send({ body: 'This will be removed.' })
        .expect(201);
      const commentId = created.body.data.comment.id as string;

      const removed = await request(server)
        .delete(`${base(publicId)}/comments/${commentId}`)
        .set('Cookie', other)
        .expect(200);
      expect(removed.body.data.commentCount).toBe(0);

      // The row survives, for moderation and thread structure.
      const row = await prisma.problemComment.findUniqueOrThrow({
        where: { id: commentId },
      });
      expect(row.deletedAt).not.toBeNull();

      // And with no replies to anchor, it leaves the listing entirely.
      const list = await request(server)
        .get(`${base(publicId)}/comments`)
        .expect(200);
      expect(list.body.data.items).toHaveLength(0);
      expect(JSON.stringify(list.body)).not.toContain('This will be removed.');

      // Deleting twice is not an error and does not move the count again.
      const again = await request(server)
        .delete(`${base(publicId)}/comments/${commentId}`)
        .set('Cookie', other)
        .expect(200);
      expect(again.body.data.commentCount).toBe(0);
    });

    it("refuses to let a user delete someone else's comment", async () => {
      const { publicId } = await newProblem();
      const created = await request(server)
        .post(`${base(publicId)}/comments`)
        .set('Cookie', other)
        .send({ body: 'Not yours to delete.' })
        .expect(201);

      await request(server)
        .delete(`${base(publicId)}/comments/${created.body.data.comment.id}`)
        .set('Cookie', citizen)
        .expect(403);

      const row = await prisma.problemComment.findUniqueOrThrow({
        where: { id: created.body.data.comment.id },
      });
      expect(row.deletedAt).toBeNull();
    });

    it('lets an admin remove a comment, and audits it', async () => {
      const { publicId } = await newProblem();
      const created = await request(server)
        .post(`${base(publicId)}/comments`)
        .set('Cookie', other)
        .send({ body: 'Moderation target.' })
        .expect(201);
      const commentId = created.body.data.comment.id as string;

      await request(server)
        .delete(`${base(publicId)}/comments/${commentId}`)
        .set('Cookie', admin)
        .expect(200);

      const audit = await prisma.auditLog.findFirst({
        where: { action: 'COMMENT_REMOVED_BY_MODERATOR', entityId: commentId },
      });
      expect(audit).not.toBeNull();
    });

    /** IDOR: a comment id is only valid under its own problem's path. */
    it('will not reach a comment through another problem’s path', async () => {
      const a = await newProblem();
      const b = await newProblem();
      const created = await request(server)
        .post(`${base(a.publicId)}/comments`)
        .set('Cookie', other)
        .send({ body: 'Lives on problem A.' })
        .expect(201);
      const commentId = created.body.data.comment.id as string;

      await request(server)
        .patch(`${base(b.publicId)}/comments/${commentId}`)
        .set('Cookie', other)
        .send({ body: 'Edited via B.' })
        .expect(404);
      await request(server)
        .delete(`${base(b.publicId)}/comments/${commentId}`)
        .set('Cookie', other)
        .expect(404);
    });

    it('rejects a malformed comment id', async () => {
      const { publicId } = await newProblem();

      await request(server)
        .patch(`${base(publicId)}/comments/not-a-uuid`)
        .set('Cookie', other)
        .send({ body: 'Hello there.' })
        .expect(400);
    });

    it('does not let anyone comment on a draft they cannot see', async () => {
      const { publicId } = await newProblem({ status: 'DRAFT' });

      await request(server)
        .post(`${base(publicId)}/comments`)
        .set('Cookie', other)
        .send({ body: 'Should not land.' })
        .expect(404);
      await request(server)
        .get(`${base(publicId)}/comments`)
        .expect(404);
    });
  });

  // ================================================================ replies

  describe('replies', () => {
    it('replies to a comment, one level deep', async () => {
      const { publicId } = await newProblem();
      const parent = await request(server)
        .post(`${base(publicId)}/comments`)
        .set('Cookie', citizen)
        .send({ body: 'This road becomes very dangerous after rain.' })
        .expect(201);
      const parentId = parent.body.data.comment.id as string;

      const reply = await request(server)
        .post(`${base(publicId)}/comments`)
        .set('Cookie', other)
        .send({
          body: 'Same issue near the next intersection.',
          parentCommentId: parentId,
        })
        .expect(201);
      expect(reply.body.data.comment.parentCommentId).toBe(parentId);
      expect(reply.body.data.commentCount).toBe(2);

      const list = await request(server)
        .get(`${base(publicId)}/comments`)
        .expect(200);
      expect(list.body.data.items).toHaveLength(1);
      expect(list.body.data.items[0].replyCount).toBe(1);
      expect(list.body.data.items[0].replies[0].body).toBe(
        'Same issue near the next intersection.',
      );
      // The reporter's comment is marked as theirs.
      expect(list.body.data.items[0].author.isReporter).toBe(true);
    });

    it('refuses a reply to a reply', async () => {
      const { publicId } = await newProblem();
      const parent = await request(server)
        .post(`${base(publicId)}/comments`)
        .set('Cookie', citizen)
        .send({ body: 'Top-level comment.' })
        .expect(201);
      const reply = await request(server)
        .post(`${base(publicId)}/comments`)
        .set('Cookie', other)
        .send({
          body: 'First-level reply.',
          parentCommentId: parent.body.data.comment.id,
        })
        .expect(201);

      await request(server)
        .post(`${base(publicId)}/comments`)
        .set('Cookie', citizen)
        .send({
          body: 'Second-level reply.',
          parentCommentId: reply.body.data.comment.id,
        })
        .expect(400);
    });

    it('rejects an invalid or unknown parent', async () => {
      const { publicId } = await newProblem();

      await request(server)
        .post(`${base(publicId)}/comments`)
        .set('Cookie', other)
        .send({ body: 'Reply to nothing.', parentCommentId: 'not-a-uuid' })
        .expect(400);

      await request(server)
        .post(`${base(publicId)}/comments`)
        .set('Cookie', other)
        .send({
          body: 'Reply to a comment that does not exist.',
          parentCommentId: '00000000-0000-4000-8000-000000000000',
        })
        .expect(400);
    });

    it('rejects a parent that belongs to a different problem', async () => {
      const a = await newProblem();
      const b = await newProblem();
      const onA = await request(server)
        .post(`${base(a.publicId)}/comments`)
        .set('Cookie', citizen)
        .send({ body: 'A comment on problem A.' })
        .expect(201);

      const response = await request(server)
        .post(`${base(b.publicId)}/comments`)
        .set('Cookie', other)
        .send({ body: 'Cross-problem reply.', parentCommentId: onA.body.data.comment.id })
        .expect(400);
      expect(response.body.error.details[0].field).toBe('parentCommentId');
      expect(await prisma.problemComment.count({ where: { problemId: b.id } })).toBe(0);
    });

    it('keeps a removed parent as a placeholder while it has replies', async () => {
      const { publicId } = await newProblem();
      const parent = await request(server)
        .post(`${base(publicId)}/comments`)
        .set('Cookie', citizen)
        .send({ body: 'Parent that will be removed.' })
        .expect(201);
      const parentId = parent.body.data.comment.id as string;
      await request(server)
        .post(`${base(publicId)}/comments`)
        .set('Cookie', other)
        .send({ body: 'A reply that survives.', parentCommentId: parentId })
        .expect(201);

      await request(server)
        .delete(`${base(publicId)}/comments/${parentId}`)
        .set('Cookie', citizen)
        .expect(200);

      const list = await request(server)
        .get(`${base(publicId)}/comments`)
        .expect(200);
      const [thread] = list.body.data.items;
      expect(thread).toMatchObject({
        id: parentId,
        isRemoved: true,
        body: null,
        author: null,
      });
      expect(thread.replies[0].body).toBe('A reply that survives.');
      expect(JSON.stringify(list.body)).not.toContain('Parent that will be removed.');

      // A removed comment cannot be replied to.
      await request(server)
        .post(`${base(publicId)}/comments`)
        .set('Cookie', other)
        .send({ body: 'Reply to a removed comment.', parentCommentId: parentId })
        .expect(400);
    });
  });

  // ============================================================= pagination

  describe('pagination', () => {
    it('pages top-level comments newest first without gaps or repeats', async () => {
      const { id, publicId } = await newProblem();
      const start = Date.now() - 60_000;

      // Inserted directly with distinct timestamps, so the order is exact.
      await prisma.problemComment.createMany({
        data: Array.from({ length: 25 }, (_, index) => ({
          problemId: id,
          userId: citizenId,
          body: `Paged comment ${String(index).padStart(2, '0')}`,
          createdAt: new Date(start + index * 1000),
        })),
      });

      const first = await request(server)
        .get(`${base(publicId)}/comments?limit=10`)
        .expect(200);
      expect(first.body.data.items).toHaveLength(10);
      expect(first.body.data.items[0].body).toBe('Paged comment 24');
      expect(first.body.data.nextCursor).toBeTruthy();

      const seen: string[] = first.body.data.items.map(
        (item: { body: string }) => item.body,
      );
      let cursor = first.body.data.nextCursor as string | null;
      while (cursor) {
        const page = await request(server)
          .get(`${base(publicId)}/comments?limit=10&cursor=${cursor}`)
          .expect(200);
        seen.push(...page.body.data.items.map((item: { body: string }) => item.body));
        cursor = page.body.data.nextCursor;
      }

      expect(seen).toHaveLength(25);
      expect(new Set(seen).size).toBe(25);
      expect(seen.at(-1)).toBe('Paged comment 00');
    });

    it('previews a bounded number of replies and pages the rest', async () => {
      const { id, publicId } = await newProblem();
      const parent = await prisma.problemComment.create({
        data: { problemId: id, userId: citizenId, body: 'A busy thread.' },
      });
      const start = Date.now();
      await prisma.problemComment.createMany({
        data: Array.from({ length: 7 }, (_, index) => ({
          problemId: id,
          userId: citizenId,
          parentCommentId: parent.id,
          body: `Reply ${index}`,
          createdAt: new Date(start + index * 1000),
        })),
      });

      const list = await request(server)
        .get(`${base(publicId)}/comments`)
        .expect(200);
      const [thread] = list.body.data.items;
      expect(thread.replies).toHaveLength(REPLY_PREVIEW_COUNT);
      expect(thread.replyCount).toBe(7);
      expect(thread.repliesCursor).toBeTruthy();

      const rest = await request(server)
        .get(
          `${base(publicId)}/comments?parentCommentId=${parent.id}&cursor=${thread.repliesCursor}`,
        )
        .expect(200);
      expect(rest.body.data.items.map((item: { body: string }) => item.body)).toEqual([
        'Reply 3',
        'Reply 4',
        'Reply 5',
        'Reply 6',
      ]);
    });

    it('bounds the page size and rejects a malformed cursor', async () => {
      const { publicId } = await newProblem();

      await request(server)
        .get(`${base(publicId)}/comments?limit=0`)
        .expect(400);
      await request(server)
        .get(`${base(publicId)}/comments?limit=500`)
        .expect(400);
      await request(server)
        .get(`${base(publicId)}/comments?cursor=nonsense`)
        .expect(400);
    });
  });

  // ========================================================= authorization

  describe('authorization and tampering', () => {
    it('rejects every community write without a session', async () => {
      const { publicId } = await newProblem();
      const someId = '00000000-0000-4000-8000-000000000000';

      await request(server)
        .post(`${base(publicId)}/support`)
        .expect(401);
      await request(server)
        .delete(`${base(publicId)}/support`)
        .expect(401);
      await request(server)
        .post(`${base(publicId)}/follow`)
        .expect(401);
      await request(server)
        .delete(`${base(publicId)}/follow`)
        .expect(401);
      await request(server)
        .post(`${base(publicId)}/comments`)
        .send({ body: 'Anonymous comment.' })
        .expect(401);
      await request(server)
        .patch(`${base(publicId)}/comments/${someId}`)
        .send({ body: 'Anonymous edit.' })
        .expect(401);
      await request(server)
        .delete(`${base(publicId)}/comments/${someId}`)
        .expect(401);
    });

    it('lets anyone read engagement and comments', async () => {
      const { publicId } = await newProblem();

      await request(server)
        .get(`${base(publicId)}/engagement`)
        .expect(200);
      await request(server)
        .get(`${base(publicId)}/comments`)
        .expect(200);
      await request(server)
        .get(`${base(publicId)}/follow`)
        .expect(200);
    });

    /**
     * The client may not name a user or set a count. The global whitelist
     * turns each attempt into a 400 rather than a silently ignored field.
     */
    it('refuses client-supplied user ids and counts', async () => {
      const { publicId } = await newProblem();

      for (const extra of [
        { userId: citizenId },
        { commentCount: 999 },
        { isEdited: true },
        { problemId: '00000000-0000-4000-8000-000000000000' },
      ]) {
        await request(server)
          .post(`${base(publicId)}/comments`)
          .set('Cookie', other)
          .send({ body: 'Tampered comment.', ...extra })
          .expect(400);
      }

      for (const extra of [{ userId: citizenId }, { supportCount: 999 }]) {
        await request(server)
          .post(`${base(publicId)}/support`)
          .set('Cookie', other)
          .send(extra)
          .expect(200);
      }

      // Support takes no body at all, so nothing above could have moved the
      // count beyond the one real supporter.
      const row = await prisma.problem.findUniqueOrThrow({ where: { publicId } });
      expect(row.voteCount).toBe(1);
      expect(row.commentCount).toBe(0);
      const vote = await prisma.problemVote.findFirstOrThrow({
        where: { problem: { publicId } },
      });
      expect(vote.userId).not.toBe(citizenId);
    });

    it('rate limits comment creation per user', async () => {
      const { publicId } = await newProblem();

      const statuses: number[] = [];
      for (let index = 0; index < 12; index += 1) {
        const response = await request(server)
          .post(`${base(publicId)}/comments`)
          .set('Cookie', other)
          .send({ body: `Burst comment ${index}` });
        statuses.push(response.status);
      }

      expect(statuses.slice(0, 10).every((status) => status === 201)).toBe(true);
      expect(statuses.slice(10)).toEqual([429, 429]);

      // Another user is unaffected — the bucket is the account, not the IP.
      await request(server)
        .post(`${base(publicId)}/comments`)
        .set('Cookie', citizen)
        .send({ body: 'A different person.' })
        .expect(201);
    });
  });

  // ============================================================= discovery

  describe('community discovery', () => {
    it('sorts by support and by recent discussion, and marks the viewer’s engagement', async () => {
      const quiet = await newProblem();
      const loud = await newProblem();

      await request(server)
        .post(`${base(loud.publicId)}/support`)
        .set('Cookie', other)
        .expect(200);
      await request(server)
        .post(`${base(loud.publicId)}/support`)
        .set('Cookie', admin)
        .expect(200);
      await request(server)
        .post(`${base(quiet.publicId)}/follow`)
        .set('Cookie', other)
        .expect(200);
      await request(server)
        .post(`${base(quiet.publicId)}/comments`)
        .set('Cookie', other)
        .send({ body: 'Discussing the quiet one.' })
        .expect(201);

      const supported = await request(server)
        .get('/api/v1/problems/nearby?sort=supported&limit=50&city=Gurugram')
        .set('Cookie', other)
        .expect(200);
      const ids = supported.body.data.items.map(
        (item: { publicId: string }) => item.publicId,
      );
      expect(ids.indexOf(loud.publicId)).toBeLessThan(ids.indexOf(quiet.publicId));

      const loudItem = supported.body.data.items.find(
        (item: { publicId: string }) => item.publicId === loud.publicId,
      );
      expect(loudItem).toMatchObject({
        supportedByCurrentUser: true,
        followedByCurrentUser: false,
      });

      const discussed = await request(server)
        .get('/api/v1/problems/nearby?sort=discussed&limit=50')
        .set('Cookie', other)
        .expect(200);
      const discussedIds = discussed.body.data.items.map(
        (item: { publicId: string }) => item.publicId,
      );
      expect(discussedIds[0]).toBe(quiet.publicId);
      // Only problems that have actually been discussed.
      expect(discussedIds).not.toContain(loud.publicId);
    });
  });
});
