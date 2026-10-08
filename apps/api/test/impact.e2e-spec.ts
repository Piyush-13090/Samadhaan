import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp, registerNotFoundHandler } from '../src/bootstrap.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { DomainEventBus } from '../src/events/domain-event-bus.js';
import { ContributionAttributionService } from '../src/impact/contribution-attribution.service.js';
import { ImpactEventHandler } from '../src/impact/impact-event.handler.js';
import { RedisService } from '../src/redis/redis.service.js';
import { deleteAuditLogs } from './audit-maintenance.js';

/**
 * Impact points, reputation, badges and the leaderboard (Prompt 23), end to
 * end against real PostgreSQL: rewards follow real government decisions,
 * replays and races award once, and nothing a client sends creates points.
 */
describe('Impact points (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let bus: DomainEventBus;
  let handler: ImpactEventHandler;
  let attribution: ContributionAttributionService;
  let server: Parameters<typeof request>[0];

  const PASSWORD = 'DevPassword123!';
  const PREFIX = 'e2e-impact-';
  const CITY = 'Impactpur';
  const TITLE = 'Impact probe ';
  const EMAIL = (key: string) => `${PREFIX}${key}@samadhaan.test`;

  const users: Record<string, string> = {};
  const cookies: Record<string, string[]> = {};
  const problems: Record<string, { id: string; publicId: string }> = {};

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    registerNotFoundHandler(app);
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    bus = app.get(DomainEventBus);
    handler = app.get(ImpactEventHandler);
    attribution = app.get(ContributionAttributionService);
    handler.activate();

    await cleanUp();
    const template = await prisma.user.findUniqueOrThrow({
      where: { email: 'government@samadhaan.dev' },
    });
    for (const [key, role] of [
      ['reporter', 'CITIZEN'],
      ['spammer', 'CITIZEN'],
      ['dup', 'CITIZEN'],
      ['commenter', 'CITIZEN'],
      ['supporter', 'CITIZEN'],
      ['late', 'CITIZEN'],
      ['official', 'GOVERNMENT'],
    ] as const) {
      users[key] = (
        await prisma.user.create({
          data: {
            email: EMAIL(key),
            passwordHash: template.passwordHash,
            fullName: `Impact ${key}`,
            displayName: `${PREFIX}${key}`,
            phone: null,
            role,
            status: 'ACTIVE',
          },
        })
      ).id;
    }
    const office = await prisma.organization.create({
      data: {
        name: 'E2E Impact Office',
        slug: `${PREFIX}office`,
        type: 'GOVERNMENT',
        verificationStatus: 'VERIFIED',
        jurisdictionType: 'MUNICIPAL_CORPORATION',
        jurisdictionName: CITY,
        jurisdictionCities: [CITY],
      },
    });
    await prisma.organizationMember.create({
      data: {
        organizationId: office.id,
        userId: users.official!,
        membershipRole: 'OWNER',
        status: 'ACTIVE',
        joinedAt: new Date(),
      },
    });

    const problem = async (
      key: string,
      reporter: string,
      category: 'POTHOLES' | 'DRAINAGE' = 'POTHOLES',
    ) => {
      const created = await prisma.problem.create({
        data: {
          reporterId: users[reporter]!,
          title: `${TITLE}${key}`,
          description: 'A test problem for impact points.',
          category,
          status: 'SUBMITTED',
          latitude: 20.1,
          longitude: 75.1,
          city: CITY,
          state: 'Testland',
          submittedAt: new Date(),
        },
      });
      problems[key] = { id: created.id, publicId: created.publicId };
    };
    await problem('main', 'reporter');
    await problem('rejected', 'spammer');
    await problem('dup', 'dup');
    await problem('dup-unverified-original', 'reporter', 'DRAINAGE');
    await problem('dup-of-unverified', 'dup', 'DRAINAGE');
    await problem('silent', 'reporter');

    await clearKeys();
    for (const key of ['reporter', 'spammer', 'dup', 'official'])
      cookies[key] = await loginAs(EMAIL(key));
    cookies.admin = await loginAs('admin@samadhaan.dev');
    cookies.citizen = await loginAs('citizen@samadhaan.dev');
  });

  beforeEach(async () => {
    await clearKeys();
  });

  afterAll(async () => {
    if (prisma) await cleanUp();
    await app?.close();
  });

  async function cleanUp(): Promise<void> {
    const ids = (
      await prisma.user.findMany({
        where: { email: { startsWith: PREFIX } },
        select: { id: true },
      })
    ).map((u) => u.id);
    const problemIds = (
      await prisma.problem.findMany({
        where: { title: { startsWith: TITLE } },
        select: { id: true },
      })
    ).map((p) => p.id);
    // The ledger and badges are append-only: clean-up is an explicit maintenance act.
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('samadhaan.audit_maintenance', 'on', true)`;
      await tx.impactPointTransaction.deleteMany({ where: { userId: { in: ids } } });
      await tx.userBadge.deleteMany({ where: { userId: { in: ids } } });
    });
    await prisma.notification.deleteMany({ where: { recipientId: { in: ids } } });
    await deleteAuditLogs(prisma, {
      OR: [{ entityId: { in: [...problemIds, ...ids] } }, { actorUserId: { in: ids } }],
    });
    await prisma.problemDuplicateCandidate.deleteMany({
      where: { problemId: { in: problemIds } },
    });
    await prisma.problemComment.deleteMany({ where: { problemId: { in: problemIds } } });
    await prisma.problemVote.deleteMany({ where: { problemId: { in: problemIds } } });
    await prisma.problem.updateMany({
      where: { id: { in: problemIds } },
      data: { duplicateOfId: null },
    });
    await prisma.problem.deleteMany({ where: { id: { in: problemIds } } });
    await prisma.organization.deleteMany({ where: { slug: { startsWith: PREFIX } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }

  async function clearKeys(): Promise<void> {
    const keys = [
      ...(await redis.connection.keys('ratelimit:*')),
      ...(await redis.connection.keys('leaderboard:*')),
    ];
    if (keys.length > 0) await redis.connection.del(...keys);
  }

  async function loginAs(email: string): Promise<string[]> {
    const response = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    const header = response.headers['set-cookie'];
    return Array.isArray(header) ? header : header ? [header] : [];
  }

  const api = (as: string) => ({
    get: (path: string) =>
      request(server).get(`/api/v1${path}`).set('Cookie', cookies[as]!),
    post: (path: string, body: object = {}) =>
      request(server).post(`/api/v1${path}`).set('Cookie', cookies[as]!).send(body),
    patch: (path: string, body: object) =>
      request(server).patch(`/api/v1${path}`).set('Cookie', cookies[as]!).send(body),
  });
  const review = async (key: string, to: 'VERIFIED' | 'REJECTED') => {
    const base = `/government/${PREFIX}office/problems/${problems[key]!.publicId}/status`;
    await api('official').patch(base, { status: 'UNDER_REVIEW' }).expect(200);
    await api('official')
      .patch(
        base,
        to === 'REJECTED'
          ? { status: 'REJECTED', note: 'Not a civic issue.' }
          : { status: 'VERIFIED' },
      )
      .expect(200);
    await settle();
  };
  const settle = async () => {
    await bus.drain();
    await handler.idle();
    await bus.drain();
  };
  const ledger = (key: string) =>
    prisma.impactPointTransaction.findMany({ where: { userId: users[key]! } });
  const points = async (key: string) =>
    (await prisma.userImpactStats.findUnique({ where: { userId: users[key]! } }))
      ?.impactPoints ?? 0;

  // ======================================================= verified reports

  describe('verified reports', () => {
    it('awards nothing for filing — and the verification reward once the government verifies', async () => {
      expect(await ledger('reporter')).toHaveLength(0);
      await review('main', 'VERIFIED');
      const rows = await ledger('reporter');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        type: 'PROBLEM_VERIFIED',
        amount: 20,
        ruleVersion: 'POINT_RULES_V1',
        problemId: problems.main!.id,
        idempotencyKey: `PROBLEM_VERIFIED:${problems.main!.id}:${users.reporter}`,
      });
      expect(rows[0]!.reason).toContain(problems.main!.publicId);
      expect(await points('reporter')).toBe(20);
      expect(
        await prisma.userBadge.findMany({ where: { userId: users.reporter! } }),
      ).toEqual([expect.objectContaining({ badgeKey: 'FIRST_REPORT' })]);
      const notes = await prisma.notification.findMany({
        where: { recipientId: users.reporter! },
      });
      expect(notes.map((n) => n.type).sort()).toEqual([
        'BADGE_EARNED',
        'IMPACT_POINTS_AWARDED',
        'PROBLEM_STATUS_CHANGED',
        'PROBLEM_STATUS_CHANGED',
      ]);
    });

    it('awards once however often the event is replayed, even concurrently', async () => {
      const event = {
        type: 'PROBLEM_STATUS_CHANGED' as const,
        problemId: problems.main!.id,
        problemPublicId: problems.main!.publicId,
        reporterId: users.reporter!,
        fromStatus: 'UNDER_REVIEW' as const,
        toStatus: 'VERIFIED' as const,
        actorUserId: users.official!,
        changeId: 'replay',
      };
      bus.publish(event);
      bus.publish(event);
      bus.publish(event);
      await Promise.all(
        Array.from({ length: 5 }, () => attribution.onVerified(problems.main!.id)),
      );
      await settle();
      expect(await ledger('reporter')).toHaveLength(1);
      expect(await points('reporter')).toBe(20);
    });

    it('awards nothing for a rejected report, and reputation reflects it', async () => {
      await review('rejected', 'REJECTED');
      expect(await ledger('spammer')).toHaveLength(0);
      const spammer = (await api('spammer').get('/users/me/reputation').expect(200)).body
        .data;
      const reporter = (await api('reporter').get('/users/me/reputation').expect(200))
        .body.data;
      expect(reporter.score).toBeGreaterThan(spammer.score);
      // Negative signals are never exposed.
      expect(Object.keys(spammer)).not.toEqual(
        expect.arrayContaining(['rejectedReports']),
      );
      expect(JSON.stringify(spammer)).not.toMatch(/reject/i);
    });
  });

  // ============================================================ duplicates

  describe('duplicates', () => {
    async function confirm(dupKey: string, originalKey: string, as: string) {
      const candidate = await prisma.problemDuplicateCandidate.create({
        data: {
          problemId: problems[dupKey]!.id,
          candidateProblemId: problems[originalKey]!.id,
          status: 'LIKELY_DUPLICATE',
          combinedScore: 0.9,
        },
      });
      await api(as)
        .post(
          `/problems/${problems[dupKey]!.publicId}/duplicates/${candidate.id}/confirm`,
        )
        .expect((r) => expect([200, 201, 204]).toContain(r.status));
      await settle();
    }

    it('rewards a reporter who confirms their report duplicates a verified problem — once', async () => {
      await confirm('dup', 'main', 'dup');
      const rows = await ledger('dup');
      expect(rows).toEqual([
        expect.objectContaining({
          type: 'DUPLICATE_IDENTIFIED',
          amount: 10,
          problemId: problems.main!.id,
        }),
      ]);
      await attribution.onDuplicateConfirmed(problems.dup!.id);
      expect(await ledger('dup')).toHaveLength(1);
    });

    it('waits for the original to be verified before rewarding', async () => {
      await confirm('dup-of-unverified', 'dup-unverified-original', 'dup');
      expect(
        (await ledger('dup')).filter(
          (r) => r.problemId === problems['dup-unverified-original']!.id,
        ),
      ).toHaveLength(0);
      await review('dup-unverified-original', 'VERIFIED');
      expect(
        (await ledger('dup')).filter((r) => r.type === 'DUPLICATE_IDENTIFIED'),
      ).toHaveLength(2);
    });
  });

  // ============================================================ resolution

  describe('resolution attribution', () => {
    it('credits the reporter, the duplicate reporter and early, substantive contributors — not late or trivial ones', async () => {
      const verifiedAt = (
        await prisma.auditLog.findFirstOrThrow({
          where: { entityId: problems.main!.id, action: 'PROBLEM_STATUS_CHANGED' },
          orderBy: { createdAt: 'desc' },
        })
      ).createdAt;
      const before = new Date(verifiedAt.getTime() - 60_000);
      await prisma.problemComment.create({
        data: {
          problemId: problems.main!.id,
          userId: users.commenter!,
          body: 'The pothole is about a foot deep near the bus stop.',
          createdAt: before,
        },
      });
      await prisma.problemComment.create({
        data: {
          problemId: problems.main!.id,
          userId: users.late!,
          body: 'Me too',
          createdAt: before,
        },
      });
      await prisma.problemVote.create({
        data: {
          problemId: problems.main!.id,
          userId: users.supporter!,
          createdAt: before,
        },
      });
      await prisma.problemVote.create({
        data: {
          problemId: problems.main!.id,
          userId: users.reporter!,
          createdAt: before,
        },
      });
      await prisma.problemVote.create({
        data: {
          problemId: problems.main!.id,
          userId: users.late!,
          createdAt: new Date(verifiedAt.getTime() + 60_000),
        },
      });

      await prisma.problem.update({
        where: { id: problems.main!.id },
        data: { status: 'RESOLVED', resolvedAt: new Date() },
      });
      for (let i = 0; i < 2; i += 1) {
        bus.publish({
          type: 'PROBLEM_STATUS_CHANGED',
          problemId: problems.main!.id,
          problemPublicId: problems.main!.publicId,
          reporterId: users.reporter!,
          fromStatus: 'IN_PROGRESS',
          toStatus: 'RESOLVED',
          actorUserId: users.official!,
          changeId: `resolve-${i}`,
        });
      }
      await settle();

      // Two verified reports (main, and the drainage original) and one resolution.
      expect(await points('reporter')).toBe(20 + 20 + 30);
      expect((await ledger('dup')).filter((r) => r.type === 'PROBLEM_RESOLVED')).toEqual([
        expect.objectContaining({
          amount: 10,
          metadata: expect.objectContaining({ role: 'corroborator' }),
        }),
      ]);
      expect(await ledger('commenter')).toEqual([
        expect.objectContaining({ type: 'USEFUL_COMMENT', amount: 5 }),
      ]);
      expect(await ledger('supporter')).toEqual([
        expect.objectContaining({ type: 'PROBLEM_SUPPORTED', amount: 2 }),
      ]);
      expect(await ledger('late')).toHaveLength(0); // short comment, and support after verification
      const stats = await prisma.userImpactStats.findUniqueOrThrow({
        where: { userId: users.reporter! },
      });
      expect(stats.resolvedContributions).toBe(1);
      const awarded = await prisma.notification.findMany({
        where: { recipientId: users.reporter!, type: 'IMPACT_POINTS_AWARDED' },
      });
      expect(awarded.map((n) => n.title)).toContain('You earned 30 Impact Points');
    });
  });

  // ============================================================ reading

  describe('what users see', () => {
    it('shows a user their own ledger, reputation, badges and contributions', async () => {
      const impact = (await api('reporter').get('/users/me/impact?limit=10').expect(200))
        .body.data;
      expect(impact).toMatchObject({ impactPoints: 70, resolvedContributions: 1 });
      expect(impact.items[0]).toMatchObject({
        amount: 30,
        type: 'PROBLEM_RESOLVED',
        problem: { publicId: problems.main!.publicId },
      });
      const reports = (
        await api('reporter').get('/users/me/impact?filter=reports').expect(200)
      ).body.data;
      expect(
        reports.items.every((i: { type: string }) => i.type === 'PROBLEM_VERIFIED'),
      ).toBe(true);
      await api('reporter').get('/users/me/impact?filter=everything').expect(400);
      const reputation = (await api('reporter').get('/users/me/reputation').expect(200))
        .body.data;
      expect(reputation).toMatchObject({
        impactPoints: 70,
        verifiedReports: 2,
        resolvedContributions: 1,
      });
      expect(reputation.note).toMatch(/not a validated measure/);
      const badges = (await api('reporter').get('/users/me/badges').expect(200)).body
        .data;
      expect(badges.find((b: { key: string }) => b.key === 'FIRST_REPORT').earned).toBe(
        true,
      );
      expect(badges.find((b: { key: string }) => b.key === 'CIVIC_CHAMPION').earned).toBe(
        false,
      );
      const contributions = (
        await api('reporter').get('/users/me/contributions').expect(200)
      ).body.data;
      expect(contributions.items[0]).toMatchObject({
        problem: { publicId: problems.main!.publicId },
        points: 30,
      });
      const activity = (await api('reporter').get('/users/me/activity').expect(200)).body
        .data;
      expect(activity.impactPoints ?? activity.activity?.impactPoints).toBe(70);
    });

    it('ranks the public leaderboard server-side, with public fields only', async () => {
      const board = (
        await request(server)
          .get(`/api/v1/leaderboard?period=all&city=${CITY}`)
          .expect(200)
      ).body.data;
      expect(
        board.items.map((i: { user: { displayName: string } }) => i.user.displayName),
      ).toEqual([
        `${PREFIX}reporter`,
        `${PREFIX}dup`,
        `${PREFIX}commenter`,
        `${PREFIX}supporter`,
      ]);
      expect(board.items[0]).toMatchObject({
        rank: 1,
        impactPoints: 70,
        resolvedContributions: 1,
        isViewer: false,
      });
      expect(Object.keys(board.items[0].user).sort()).toEqual([
        'avatarUrl',
        'displayName',
        'name',
      ]);
      expect(JSON.stringify(board)).not.toMatch(
        /@samadhaan\.test|email|phone|passwordHash|"id"|userId/,
      );
      expect(board.viewer).toBeNull();

      const mine = (
        await api('dup').get(`/leaderboard?period=week&city=${CITY}`).expect(200)
      ).body.data;
      expect(mine.viewer).toMatchObject({ rank: 2, isViewer: true, impactPoints: 30 });
      expect(
        mine.items.find((i: { isViewer: boolean }) => i.isViewer).user.displayName,
      ).toBe(`${PREFIX}dup`);
      const drainage = (
        await request(server)
          .get(`/api/v1/leaderboard?period=year&city=${CITY}&category=DRAINAGE`)
          .expect(200)
      ).body.data;
      expect(
        drainage.items.map((i: { user: { displayName: string } }) => i.user.displayName),
      ).toEqual([`${PREFIX}reporter`, `${PREFIX}dup`]);
      await request(server).get('/api/v1/leaderboard?period=decade').expect(400);
      await request(server).get('/api/v1/leaderboard?limit=1000').expect(400);
    });
  });

  // ============================================================ security

  describe('nobody but the server creates points', () => {
    it('offers no endpoint to write points or badges, and refuses mass assignment', async () => {
      await api('reporter').post('/users/me/impact', { amount: 10000 }).expect(404);
      await api('reporter')
        .post('/users/me/badges', { key: 'CIVIC_CHAMPION' })
        .expect(404);
      await api('reporter').patch('/users/me', { impactPoints: 10000 }).expect(400);
      await api('reporter').patch('/users/me', { reputationScore: 100 }).expect(400);
      await api('reporter').get(`/users/${users.dup}/impact`).expect(404);
      expect(await points('reporter')).toBe(70);
    });

    it('lets only platform administrators adjust, with a reason, never their own, always audited', async () => {
      const url = `/admin/users/${users.spammer}/impact/adjust`;
      const body = { amount: 15, reason: 'Correction for a mis-recorded verification.' };
      await api('reporter').post(url, body).expect(403);
      await api('official').post(url, body).expect(403);
      await api('admin').post(url, { amount: 0, reason: body.reason }).expect(400);
      await api('admin').post(url, { amount: 15 }).expect(400);
      await api('admin').post(url, { amount: 5000, reason: body.reason }).expect(400);
      await api('admin')
        .post(url, { ...body, userId: users.reporter })
        .expect(400);
      const admin = await prisma.user.findUniqueOrThrow({
        where: { email: 'admin@samadhaan.dev' },
      });
      await api('admin').post(`/admin/users/${admin.id}/impact/adjust`, body).expect(403);

      const result = (await api('admin').post(url, body).expect(200)).body.data;
      expect(result.impactPoints).toBe(15);
      expect(await ledger('spammer')).toEqual([
        expect.objectContaining({
          type: 'ADMIN_ADJUSTMENT',
          amount: 15,
          actorUserId: admin.id,
        }),
      ]);
      expect(
        await prisma.auditLog.count({
          where: { entityId: users.spammer!, action: 'IMPACT_POINTS_ADJUSTED' },
        }),
      ).toBe(1);
      await api('admin')
        .post(url, { amount: -15, reason: 'Reversing the earlier correction.' })
        .expect(200);
      expect(await points('spammer')).toBe(0);
      expect(await ledger('spammer')).toHaveLength(2); // corrected by a new row, never edited
    });

    it('refuses to edit or delete ledger history at the database', async () => {
      const row = (await ledger('reporter'))[0]!;
      await expect(
        prisma.impactPointTransaction.update({
          where: { id: row.id },
          data: { amount: 9999 },
        }),
      ).rejects.toThrow(/append-only/);
      await expect(
        prisma.impactPointTransaction.delete({ where: { id: row.id } }),
      ).rejects.toThrow(/append-only/);
      await expect(
        prisma.userBadge.deleteMany({ where: { userId: users.reporter! } }),
      ).rejects.toThrow(/append-only/);
    });
  });

  // ============================================================ reconciliation

  describe('reconciliation', () => {
    it('awards what a lost event would have, without double-awarding', async () => {
      await prisma.problem.update({
        where: { id: problems.silent!.id },
        data: { status: 'VERIFIED' },
      });
      expect(
        (await ledger('reporter')).filter((r) => r.problemId === problems.silent!.id),
      ).toHaveLength(0);
      await handler.reconcile();
      await handler.reconcile();
      expect(
        (await ledger('reporter')).filter((r) => r.problemId === problems.silent!.id),
      ).toEqual([expect.objectContaining({ type: 'PROBLEM_VERIFIED', amount: 20 })]);
    });
  });
});
