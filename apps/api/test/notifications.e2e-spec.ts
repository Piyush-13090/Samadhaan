import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AiService } from '../src/ai/ai.service.js';
import { configureApp, registerNotFoundHandler } from '../src/bootstrap.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { DomainEventBus } from '../src/events/domain-event-bus.js';
import type { Notification } from '../src/generated/prisma/client.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import { RedisService } from '../src/redis/redis.service.js';

/**
 * Notifications end to end: real events from real actions, through the real
 * bus, into the real table, read back through the real guards.
 *
 * The suite owns the test accounts' notifications for its duration: it sets
 * aside whatever the development seed left there, so counts are exact, and
 * puts it back afterwards.
 */
describe('Notifications (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let bus: DomainEventBus;
  let notificationsService: NotificationsService;
  let server: Parameters<typeof request>[0];

  const PASSWORD = 'DevPassword123!';
  const createdProblemIds: string[] = [];
  let setAside: Notification[] = [];

  const ids = { reporter: '', other: '', third: '', admin: '' };
  const cookies = {
    reporter: [] as string[],
    other: [] as string[],
    third: [] as string[],
  };

  const analyzeProblem = vi.fn(async () => ({
    ok: true as const,
    analysis: {
      provider: 'test',
      modelName: 'test-model',
      modelVersion: 'test-model-1',
      category: 'POTHOLES',
      subcategory: 'road surface',
      severity: 'HIGH',
      urgency: 'HIGH',
      summary: 'A pothole at a junction.',
      confidence: 0.9,
      observations: ['A cavity in the road surface.'],
      severityScore: 7.5,
      processingMs: 10,
      textOnly: true,
    },
  }));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AiService)
      .useValue({
        analyzeProblem,
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
    bus = app.get(DomainEventBus);
    notificationsService = app.get(NotificationsService);
    server = app.getHttpServer();

    const users = await prisma.user.findMany({
      where: {
        email: {
          in: [
            'citizen@samadhaan.dev',
            'citizen2@samadhaan.dev',
            'citizen3@samadhaan.dev',
            'admin@samadhaan.dev',
          ],
        },
      },
    });
    const byEmail = (email: string) => users.find((user) => user.email === email)!.id;
    ids.reporter = byEmail('citizen@samadhaan.dev');
    ids.other = byEmail('citizen2@samadhaan.dev');
    ids.third = byEmail('citizen3@samadhaan.dev');
    ids.admin = byEmail('admin@samadhaan.dev');

    const testUsers = Object.values(ids);
    setAside = await prisma.notification.findMany({
      where: { recipientId: { in: testUsers } },
    });
    await prisma.notification.deleteMany({ where: { recipientId: { in: testUsers } } });

    cookies.reporter = await loginAs('citizen@samadhaan.dev');
    cookies.other = await loginAs('citizen2@samadhaan.dev');
    cookies.third = await loginAs('citizen3@samadhaan.dev');
  });

  beforeEach(async () => {
    await clearRateLimits();
    await bus.drain();
    await prisma.notification.deleteMany({
      where: { recipientId: { in: Object.values(ids) } },
    });
  });

  afterAll(async () => {
    await bus?.drain();
    if (prisma) {
      const testUsers = Object.values(ids);
      await prisma.notification.deleteMany({ where: { recipientId: { in: testUsers } } });
      if (setAside.length > 0) {
        await prisma.notification.createMany({
          data: setAside.map((row) => ({ ...row, metadata: row.metadata ?? undefined })),
          skipDuplicates: true,
        });
      }
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

  async function newProblem(reporterId = ids.reporter) {
    const problem = await prisma.problem.create({
      data: {
        reporterId,
        title: 'Notification probe: broken footpath slab',
        description: 'A fixture created by the notifications e2e suite.',
        category: 'ROADS',
        status: 'SUBMITTED',
        latitude: 28.4595,
        longitude: 77.0266,
        city: 'Gurugram',
      },
      select: { id: true, publicId: true },
    });
    createdProblemIds.push(problem.id);
    return problem;
  }

  /** Everything the bus has started has finished — notifications are written. */
  const settle = () => bus.drain();

  async function notificationsOf(cookie: string[], query = '') {
    const response = await request(server)
      .get(`/api/v1/notifications${query}`)
      .set('Cookie', cookie)
      .expect(200);
    return response.body.data as {
      items: Array<{
        id: string;
        type: string;
        title: string;
        message: string;
        href: string;
        isRead: boolean;
        problemPublicId: string | null;
      }>;
      nextCursor: string | null;
      unreadCount: number;
    };
  }

  const problemPath = (publicId: string) => `/api/v1/problems/${publicId}`;

  // ============================================================== creation

  describe('creation from events', () => {
    it('notifies the reporter when someone comments, with a link to the discussion', async () => {
      const problem = await newProblem();

      await request(server)
        .post(`${problemPath(problem.publicId)}/comments`)
        .set('Cookie', cookies.other)
        .send({ body: 'Seen this too, near the bus stop.' })
        .expect(201);
      await settle();

      const { items, unreadCount } = await notificationsOf(cookies.reporter);
      expect(unreadCount).toBe(1);
      expect(items[0]).toMatchObject({
        type: 'PROBLEM_COMMENTED',
        title: 'New comment on your problem',
        href: `/problems/${problem.publicId}#discussion`,
        problemPublicId: problem.publicId,
        isRead: false,
      });
      // The commenter's public name, never their email.
      expect(items[0]!.message).toContain('arjun');
      expect(JSON.stringify(items)).not.toContain('@samadhaan.dev');
    });

    it('notifies the reporter about support without naming the supporter', async () => {
      const problem = await newProblem();

      await request(server)
        .post(`${problemPath(problem.publicId)}/support`)
        .set('Cookie', cookies.other)
        .expect(200);
      await settle();

      const { items } = await notificationsOf(cookies.reporter);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        type: 'PROBLEM_SUPPORTED',
        href: `/problems/${problem.publicId}`,
      });
      expect(items[0]!.message).not.toMatch(/arjun|Arjun/);
    });

    it('notifies the parent commenter when someone replies', async () => {
      const problem = await newProblem();
      const parent = await request(server)
        .post(`${problemPath(problem.publicId)}/comments`)
        .set('Cookie', cookies.third)
        .send({ body: 'The drain overflows every evening.' })
        .expect(201);

      await request(server)
        .post(`${problemPath(problem.publicId)}/comments`)
        .set('Cookie', cookies.other)
        .send({
          body: 'Same here, near the next intersection.',
          parentCommentId: parent.body.data.comment.id,
        })
        .expect(201);
      await settle();

      const third = await notificationsOf(cookies.third);
      expect(third.items.map((item) => item.type)).toEqual(['COMMENT_REPLIED']);
      expect(third.items[0]!.href).toBe(`/problems/${problem.publicId}#discussion`);

      // The reporter hears about both the comment and the reply as discussion.
      const reporter = await notificationsOf(cookies.reporter);
      expect(reporter.items.map((item) => item.type)).toEqual([
        'PROBLEM_COMMENTED',
        'PROBLEM_COMMENTED',
      ]);

      // And the replier hears nothing about their own reply.
      expect((await notificationsOf(cookies.other)).items).toHaveLength(0);
    });

    it('notifies the reporter when AI analysis completes', async () => {
      const response = await request(server)
        .post('/api/v1/problems')
        .set('Cookie', cookies.reporter)
        .send({
          title: 'Notification probe: pothole at the junction',
          description:
            'Checks that a completed analysis notifies the person who filed it.',
          category: 'POTHOLES',
          location: { latitude: 28.4595, longitude: 77.0266, city: 'Gurugram' },
        })
        .expect(201);
      createdProblemIds.push(response.body.data.id as string);
      const publicId = response.body.data.publicId as string;

      // Analysis runs detached; wait for the row, then for the bus.
      await vi.waitFor(
        async () => {
          const analysis = await prisma.problemAiAnalysis.findFirst({
            where: { problem: { publicId }, analysisType: 'INITIAL_ANALYSIS' },
          });
          expect(analysis?.processingStatus).toBe('COMPLETED');
        },
        { timeout: 10_000, interval: 100 },
      );
      await settle();

      const { items } = await notificationsOf(cookies.reporter);
      const analysed = items.find((item) => item.type === 'AI_ANALYSIS_COMPLETED');
      expect(analysed).toMatchObject({
        title: 'AI analysis completed',
        href: `/problems/${publicId}`,
        problemPublicId: publicId,
      });
      expect(analysed!.message).toContain('potholes');
    });

    it('notifies the reporter about a likely duplicate', async () => {
      const problem = await newProblem();
      const older = await newProblem(ids.other);

      bus.publish({
        type: 'LIKELY_DUPLICATES_FOUND',
        problemId: problem.id,
        problemPublicId: problem.publicId,
        reporterId: ids.reporter,
        matches: [
          {
            candidateProblemId: older.id,
            candidatePublicId: older.publicId,
            similarity: 0.87,
          },
        ],
      });
      await settle();

      const { items } = await notificationsOf(cookies.reporter);
      expect(items[0]).toMatchObject({
        type: 'POSSIBLE_DUPLICATE_FOUND',
        href: `/problems/${problem.publicId}#similar`,
      });
      expect(items[0]!.message).toContain(`${older.publicId} (87% match)`);
    });
  });

  // ======================================================= status changes

  describe('status changes', () => {
    it('notifies followers when a followed problem’s status actually changes', async () => {
      const canonical = await newProblem(ids.other);
      const problem = await newProblem();

      // Two followers besides the reporter.
      for (const cookie of [cookies.other, cookies.third]) {
        await request(server)
          .post(`${problemPath(problem.publicId)}/follow`)
          .set('Cookie', cookie)
          .expect(200);
      }

      const pair = await prisma.problemDuplicateCandidate.create({
        data: {
          problemId: problem.id,
          candidateProblemId: canonical.id,
          combinedScore: 0.9,
          status: 'LIKELY_DUPLICATE',
        },
      });

      // The reporter confirms their own report is a duplicate.
      await request(server)
        .post(`${problemPath(problem.publicId)}/duplicates/${pair.id}/confirm`)
        .set('Cookie', cookies.reporter)
        .expect(201);
      await settle();

      for (const cookie of [cookies.other, cookies.third]) {
        const { items } = await notificationsOf(cookie);
        const update = items.find((item) => item.type === 'FOLLOWED_PROBLEM_UPDATED');
        expect(update).toMatchObject({
          title: `You're following ${problem.publicId}`,
          message: `${problem.publicId} is now marked as a duplicate.`,
          href: `/problems/${problem.publicId}`,
        });
      }

      // The reporter made the change, so they are not told about it.
      const reporter = await notificationsOf(cookies.reporter);
      expect(reporter.items.filter((item) => item.type.includes('STATUS'))).toHaveLength(
        0,
      );
    });

    it('notifies nobody when the status did not change', async () => {
      const problem = await newProblem();
      await request(server)
        .post(`${problemPath(problem.publicId)}/follow`)
        .set('Cookie', cookies.other)
        .expect(200);

      bus.publish({
        type: 'PROBLEM_STATUS_CHANGED',
        problemId: problem.id,
        problemPublicId: problem.publicId,
        reporterId: ids.reporter,
        fromStatus: 'SUBMITTED',
        toStatus: 'SUBMITTED',
        actorUserId: null,
        changeId: 'no-op-change',
      });
      await settle();

      expect((await notificationsOf(cookies.other)).items).toHaveLength(0);
      expect((await notificationsOf(cookies.reporter)).items).toHaveLength(0);
    });
  });

  // ====================================================== self and spam

  describe('self-notification and duplicate prevention', () => {
    it('never notifies people about their own actions', async () => {
      const problem = await newProblem();

      await request(server)
        .post(`${problemPath(problem.publicId)}/support`)
        .set('Cookie', cookies.reporter)
        .expect(200);
      const own = await request(server)
        .post(`${problemPath(problem.publicId)}/comments`)
        .set('Cookie', cookies.reporter)
        .send({ body: 'Adding detail to my own report.' })
        .expect(201);
      await request(server)
        .post(`${problemPath(problem.publicId)}/comments`)
        .set('Cookie', cookies.reporter)
        .send({
          body: 'And a reply under it.',
          parentCommentId: own.body.data.comment.id,
        })
        .expect(201);
      await settle();

      expect((await notificationsOf(cookies.reporter)).items).toHaveLength(0);
    });

    it('notifies once per supporter, however many times support is toggled', async () => {
      const problem = await newProblem();

      for (let round = 0; round < 3; round += 1) {
        await request(server)
          .post(`${problemPath(problem.publicId)}/support`)
          .set('Cookie', cookies.other)
          .expect(200);
        await request(server)
          .delete(`${problemPath(problem.publicId)}/support`)
          .set('Cookie', cookies.other)
          .expect(200);
      }
      await settle();

      const { items } = await notificationsOf(cookies.reporter);
      expect(items.filter((item) => item.type === 'PROBLEM_SUPPORTED')).toHaveLength(1);
    });

    it('creates one notification when the same event is delivered repeatedly', async () => {
      const problem = await newProblem();
      const event = {
        type: 'AI_ANALYSIS_COMPLETED' as const,
        problemId: problem.id,
        problemPublicId: problem.publicId,
        reporterId: ids.reporter,
        analysisId: '00000000-0000-4000-8000-0000000000aa',
        category: 'ROADS' as const,
      };

      // A replay, and two racing deliveries.
      for (let index = 0; index < 5; index += 1) bus.publish(event);
      await settle();

      const { items } = await notificationsOf(cookies.reporter);
      expect(items).toHaveLength(1);
    });
  });

  // ============================================================ reliability

  describe('reliability', () => {
    it('keeps the civic action when notification creation fails', async () => {
      const problem = await newProblem();
      const spy = vi
        .spyOn(notificationsService, 'createMany')
        .mockRejectedValueOnce(new Error('notifications table unavailable'));

      const response = await request(server)
        .post(`${problemPath(problem.publicId)}/support`)
        .set('Cookie', cookies.other)
        .expect(200);
      await settle();

      expect(response.body.data).toEqual({
        supportCount: 1,
        supportedByCurrentUser: true,
      });
      expect(await prisma.problemVote.count({ where: { problemId: problem.id } })).toBe(
        1,
      );
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  // ================================================================== API

  describe('reading and managing', () => {
    /** Writes notifications straight to the table, for read-side tests. */
    async function seedFor(recipientId: string, count: number, label = 'Probe') {
      const start = Date.now() - count * 1000;
      await prisma.notification.createMany({
        data: Array.from({ length: count }, (_, index) => ({
          recipientId,
          type: 'PROBLEM_SUPPORTED' as const,
          title: `${label} ${String(index).padStart(2, '0')}`,
          message: 'Another citizen supported SAM-1.',
          entityType: 'PROBLEM' as const,
          metadata: { problemPublicId: 'SAM-1' },
          dedupeKey: `e2e:${label}:${index}`,
          createdAt: new Date(start + index * 1000),
        })),
      });
    }

    it('returns only the caller’s notifications', async () => {
      await seedFor(ids.reporter, 2, 'Mine');
      await seedFor(ids.other, 3, 'Theirs');

      const mine = await notificationsOf(cookies.reporter);
      expect(mine.items).toHaveLength(2);
      expect(mine.items.every((item) => item.title.startsWith('Mine'))).toBe(true);
    });

    it('refuses any attempt to name a recipient', async () => {
      await request(server)
        .get(`/api/v1/notifications?recipientId=${ids.other}`)
        .set('Cookie', cookies.reporter)
        .expect(400);
      await request(server)
        .get(`/api/v1/notifications/unread-count?recipientId=${ids.other}`)
        .set('Cookie', cookies.reporter)
        .expect(400);
    });

    it('will not read, mark or delete someone else’s notification', async () => {
      await seedFor(ids.other, 1, 'Private');
      const theirs = await prisma.notification.findFirstOrThrow({
        where: { recipientId: ids.other },
      });

      await request(server)
        .patch(`/api/v1/notifications/${theirs.id}/read`)
        .set('Cookie', cookies.reporter)
        .expect(404);
      await request(server)
        .delete(`/api/v1/notifications/${theirs.id}`)
        .set('Cookie', cookies.reporter)
        .expect(404);

      const after = await prisma.notification.findUniqueOrThrow({
        where: { id: theirs.id },
      });
      expect(after.readAt).toBeNull();
    });

    it('counts unread accurately', async () => {
      await seedFor(ids.reporter, 4);
      const one = await prisma.notification.findFirstOrThrow({
        where: { recipientId: ids.reporter },
      });
      await prisma.notification.update({
        where: { id: one.id },
        data: { readAt: new Date() },
      });

      const response = await request(server)
        .get('/api/v1/notifications/unread-count')
        .set('Cookie', cookies.reporter)
        .expect(200);
      expect(response.body.data).toEqual({ count: 3 });
    });

    it('marks one read, idempotently', async () => {
      await seedFor(ids.reporter, 2);
      const [first] = (await notificationsOf(cookies.reporter)).items;

      const marked = await request(server)
        .patch(`/api/v1/notifications/${first!.id}/read`)
        .set('Cookie', cookies.reporter)
        .expect(200);
      expect(marked.body.data).toMatchObject({ id: first!.id, isRead: true });
      const readAt = marked.body.data.readAt as string;

      const again = await request(server)
        .patch(`/api/v1/notifications/${first!.id}/read`)
        .set('Cookie', cookies.reporter)
        .expect(200);
      expect(again.body.data.readAt).toBe(readAt);

      expect((await notificationsOf(cookies.reporter)).unreadCount).toBe(1);
    });

    it('marks all read, touching only the caller’s', async () => {
      await seedFor(ids.reporter, 3);
      await seedFor(ids.other, 2, 'Other');

      const response = await request(server)
        .patch('/api/v1/notifications/read-all')
        .set('Cookie', cookies.reporter)
        .expect(200);
      expect(response.body.data).toEqual({ updated: 3, unreadCount: 0 });

      expect((await notificationsOf(cookies.other)).unreadCount).toBe(2);
    });

    it('filters to unread', async () => {
      await seedFor(ids.reporter, 3);
      const [first] = (await notificationsOf(cookies.reporter)).items;
      await request(server)
        .patch(`/api/v1/notifications/${first!.id}/read`)
        .set('Cookie', cookies.reporter)
        .expect(200);

      const unread = await notificationsOf(cookies.reporter, '?filter=unread');
      expect(unread.items).toHaveLength(2);
      expect(unread.items.every((item) => !item.isRead)).toBe(true);
    });

    it('deletes one of the caller’s notifications', async () => {
      await seedFor(ids.reporter, 2);
      const [first] = (await notificationsOf(cookies.reporter)).items;

      const response = await request(server)
        .delete(`/api/v1/notifications/${first!.id}`)
        .set('Cookie', cookies.reporter)
        .expect(200);
      expect(response.body.data).toEqual({ unreadCount: 1 });
      expect((await notificationsOf(cookies.reporter)).items).toHaveLength(1);
    });

    it('pages newest first without gaps or repeats', async () => {
      await seedFor(ids.reporter, 45);

      const first = await notificationsOf(cookies.reporter);
      expect(first.items).toHaveLength(20);
      expect(first.items[0]!.title).toBe('Probe 44');

      const seen = first.items.map((item) => item.title);
      let cursor = first.nextCursor;
      while (cursor) {
        const page = await notificationsOf(cookies.reporter, `?cursor=${cursor}`);
        seen.push(...page.items.map((item) => item.title));
        cursor = page.nextCursor;
      }

      expect(seen).toHaveLength(45);
      expect(new Set(seen).size).toBe(45);
      expect(seen.at(-1)).toBe('Probe 00');
    });

    it('bounds the page size and validates ids and filters', async () => {
      await request(server)
        .get('/api/v1/notifications?limit=0')
        .set('Cookie', cookies.reporter)
        .expect(400);
      await request(server)
        .get('/api/v1/notifications?limit=51')
        .set('Cookie', cookies.reporter)
        .expect(400);
      await request(server)
        .get('/api/v1/notifications?filter=everyone')
        .set('Cookie', cookies.reporter)
        .expect(400);
      await request(server)
        .get('/api/v1/notifications?cursor=nonsense')
        .set('Cookie', cookies.reporter)
        .expect(400);
      await request(server)
        .patch('/api/v1/notifications/not-a-uuid/read')
        .set('Cookie', cookies.reporter)
        .expect(400);
    });

    it('requires a session for every endpoint', async () => {
      const id = '00000000-0000-4000-8000-000000000000';
      await request(server).get('/api/v1/notifications').expect(401);
      await request(server).get('/api/v1/notifications/unread-count').expect(401);
      await request(server).patch(`/api/v1/notifications/${id}/read`).expect(401);
      await request(server).patch('/api/v1/notifications/read-all').expect(401);
      await request(server).delete(`/api/v1/notifications/${id}`).expect(401);
    });

    /** Metadata is untrusted on read: a poisoned row cannot produce a bad link. */
    it('never turns stored metadata into an external link', async () => {
      await prisma.notification.create({
        data: {
          recipientId: ids.reporter,
          type: 'PROBLEM_SUPPORTED',
          title: 'Poisoned',
          message: 'Stored with hostile metadata.',
          entityType: 'PROBLEM',
          metadata: {
            problemPublicId: 'javascript:alert(1)',
            href: 'https://evil.example',
          },
          dedupeKey: 'e2e:poisoned',
        },
      });

      const { items } = await notificationsOf(cookies.reporter);
      expect(items[0]).toMatchObject({ href: '/notifications', problemPublicId: null });
      expect(JSON.stringify(items)).not.toContain('evil.example');
    });
  });
});
