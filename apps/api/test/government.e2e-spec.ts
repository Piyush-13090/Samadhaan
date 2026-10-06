import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AiService } from '../src/ai/ai.service.js';
import { configureApp, registerNotFoundHandler } from '../src/bootstrap.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { DomainEventBus } from '../src/events/domain-event-bus.js';
import { RedisService } from '../src/redis/redis.service.js';
import { deleteAuditLogs } from './audit-maintenance.js';

/**
 * The government portal end to end, against real PostGIS.
 *
 *   e2e-gov-pune      boundary around Pune      government@ (OWNER)
 *   e2e-gov-overlap   boundary around Pune too  government@ (MEMBER)  — note privacy
 *   e2e-gov-nagpur    boundary around Nagpur    e2e-gov2@   (OWNER)   — cross-jurisdiction
 *   e2e-gov-solapur   cities: ["Solapur"]       government@ (MEMBER)  — city basis
 *   e2e-gov-empty     no jurisdiction at all    government@ (MEMBER)  — fail closed
 */
describe('Government portal (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let bus: DomainEventBus;
  let server: Parameters<typeof request>[0];

  const PASSWORD = 'DevPassword123!';
  const GOV2_EMAIL = 'e2e-gov2@samadhaan.test';
  const PREFIX = 'e2e-gov-';
  const TITLE = 'Gov probe ';

  const orgIds: Record<string, string> = {};
  const problems: Record<string, { id: string; publicId: string }> = {};
  let reporterId: string;
  let gov2Id: string;

  let official: string[];
  let official2: string[];
  let citizen: string[];
  let admin: string[];
  let ngo: string[];

  const PUNE: [number, number, number, number] = [73.7, 18.4, 74.0, 18.65];
  const NAGPUR: [number, number, number, number] = [78.95, 21.05, 79.2, 21.25];

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
    bus = app.get(DomainEventBus);
    server = app.getHttpServer();

    await cleanUp();

    const government = await prisma.user.findUniqueOrThrow({
      where: { email: 'government@samadhaan.dev' },
    });
    reporterId = (
      await prisma.user.findUniqueOrThrow({ where: { email: 'citizen@samadhaan.dev' } })
    ).id;

    // A second official, in another office. Same password hash as the seed.
    gov2Id = (
      await prisma.user.create({
        data: {
          email: GOV2_EMAIL,
          passwordHash: government.passwordHash,
          fullName: 'Second Official',
          role: 'GOVERNMENT',
          status: 'ACTIVE',
        },
      })
    ).id;

    const office = async (
      key: string,
      area: { bbox?: [number, number, number, number]; cities?: string[] },
      members: Array<[string, 'OWNER' | 'MEMBER']>,
    ) => {
      const created = await prisma.organization.create({
        data: {
          name: `E2E ${key} Office`,
          slug: `${PREFIX}${key}`,
          type: 'GOVERNMENT',
          verificationStatus: 'VERIFIED',
          jurisdictionType: 'MUNICIPAL_CORPORATION',
          jurisdictionName: `${key} area`,
          jurisdictionCities: area.cities ?? [],
        },
      });
      orgIds[key] = created.id;
      if (area.bbox) {
        const [west, south, east, north] = area.bbox;
        await prisma.$executeRaw`
          UPDATE organizations
          SET "jurisdictionBoundary" = ST_Multi(ST_MakeEnvelope(${west}, ${south}, ${east}, ${north}, 4326))::geography
          WHERE id = ${created.id}::uuid`;
      }
      for (const [userId, role] of members) {
        await prisma.organizationMember.create({
          data: {
            organizationId: created.id,
            userId,
            membershipRole: role,
            status: 'ACTIVE',
            joinedAt: new Date(),
          },
        });
      }
    };

    await office('pune', { bbox: PUNE }, [[government.id, 'OWNER']]);
    await office('overlap', { bbox: PUNE }, [[government.id, 'MEMBER']]);
    await office('nagpur', { bbox: NAGPUR }, [[gov2Id, 'OWNER']]);
    await office('solapur', { cities: ['Solapur'] }, [[government.id, 'MEMBER']]);
    await office('empty', {}, [[government.id, 'MEMBER']]);
    // A government office the official does NOT belong to, and an NGO slug.

    const problem = async (
      key: string,
      data: {
        title: string;
        at: [number, number];
        status: string;
        severity: string;
        category: string;
        city: string;
        resolved?: boolean;
      },
    ) => {
      const created = await prisma.problem.create({
        data: {
          reporterId,
          title: `${TITLE}${data.title}`,
          description: `${data.title} — created by the government e2e suite.`,
          category: data.category as never,
          severity: data.severity as never,
          status: data.status as never,
          latitude: data.at[0],
          longitude: data.at[1],
          address: `${key} Lane, Shivaji Nagar`,
          city: data.city,
          state: 'Maharashtra',
          ...(data.resolved ? { resolvedAt: new Date() } : {}),
        },
      });
      problems[key] = { id: created.id, publicId: created.publicId };
    };

    await problem('p1', {
      title: 'Pothole near the bus depot',
      at: [18.53, 73.85],
      status: 'SUBMITTED',
      severity: 'HIGH',
      category: 'POTHOLES',
      city: 'Pune',
    });
    await problem('p2', {
      title: 'Burst water main',
      at: [18.55, 73.86],
      status: 'UNDER_REVIEW',
      severity: 'CRITICAL',
      category: 'WATER',
      city: 'Pune',
    });
    await problem('p3', {
      title: 'Overflowing bin',
      at: [18.51, 73.84],
      status: 'VERIFIED',
      severity: 'LOW',
      category: 'GARBAGE',
      city: 'Pune',
    });
    await problem('p4', {
      title: 'Fixed streetlight',
      at: [18.52, 73.83],
      status: 'RESOLVED',
      severity: 'MEDIUM',
      category: 'STREETLIGHTS',
      city: 'Pune',
      resolved: true,
    });
    await problem('draft', {
      title: 'Unsent draft',
      at: [18.53, 73.85],
      status: 'DRAFT',
      severity: 'HIGH',
      category: 'ROADS',
      city: 'Pune',
    });
    await problem('p6', {
      title: 'Not a civic issue',
      at: [18.5, 73.9],
      status: 'REJECTED',
      severity: 'LOW',
      category: 'OTHER',
      city: 'Pune',
    });
    // 300 m from p1 — a possible duplicate, and nearby.
    await problem('p7', {
      title: 'Another pothole by the depot',
      at: [18.5327, 73.85],
      status: 'SUBMITTED',
      severity: 'MEDIUM',
      category: 'POTHOLES',
      city: 'Pune',
    });
    await problem('n1', {
      title: 'Nagpur road damage',
      at: [21.15, 79.09],
      status: 'SUBMITTED',
      severity: 'CRITICAL',
      category: 'ROADS',
      city: 'Nagpur',
    });
    await problem('s1', {
      title: 'Solapur drain blocked',
      at: [17.66, 75.91],
      status: 'SUBMITTED',
      severity: 'HIGH',
      category: 'DRAINAGE',
      city: 'Solapur',
    });

    await prisma.problemAiAnalysis.create({
      data: {
        problemId: problems.p1!.id,
        modelName: 'samadhaan-vision',
        modelVersion: 'v1.2',
        analysisType: 'INITIAL_ANALYSIS',
        processingStatus: 'COMPLETED',
        category: 'POTHOLES',
        subcategory: 'Road surface cavity',
        severity: 'HIGH',
        urgency: 'HIGH',
        confidence: 0.94,
        summary: 'Large road damage creating a safety hazard.',
        rawResult: { observations: ['A deep cavity in the carriageway.'] },
      },
    });
    await prisma.problemDuplicateCandidate.create({
      data: {
        problemId: problems.p1!.id,
        candidateProblemId: problems.p7!.id,
        textSimilarity: 0.81,
        geographicSimilarity: 0.95,
        categorySimilarity: 1,
        combinedScore: 0.87,
        status: 'LIKELY_DUPLICATE',
      },
    });

    await clearRateLimits();
    official = await loginAs('government@samadhaan.dev');
    official2 = await loginAs(GOV2_EMAIL);
    citizen = await loginAs('citizen@samadhaan.dev');
    admin = await loginAs('admin@samadhaan.dev');
    ngo = await loginAs('ngo@samadhaan.dev');
  });

  beforeEach(clearRateLimits);

  afterAll(async () => {
    if (prisma) await cleanUp();
    await app?.close();
  });

  async function cleanUp(): Promise<void> {
    const stale = await prisma.problem.findMany({
      where: { title: { startsWith: TITLE } },
      select: { id: true },
    });
    const ids = stale.map((row) => row.id);
    await deleteAuditLogs(prisma, { entityType: 'Problem', entityId: { in: ids } });
    await prisma.notification.deleteMany({ where: { entityId: { in: ids } } });
    await prisma.problem.deleteMany({ where: { id: { in: ids } } });
    await prisma.organization.deleteMany({ where: { slug: { startsWith: PREFIX } } });
    await prisma.user.deleteMany({ where: { email: GOV2_EMAIL } });
  }

  async function clearRateLimits(): Promise<void> {
    const keys = await redis.connection.keys('ratelimit:*');
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

  const get = (path: string, cookies: string[] = official) =>
    request(server).get(`/api/v1/government${path}`).set('Cookie', cookies);

  const patchStatus = (
    slug: string,
    key: string,
    body: Record<string, unknown>,
    cookies: string[] = official,
  ) =>
    request(server)
      .patch(
        `/api/v1/government/${PREFIX}${slug}/problems/${problems[key]!.publicId}/status`,
      )
      .set('Cookie', cookies)
      .send(body);

  const titles = (items: Array<{ title: string }>) =>
    items.map((item) => item.title.replace(TITLE, '')).sort();

  // ============================================================== access

  describe('Access', () => {
    it('is for government officials only — not citizens, organisations or admins', async () => {
      await request(server).get('/api/v1/government/mine').expect(401);
      await get('/mine', citizen).expect(403);
      await get('/mine', ngo).expect(403);
      await get('/mine', admin).expect(403);
      await get(`/${PREFIX}pune/dashboard`, admin).expect(403);
    });

    it('lists the offices an official belongs to', async () => {
      const response = await get('/mine').expect(200);
      const slugs = response.body.data.map((office: { slug: string }) => office.slug);
      expect(slugs).toEqual(
        expect.arrayContaining([`${PREFIX}pune`, `${PREFIX}overlap`, `${PREFIX}solapur`]),
      );
      expect(slugs).not.toContain(`${PREFIX}nagpur`);

      const second = await get('/mine', official2).expect(200);
      expect(second.body.data.map((office: { slug: string }) => office.slug)).toEqual([
        `${PREFIX}nagpur`,
      ]);
    });

    // IDOR: an official of one office cannot open another.
    it('returns 404 for an office the official does not belong to', async () => {
      await get(`/${PREFIX}nagpur/dashboard`).expect(404);
      await get(`/${PREFIX}nagpur/problems`).expect(404);
      await get(`/${PREFIX}pune/context`, official2).expect(404);
      await get('/no-such-office/context').expect(404);
      // A non-government organisation is not a government office.
      await get('/clean-city-foundation/context').expect(404);
    });

    it('describes the jurisdiction', async () => {
      const response = await get(`/${PREFIX}pune/context`).expect(200);
      expect(response.body.data.organization.jurisdiction).toMatchObject({
        type: 'MUNICIPAL_CORPORATION',
        basis: 'boundary',
        bbox: PUNE,
      });
      expect(response.body.data.permissions).toEqual({
        canReview: true,
        canAddNotes: true,
      });
    });

    it('closes a suspended office', async () => {
      await prisma.organization.update({
        where: { id: orgIds.pune },
        data: { verificationStatus: 'SUSPENDED' },
      });
      try {
        await get(`/${PREFIX}pune/dashboard`).expect(403);
      } finally {
        await prisma.organization.update({
          where: { id: orgIds.pune },
          data: { verificationStatus: 'VERIFIED' },
        });
      }
    });
  });

  // ========================================================== jurisdiction

  describe('Jurisdiction', () => {
    it('shows only problems inside the boundary, never drafts', async () => {
      const response = await get(`/${PREFIX}pune/problems?view=all`).expect(200);
      expect(titles(response.body.data.items)).toEqual(
        titles(
          [
            'Pothole near the bus depot',
            'Burst water main',
            'Overflowing bin',
            'Fixed streetlight',
            'Not a civic issue',
            'Another pothole by the depot',
          ].map((title) => ({ title })),
        ),
      );
    });

    it('cannot be widened by a filter', async () => {
      const response = await get(`/${PREFIX}pune/problems?view=all&city=Nagpur`).expect(
        200,
      );
      expect(response.body.data.totalCount).toBe(0);
      await get(`/${PREFIX}pune/problems?organizationId=${orgIds.nagpur}`).expect(400);
    });

    it('uses the city list when there is no boundary', async () => {
      const response = await get(`/${PREFIX}solapur/problems`).expect(200);
      expect(titles(response.body.data.items)).toEqual(['Solapur drain blocked']);
      const context = await get(`/${PREFIX}solapur/context`).expect(200);
      expect(context.body.data.organization.jurisdiction.basis).toBe('cities');
    });

    it('shows nothing at all when no jurisdiction is defined', async () => {
      const list = await get(`/${PREFIX}empty/problems?view=all`).expect(200);
      expect(list.body.data.totalCount).toBe(0);
      const dashboard = await get(`/${PREFIX}empty/dashboard`).expect(200);
      expect(dashboard.body.data.metrics.totalReports).toBe(0);
    });

    it('answers a problem outside the jurisdiction exactly like a missing one', async () => {
      await get(`/${PREFIX}pune/problems/${problems.n1!.publicId}`).expect(404);
      await get(`/${PREFIX}pune/problems/${problems.draft!.publicId}`).expect(404);
      await get(`/${PREFIX}pune/problems/SAM-9999999`).expect(404);
      await get(`/${PREFIX}nagpur/problems/${problems.p1!.publicId}`, official2).expect(
        404,
      );
    });
  });

  // ============================================================ dashboard

  describe('Dashboard', () => {
    it('counts the jurisdiction in the database', async () => {
      const response = await get(`/${PREFIX}pune/dashboard?range=7`).expect(200);
      const body = response.body.data;

      expect(body.metrics).toEqual({
        totalReports: 6,
        pendingReview: 3,
        submitted: 2,
        underReview: 1,
        verified: 1,
        highSeverityOpen: 2,
        inProgress: 0,
        resolved: 1,
        rejected: 1,
        duplicates: 0,
        // This suite's offices allocate nothing; see allocation.e2e-spec.
        pendingAllocations: 0,
        acceptedAllocations: 0,
        declinedAllocations: 0,
        openRooms: 0,
        activeProjects: 0,
      });
      expect(body.trend.rangeDays).toBe(7);
      expect(body.trend.points).toHaveLength(7);
      expect(
        body.trend.points.reduce(
          (sum: number, p: { reported: number }) => sum + p.reported,
          0,
        ),
      ).toBe(6);
      expect(
        body.trend.points.reduce(
          (sum: number, p: { resolved: number }) => sum + p.resolved,
          0,
        ),
      ).toBe(1);
      // Most severe first, oldest first within a band.
      expect(
        body.reviewQueue.map((item: { title: string }) => item.title.replace(TITLE, '')),
      ).toEqual([
        'Burst water main',
        'Pothole near the bus depot',
        'Another pothole by the depot',
      ]);
    });

    it('accepts only the supported trend ranges', async () => {
      expect(
        (await get(`/${PREFIX}pune/dashboard`).expect(200)).body.data.trend.points,
      ).toHaveLength(30);
      await get(`/${PREFIX}pune/dashboard?range=5`).expect(400);
    });
  });

  // ======================================================== review queue

  describe('Review queue', () => {
    it('defaults to problems awaiting review', async () => {
      const response = await get(`/${PREFIX}pune/problems`).expect(200);
      expect(response.body.data.totalCount).toBe(3);
      const item = response.body.data.items.find(
        (entry: { publicId: string }) => entry.publicId === problems.p1!.publicId,
      );
      expect(item.ai).toEqual({
        status: 'COMPLETED',
        category: 'POTHOLES',
        subcategory: 'Road surface cavity',
        confidence: 0.94,
      });
      expect(item.duplicates).toEqual({ possible: 1, confirmedOf: null });
      expect(item).not.toHaveProperty('reporterId');
    });

    it.each([
      ['status=VERIFIED&view=all', ['Overflowing bin']],
      ['severity=CRITICAL', ['Burst water main']],
      [
        'category=POTHOLES',
        ['Another pothole by the depot', 'Pothole near the bus depot'],
      ],
      ['subcategory=nothing', []],
      ['duplicate=possible', ['Pothole near the bus depot']],
      ['aiStatus=completed', ['Pothole near the bus depot']],
      ['aiStatus=none', ['Another pothole by the depot', 'Burst water main']],
      ['area=p7%20Lane', ['Another pothole by the depot']],
      ['q=burst', ['Burst water main']],
      ['q=depot', ['Another pothole by the depot', 'Pothole near the bus depot']],
    ])('filters by %s', async (query, expected) => {
      const response = await get(`/${PREFIX}pune/problems?${query}`).expect(200);
      expect(titles(response.body.data.items)).toEqual(expected);
    });

    it('finds a problem by its reference', async () => {
      const response = await get(
        `/${PREFIX}pune/problems?view=all&q=${problems.p6!.publicId.toLowerCase()}`,
      ).expect(200);
      expect(titles(response.body.data.items)).toEqual(['Not a civic issue']);
    });

    it('filters by reported date', async () => {
      const today = new Date().toISOString().slice(0, 10);
      expect(
        (await get(`/${PREFIX}pune/problems?view=all&reportedFrom=${today}`).expect(200))
          .body.data.totalCount,
      ).toBe(6);
      expect(
        (await get(`/${PREFIX}pune/problems?view=all&reportedTo=2020-01-01`).expect(200))
          .body.data.totalCount,
      ).toBe(0);
    });

    it('paginates on the server', async () => {
      const first = await get(
        `/${PREFIX}pune/problems?view=all&sort=newest&limit=4`,
      ).expect(200);
      const second = await get(
        `/${PREFIX}pune/problems?view=all&sort=newest&limit=4&page=2`,
      ).expect(200);
      expect(first.body.data).toMatchObject({ totalCount: 6, totalPages: 2 });
      expect(first.body.data.items).toHaveLength(4);
      expect(second.body.data.items).toHaveLength(2);
      const all = [...first.body.data.items, ...second.body.data.items].map(
        (item: { publicId: string }) => item.publicId,
      );
      expect(new Set(all).size).toBe(6);
    });

    it.each([
      'status=DRAFT',
      'severity=EXTREME',
      'limit=500',
      'q=x',
      'sort=random',
      'reportedFrom=yesterday',
    ])('rejects %s', async (query) => {
      await get(`/${PREFIX}pune/problems?${query}`).expect(400);
    });

    it('treats an injection attempt as text', async () => {
      const response = await get(
        `/${PREFIX}pune/problems?view=all&q=${encodeURIComponent("x' OR '1'='1")}`,
      ).expect(200);
      expect(response.body.data.totalCount).toBe(0);
    });
  });

  // ============================================================== detail

  describe('Problem detail', () => {
    it('brings together the report, AI analysis, duplicates, community and location', async () => {
      const response = await get(
        `/${PREFIX}pune/problems/${problems.p1!.publicId}`,
      ).expect(200);
      const body = response.body.data;

      expect(body.problem).toMatchObject({
        publicId: problems.p1!.publicId,
        status: 'SUBMITTED',
        severity: 'HIGH',
        location: { city: 'Pune', latitude: 18.53, longitude: 73.85 },
      });
      expect(body.analysis).toMatchObject({
        status: 'COMPLETED',
        modelName: 'samadhaan-vision',
        modelVersion: 'v1.2',
        confidence: 0.94,
        summary: 'Large road damage creating a safety hazard.',
        observations: ['A deep cavity in the carriageway.'],
      });
      expect(body.duplicates.possible).toEqual([
        expect.objectContaining({
          publicId: problems.p7!.publicId,
          similarity: 0.87,
          verdict: 'LIKELY_DUPLICATE',
          signals: { text: 0.81, geographic: 0.95, category: 1, image: null },
        }),
      ]);
      expect(body.duplicates.possible[0].distanceMeters).toBeGreaterThan(250);
      expect(body.duplicates.possible[0].distanceMeters).toBeLessThan(350);
      expect(body.community).toMatchObject({ supporters: 0, followers: 0, comments: 0 });
      expect(
        body.nearby.items.map((item: { publicId: string }) => item.publicId),
      ).toContain(problems.p7!.publicId);
      expect(
        body.nearby.items.map((item: { publicId: string }) => item.publicId),
      ).not.toContain(problems.n1!.publicId);
      expect(body.allowedTransitions).toEqual(['UNDER_REVIEW']);
      expect(JSON.stringify(body)).not.toMatch(
        /citizen@samadhaan\.dev|passwordHash|reporterId/,
      );
    });
  });

  // ========================================================= transitions

  describe('Status transitions', () => {
    it('moves a report to review, then verifies it — and nothing else', async () => {
      await patchStatus('pune', 'p1', { status: 'VERIFIED' }).expect(409);
      await patchStatus('pune', 'p1', { status: 'RESOLVED' }).expect(409);

      const review = await patchStatus('pune', 'p1', { status: 'UNDER_REVIEW' }).expect(
        200,
      );
      expect(review.body.data).toEqual({
        status: 'UNDER_REVIEW',
        allowedTransitions: ['VERIFIED', 'REJECTED'],
      });

      await patchStatus('pune', 'p1', { status: 'REJECTED' }).expect(400);

      await patchStatus('pune', 'p1', {
        status: 'VERIFIED',
        note: 'Verified by the municipal review team.',
      }).expect(200);

      // Later lifecycle steps belong to allocation and resolution.
      await patchStatus('pune', 'p1', { status: 'IN_PROGRESS' }).expect(409);
      await patchStatus('pune', 'p1', { status: 'RESOLVED' }).expect(409);

      const stored = await prisma.problem.findUniqueOrThrow({
        where: { id: problems.p1!.id },
      });
      expect(stored.status).toBe('VERIFIED');
    });

    it('records who, what, when, and why in the audit trail', async () => {
      const entries = await prisma.auditLog.findMany({
        where: { entityId: problems.p1!.id, action: 'PROBLEM_STATUS_CHANGED' },
        orderBy: { createdAt: 'asc' },
      });
      expect(entries.map((entry) => entry.metadata)).toEqual([
        expect.objectContaining({ from: 'SUBMITTED', to: 'UNDER_REVIEW', note: null }),
        expect.objectContaining({
          from: 'UNDER_REVIEW',
          to: 'VERIFIED',
          note: 'Verified by the municipal review team.',
          organizationId: orgIds.pune,
        }),
      ]);

      const audit = await get(
        `/${PREFIX}pune/problems/${problems.p1!.publicId}/audit`,
      ).expect(200);
      expect(audit.body.data[0]).toMatchObject({
        kind: 'STATUS_CHANGED',
        fromStatus: 'UNDER_REVIEW',
        toStatus: 'VERIFIED',
        actor: { kind: 'TEAM', name: 'S. Krishnan' },
        note: 'Verified by the municipal review team.',
      });

      // The overlapping office sees that it happened, but not who or why.
      const other = await get(
        `/${PREFIX}overlap/problems/${problems.p1!.publicId}/audit`,
      ).expect(200);
      expect(other.body.data[0]).toMatchObject({ actor: { kind: 'TEAM' }, note: null });
    });

    it('tells the reporter, in plain words', async () => {
      await bus.drain();
      const notification = await prisma.notification.findFirstOrThrow({
        where: {
          recipientId: reporterId,
          entityId: problems.p1!.id,
          title: 'Your problem was verified',
        },
      });
      expect(notification.message).toBe(
        `${problems.p1!.publicId} has been verified by E2E pune Office.`,
      );
      expect(notification.message).not.toContain('municipal review team');
    });

    it('requires a reason to reject, and tells the reporter without it', async () => {
      await patchStatus('pune', 'p7', { status: 'UNDER_REVIEW' }).expect(200);
      await patchStatus('pune', 'p7', { status: 'REJECTED', note: '' }).expect(400);
      await patchStatus('pune', 'p7', {
        status: 'REJECTED',
        note: 'Duplicate of the depot pothole, already verified.',
      }).expect(200);

      await bus.drain();
      const notification = await prisma.notification.findFirstOrThrow({
        where: {
          recipientId: reporterId,
          entityId: problems.p7!.id,
          title: 'Your report was not accepted',
        },
      });
      expect(notification.message).not.toContain('depot pothole');
    });

    it('lets only one of two simultaneous decisions win', async () => {
      const [a, b] = await Promise.all([
        patchStatus('pune', 'p2', { status: 'VERIFIED' }),
        patchStatus('pune', 'p2', { status: 'REJECTED', note: 'Not ours.' }),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
    });

    it('refuses officials of other jurisdictions, and everyone else', async () => {
      await patchStatus('nagpur', 'p3', { status: 'UNDER_REVIEW' }, official2).expect(
        404,
      );
      await patchStatus('pune', 's1', { status: 'UNDER_REVIEW' }).expect(404);
      await patchStatus('pune', 'n1', { status: 'UNDER_REVIEW' }).expect(404);
      await patchStatus('pune', 'n1', { status: 'UNDER_REVIEW' }, citizen).expect(403);
      await patchStatus('pune', 'n1', { status: 'UNDER_REVIEW' }, admin).expect(403);
      const untouched = await prisma.problem.findUniqueOrThrow({
        where: { id: problems.n1!.id },
      });
      expect(untouched.status).toBe('SUBMITTED');
    });

    it('rejects an unknown status value', async () => {
      await patchStatus('pune', 'p3', { status: 'ALLOCATED' }).expect(400);
    });
  });

  // ================================================================ notes

  describe('Internal notes', () => {
    const NOTE = 'Site inspection required before allocation.';

    it('are kept for the office that wrote them', async () => {
      await request(server)
        .post(`/api/v1/government/${PREFIX}pune/problems/${problems.p3!.publicId}/notes`)
        .set('Cookie', official)
        .send({ body: NOTE })
        .expect(201);

      const ours = await get(`/${PREFIX}pune/problems/${problems.p3!.publicId}`).expect(
        200,
      );
      expect(ours.body.data.notes).toEqual([
        expect.objectContaining({
          body: NOTE,
          visibility: 'INTERNAL',
          author: { name: 'S. Krishnan' },
        }),
      ]);

      // Same official, same problem, different office: not visible.
      const overlap = await get(
        `/${PREFIX}overlap/problems/${problems.p3!.publicId}`,
      ).expect(200);
      expect(overlap.body.data.notes).toEqual([]);
    });

    it('never reach citizens or public endpoints', async () => {
      for (const path of [
        `/api/v1/problems/${problems.p3!.publicId}`,
        `/api/v1/problems/${problems.p3!.publicId}/analysis`,
        `/api/v1/problems/${problems.p3!.publicId}/comments`,
        `/api/v1/problems/${problems.p3!.publicId}/engagement`,
      ]) {
        const response = await request(server).get(path).set('Cookie', citizen);
        expect(JSON.stringify(response.body)).not.toContain('Site inspection');
      }
      await request(server)
        .post(`/api/v1/government/${PREFIX}pune/problems/${problems.p3!.publicId}/notes`)
        .set('Cookie', citizen)
        .send({ body: 'Sneaky' })
        .expect(403);
    });

    it('are audited without copying the text', async () => {
      const entry = await prisma.auditLog.findFirstOrThrow({
        where: { entityId: problems.p3!.id, action: 'PROBLEM_NOTE_ADDED' },
      });
      expect(JSON.stringify(entry.metadata)).not.toContain('Site inspection');
    });

    it('are validated', async () => {
      await request(server)
        .post(`/api/v1/government/${PREFIX}pune/problems/${problems.p3!.publicId}/notes`)
        .set('Cookie', official)
        .send({ body: 'x'.repeat(2001) })
        .expect(400);
    });
  });

  // ============================================================= activity

  describe('Activity', () => {
    it('is real audit data, newest first, for this jurisdiction', async () => {
      const response = await get(`/${PREFIX}pune/activity`).expect(200);
      const entries = response.body.data as Array<{
        kind: string;
        problemPublicId: string;
        createdAt: string;
      }>;
      expect(entries.length).toBeGreaterThanOrEqual(5);
      expect(entries.map((e) => e.createdAt)).toEqual(
        entries
          .map((e) => e.createdAt)
          .sort()
          .reverse(),
      );
      expect(entries.some((e) => e.kind === 'NOTE_ADDED')).toBe(true);
      expect(entries.map((e) => e.problemPublicId)).not.toContain(problems.n1!.publicId);
      expect(JSON.stringify(entries)).not.toContain('"note"');

      const nagpur = await get(`/${PREFIX}nagpur/activity`, official2).expect(200);
      expect(nagpur.body.data).toEqual([]);
    });
  });

  // ================================================================== map

  describe('Map', () => {
    const box = (bbox: [number, number, number, number]) =>
      `west=${bbox[0]}&south=${bbox[1]}&east=${bbox[2]}&north=${bbox[3]}`;

    it('returns only problems inside the jurisdiction', async () => {
      const response = await get(`/${PREFIX}pune/map?${box(PUNE)}`).expect(200);
      const ids = response.body.data.features.map((f: { id: string }) => f.id);
      expect(ids).toEqual(
        expect.arrayContaining([problems.p1!.publicId, problems.p3!.publicId]),
      );
      expect(ids).not.toContain(problems.draft!.publicId);
      expect(ids).not.toContain(problems.p6!.publicId);
    });

    it('stays inside the jurisdiction whatever viewport is asked for', async () => {
      const response = await get(`/${PREFIX}pune/map?${box(NAGPUR)}`).expect(200);
      expect(response.body.data.features).toEqual([]);
      const cells = await get(
        `/${PREFIX}pune/map/aggregate?west=72&south=17&east=80&north=22`,
      ).expect(200);
      expect(cells.body.data.totalCount).toBeLessThanOrEqual(5);
    });

    it('filters by review status, severity, duplicates and AI status', async () => {
      const rejected = await get(
        `/${PREFIX}pune/map?${box(PUNE)}&status=REJECTED`,
      ).expect(200);
      expect(rejected.body.data.features.map((f: { id: string }) => f.id)).toEqual(
        expect.arrayContaining([problems.p6!.publicId]),
      );
      const ai = await get(`/${PREFIX}pune/map?${box(PUNE)}&aiStatus=completed`).expect(
        200,
      );
      expect(ai.body.data.features.map((f: { id: string }) => f.id)).toEqual([
        problems.p1!.publicId,
      ]);
      await get(`/${PREFIX}pune/map?${box(PUNE)}&status=DRAFT`).expect(400);
      await get(`/${PREFIX}nagpur/map?${box(PUNE)}`).expect(404);
    });
  });
});
