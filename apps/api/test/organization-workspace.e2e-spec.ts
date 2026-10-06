import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AiService } from '../src/ai/ai.service.js';
import { configureApp, registerNotFoundHandler } from '../src/bootstrap.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { RedisService } from '../src/redis/redis.service.js';
import { deleteAuditLogs } from './audit-maintenance.js';

/**
 * The organisation workspace end to end: membership authorisation, the role
 * hierarchy, invitations, and deterministic problem discovery against real
 * PostGIS.
 *
 * The suite builds its own organisations and problems around Kochi, far from
 * the development seed in Gurugram and Jaipur, so every count is exact:
 *
 *   E2E Workspace Trust (NGO, at 9.97 N 76.28 E)
 *     OWNER  ngo@          ADMIN  industry@          MEMBER university@
 *     Expertise: DRAINAGE (specialist, "Stormwater drainage"), WATER (interested)
 *
 *   E2E City Collective (UNIVERSITY, city Kochi, no coordinates)
 *     OWNER  ngo@          Expertise: ROADS
 */
describe('Organisation workspace (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let server: Parameters<typeof request>[0];

  const PASSWORD = 'DevPassword123!';
  const startedAt = new Date(Date.now() - 1000);

  const TRUST = 'e2e-workspace-trust';
  const COLLECTIVE = 'e2e-city-collective';
  const ORIGIN = { latitude: 9.97, longitude: 76.28 };

  let trustId: string;
  let collectiveId: string;
  const problemIds: string[] = [];
  const publicIds: Record<string, string> = {};
  const userIds: Record<string, string> = {};

  let owner: string[];
  let admin: string[];
  let member: string[];
  let citizen: string[];
  let platformAdmin: string[];
  let government: string[];

  const membershipIds: Record<string, string> = {};

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

    for (const email of [
      'ngo@samadhaan.dev',
      'industry@samadhaan.dev',
      'university@samadhaan.dev',
      'citizen@samadhaan.dev',
      'citizen2@samadhaan.dev',
      'citizen3@samadhaan.dev',
    ]) {
      userIds[email] = (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
    }

    await cleanUp();

    const trust = await prisma.organization.create({
      data: {
        name: 'E2E Workspace Trust',
        slug: TRUST,
        type: 'NGO',
        description: 'Created by the workspace e2e suite.',
        email: 'contact@e2e-trust.example',
        phone: '+91 98765 43210',
        city: 'Kochi',
        state: 'Kerala',
        latitude: ORIGIN.latitude,
        longitude: ORIGIN.longitude,
        verificationStatus: 'PENDING',
      },
    });
    trustId = trust.id;

    const collective = await prisma.organization.create({
      data: {
        name: 'E2E City Collective',
        slug: COLLECTIVE,
        type: 'UNIVERSITY',
        city: 'Kochi',
        state: 'Kerala',
        verificationStatus: 'VERIFIED',
      },
    });
    collectiveId = collective.id;

    for (const [email, role] of [
      ['ngo@samadhaan.dev', 'OWNER'],
      ['industry@samadhaan.dev', 'ADMIN'],
      ['university@samadhaan.dev', 'MEMBER'],
    ] as const) {
      const row = await prisma.organizationMember.create({
        data: {
          organizationId: trustId,
          userId: userIds[email]!,
          membershipRole: role,
          status: 'ACTIVE',
          joinedAt: new Date(),
        },
      });
      membershipIds[email] = row.id;
    }
    await prisma.organizationMember.create({
      data: {
        organizationId: collectiveId,
        userId: userIds['ngo@samadhaan.dev']!,
        membershipRole: 'OWNER',
        status: 'ACTIVE',
        joinedAt: new Date(),
      },
    });

    await prisma.organizationExpertise.createMany({
      data: [
        {
          organizationId: trustId,
          category: 'DRAINAGE',
          subcategory: 'Stormwater drainage',
          level: 'SPECIALIST',
        },
        { organizationId: trustId, category: 'WATER', level: 'INTERESTED' },
        { organizationId: collectiveId, category: 'ROADS', level: 'EXPERIENCED' },
      ],
    });

    // ~0.8 km from the trust. Its specialism, and it has an AI analysis.
    await seed('NEAR-DRAIN', {
      latitude: 9.975,
      longitude: 76.285,
      category: 'DRAINAGE',
      subcategory: 'Stormwater drainage',
      severity: 'HIGH',
    });
    // ~0.3 km. Not an area of work.
    await seed('NEAR-ROADS', {
      latitude: 9.972,
      longitude: 76.282,
      category: 'ROADS',
      severity: 'CRITICAL',
    });
    // ~9 km, twenty days old, in Aluva.
    await seed('MID-WATER', {
      latitude: 10.05,
      longitude: 76.3,
      category: 'WATER',
      severity: 'MEDIUM',
      status: 'IN_PROGRESS',
      city: 'Aluva',
      daysAgo: 20,
    });
    // ~61 km, in Thrissur — outside the 25 km service area.
    await seed('FAR-DRAIN', {
      latitude: 10.52,
      longitude: 76.21,
      category: 'DRAINAGE',
      severity: 'LOW',
      city: 'Thrissur',
    });
    // Near, but literal "%" in its subcategory — for LIKE escaping.
    await seed('PCT', {
      latitude: 9.968,
      longitude: 76.279,
      category: 'GARBAGE',
      subcategory: 'Bins 100% full',
      severity: 'LOW',
    });
    // Resolved: hidden unless asked for. Draft: never shown.
    await seed('RESOLVED-DRAIN', {
      latitude: 9.971,
      longitude: 76.281,
      category: 'DRAINAGE',
      severity: 'MEDIUM',
      status: 'RESOLVED',
    });
    await seed('DRAFT-DRAIN', {
      latitude: 9.971,
      longitude: 76.281,
      category: 'DRAINAGE',
      severity: 'HIGH',
      status: 'DRAFT',
    });

    await prisma.problemAiAnalysis.create({
      data: {
        problemId: problemIds[0]!,
        modelName: 'e2e',
        modelVersion: '1',
        analysisType: 'INITIAL_ANALYSIS',
        processingStatus: 'COMPLETED',
        category: 'DRAINAGE',
        subcategory: 'Blocked stormwater drain',
        severity: 'HIGH',
        confidence: 0.94,
        summary: 'A blocked drain.',
        rawResult: { reasoning: 'internal chain of thought must never leave the API' },
      },
    });

    // A team member supports one of them.
    await prisma.problemVote.create({
      data: { problemId: problemIds[1]!, userId: userIds['university@samadhaan.dev']! },
    });

    await clearRateLimits();
    owner = await loginAs('ngo@samadhaan.dev');
    admin = await loginAs('industry@samadhaan.dev');
    member = await loginAs('university@samadhaan.dev');
    citizen = await loginAs('citizen@samadhaan.dev');
    platformAdmin = await loginAs('admin@samadhaan.dev');
    government = await loginAs('government@samadhaan.dev');
  });

  beforeEach(clearRateLimits);

  afterAll(async () => {
    if (prisma) await cleanUp();
    await app?.close();
  });

  async function cleanUp(): Promise<void> {
    const orgs = await prisma.organization.findMany({
      where: { slug: { in: [TRUST, COLLECTIVE] } },
      select: { id: true },
    });
    const ids = orgs.map((org) => org.id);
    await deleteAuditLogs(prisma, { entityType: 'Organization', entityId: { in: ids } });
    await prisma.organization.deleteMany({ where: { id: { in: ids } } });
    await prisma.problem.deleteMany({
      where: { title: { startsWith: 'Workspace probe ' } },
    });
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

  async function seed(
    marker: string,
    input: {
      latitude: number;
      longitude: number;
      category: string;
      severity: string;
      subcategory?: string;
      status?: string;
      city?: string;
      daysAgo?: number;
    },
  ): Promise<void> {
    const problem = await prisma.problem.create({
      data: {
        reporterId: userIds['citizen@samadhaan.dev']!,
        title: `Workspace probe ${marker}`,
        description: `${marker} — created by the workspace e2e suite.`,
        category: input.category as never,
        subcategory: input.subcategory ?? null,
        severity: input.severity as never,
        status: (input.status ?? 'SUBMITTED') as never,
        latitude: input.latitude,
        longitude: input.longitude,
        address: `${marker} Road, Ernakulam`,
        city: input.city ?? 'Kochi',
        state: 'Kerala',
        ...(input.daysAgo
          ? { createdAt: new Date(Date.now() - input.daysAgo * 86_400_000) }
          : {}),
      },
    });
    problemIds.push(problem.id);
    publicIds[marker] = problem.publicId;
  }

  type Item = {
    publicId: string;
    title: string;
    distanceMeters: number | null;
    relevance: { reasons: string[]; expertiseLevel: string | null };
    ai: Record<string, unknown> | null;
  } & Record<string, unknown>;

  async function problemsOf(
    cookies: string[],
    params: Record<string, string | number> = {},
    slug = TRUST,
  ) {
    const query = new URLSearchParams(
      Object.entries(params).map(([key, value]) => [key, String(value)]),
    ).toString();
    const response = await request(server)
      .get(`/api/v1/organizations/${slug}/problems${query ? `?${query}` : ''}`)
      .set('Cookie', cookies)
      .expect(200);
    return response.body.data as {
      items: Item[];
      page: number;
      limit: number;
      totalCount: number;
      totalPages: number;
      origin: { kind: string; radiusMeters: number | null };
    };
  }

  const markers = (items: Item[]) =>
    items.map((item) => item.title.replace('Workspace probe ', ''));

  // ========================================================== access chain

  describe('GET /organizations/mine', () => {
    it('requires a session', async () => {
      await request(server).get('/api/v1/organizations/mine').expect(401);
    });

    it('lists every workspace a multi-organisation user belongs to', async () => {
      const response = await request(server)
        .get('/api/v1/organizations/mine')
        .set('Cookie', owner)
        .expect(200);

      const slugs = response.body.data.workspaces.map((w: { slug: string }) => w.slug);
      expect(slugs).toEqual(expect.arrayContaining([TRUST, COLLECTIVE]));
      const trust = response.body.data.workspaces.find(
        (w: { slug: string }) => w.slug === TRUST,
      );
      expect(trust).toMatchObject({
        type: 'NGO',
        membershipRole: 'OWNER',
        isAccessible: true,
      });
    });

    it('is empty for a citizen with no memberships', async () => {
      const response = await request(server)
        .get('/api/v1/organizations/mine')
        .set('Cookie', citizen)
        .expect(200);
      expect(response.body.data).toEqual({ workspaces: [], invitations: [] });
    });

    it('leaves government offices out — they have their own workspace', async () => {
      const response = await request(server)
        .get('/api/v1/organizations/mine')
        .set('Cookie', government)
        .expect(200);
      expect(response.body.data.workspaces).toEqual([]);
    });
  });

  describe('GET /organizations/:slug/workspace', () => {
    it('gives an owner full management permissions', async () => {
      const response = await request(server)
        .get(`/api/v1/organizations/${TRUST}/workspace`)
        .set('Cookie', owner)
        .expect(200);

      const body = response.body.data;
      expect(body.membership.membershipRole).toBe('OWNER');
      expect(body.permissions).toEqual({
        canEditProfile: true,
        canManageExpertise: true,
        canManageMembers: true,
        assignableRoles: ['OWNER', 'ADMIN', 'MEMBER'],
      });
      // A member sees their own contact details even while unverified.
      expect(body.organization.email).toBe('contact@e2e-trust.example');
      expect(body.coordinates).toEqual(ORIGIN);
    });

    it('lets an admin manage, but not grant ownership', async () => {
      const response = await request(server)
        .get(`/api/v1/organizations/${TRUST}/workspace`)
        .set('Cookie', admin)
        .expect(200);
      expect(response.body.data.permissions.assignableRoles).toEqual(['ADMIN', 'MEMBER']);
    });

    it('gives a member read access only', async () => {
      const response = await request(server)
        .get(`/api/v1/organizations/${TRUST}/workspace`)
        .set('Cookie', member)
        .expect(200);
      expect(response.body.data.permissions).toEqual({
        canEditProfile: false,
        canManageExpertise: false,
        canManageMembers: false,
        assignableRoles: [],
      });
    });

    it('returns 404 to a signed-in non-member', async () => {
      await request(server)
        .get(`/api/v1/organizations/${TRUST}/workspace`)
        .set('Cookie', citizen)
        .expect(404);
    });

    // IDOR: belonging to one organisation opens no other.
    it('returns 404 for another organisation the user does not belong to', async () => {
      await request(server)
        .get('/api/v1/organizations/institute-of-urban-systems/workspace')
        .set('Cookie', owner)
        .expect(404);
      await request(server)
        .get(`/api/v1/organizations/institute-of-urban-systems/dashboard`)
        .set('Cookie', owner)
        .expect(404);
      await request(server)
        .get(`/api/v1/organizations/institute-of-urban-systems/problems`)
        .set('Cookie', owner)
        .expect(404);
    });

    it('does not open for a platform admin who is not a member', async () => {
      await request(server)
        .get(`/api/v1/organizations/${TRUST}/workspace`)
        .set('Cookie', platformAdmin)
        .expect(404);
    });

    it('does not open a government office, even to its owner', async () => {
      await request(server)
        .get('/api/v1/organizations/ward-12-municipal-office/workspace')
        .set('Cookie', government)
        .expect(404);
    });

    it('returns 404 for an unknown slug', async () => {
      await request(server)
        .get('/api/v1/organizations/no-such-organisation/workspace')
        .set('Cookie', owner)
        .expect(404);
    });

    it('requires a session', async () => {
      await request(server).get(`/api/v1/organizations/${TRUST}/workspace`).expect(401);
    });

    it('closes for a suspended membership', async () => {
      await prisma.organizationMember.update({
        where: { id: membershipIds['university@samadhaan.dev']! },
        data: { status: 'SUSPENDED' },
      });
      try {
        await request(server)
          .get(`/api/v1/organizations/${TRUST}/workspace`)
          .set('Cookie', member)
          .expect(404);
      } finally {
        await prisma.organizationMember.update({
          where: { id: membershipIds['university@samadhaan.dev']! },
          data: { status: 'ACTIVE' },
        });
      }
    });

    it('tells a member their organisation is suspended, and freezes management', async () => {
      await prisma.organization.update({
        where: { id: trustId },
        data: { verificationStatus: 'SUSPENDED' },
      });
      try {
        const response = await request(server)
          .get(`/api/v1/organizations/${TRUST}/dashboard`)
          .set('Cookie', owner)
          .expect(403);
        expect(response.body.error.message).toMatch(/suspended/i);

        const mine = await request(server)
          .get('/api/v1/organizations/mine')
          .set('Cookie', owner)
          .expect(200);
        expect(
          mine.body.data.workspaces.find((w: { slug: string }) => w.slug === TRUST)
            .isAccessible,
        ).toBe(false);

        await request(server)
          .patch(`/api/v1/organizations/${trustId}`)
          .set('Cookie', owner)
          .send({ description: 'Still here.' })
          .expect(403);

        // A platform admin can still act on it.
        await request(server)
          .patch(`/api/v1/organizations/${trustId}`)
          .set('Cookie', platformAdmin)
          .send({ description: 'Created by the workspace e2e suite.' })
          .expect(200);
      } finally {
        await prisma.organization.update({
          where: { id: trustId },
          data: { verificationStatus: 'PENDING' },
        });
      }
    });

    it('closes for a deactivated organisation', async () => {
      await prisma.organization.update({
        where: { id: trustId },
        data: { isActive: false },
      });
      try {
        await request(server)
          .get(`/api/v1/organizations/${TRUST}/problems`)
          .set('Cookie', member)
          .expect(403);
      } finally {
        await prisma.organization.update({
          where: { id: trustId },
          data: { isActive: true },
        });
      }
    });
  });

  // ===================================================== problem discovery

  describe('GET /organizations/:slug/problems', () => {
    it('lists opportunities: an area of work, inside the service area', async () => {
      const page = await problemsOf(member, { scope: 'relevant' });

      // Specialist drainage before interested water; far drainage, roads,
      // resolved and draft all excluded.
      expect(markers(page.items)).toEqual(['NEAR-DRAIN', 'MID-WATER']);
      expect(page.totalCount).toBe(2);
      expect(page.items[0]!.relevance).toEqual({
        reasons: ['EXPERTISE_MATCH', 'SUBCATEGORY_MATCH', 'IN_SERVICE_AREA'],
        expertiseLevel: 'SPECIALIST',
      });
    });

    it('orders everything nearby by explainable relevance', async () => {
      const page = await problemsOf(member, { radiusMeters: 50_000 });

      expect(markers(page.items)).toEqual([
        'NEAR-DRAIN',
        'MID-WATER',
        'NEAR-ROADS',
        'PCT',
      ]);
      expect(page.items[2]!.relevance).toEqual({
        reasons: ['IN_SERVICE_AREA'],
        expertiseLevel: null,
      });
      expect(page.origin).toEqual({ kind: 'organization', radiusMeters: 50_000 });
    });

    it('measures distance from the organisation with PostGIS', async () => {
      const page = await problemsOf(member, { radiusMeters: 50_000, sort: 'distance' });

      const distances = page.items.map((item) => item.distanceMeters!);
      expect(distances).toEqual([...distances].sort((a, b) => a - b));
      const near = page.items.find((item) => item.title.endsWith('NEAR-DRAIN'))!;
      expect(near.distanceMeters).toBeGreaterThan(600);
      expect(near.distanceMeters).toBeLessThan(900);
    });

    it('filters by radius', async () => {
      const page = await problemsOf(member, { radiusMeters: 5000 });
      expect(markers(page.items).sort()).toEqual(['NEAR-DRAIN', 'NEAR-ROADS', 'PCT']);
    });

    it('filters by category, severity and city', async () => {
      expect(
        markers(
          (await problemsOf(member, { category: 'DRAINAGE', city: 'kochi' })).items,
        ),
      ).toEqual(['NEAR-DRAIN']);
      expect(
        markers(
          (await problemsOf(member, { severity: 'CRITICAL', city: 'Kochi' })).items,
        ),
      ).toEqual(['NEAR-ROADS']);
      expect(markers((await problemsOf(member, { city: 'Thrissur' })).items)).toEqual([
        'FAR-DRAIN',
      ]);
    });

    it('shows resolved problems only when asked, and drafts never', async () => {
      const resolved = await problemsOf(member, { status: 'RESOLVED', city: 'Kochi' });
      expect(markers(resolved.items)).toEqual(['RESOLVED-DRAIN']);

      const all = await problemsOf(member, { radiusMeters: 50_000 });
      expect(markers(all.items)).not.toContain('DRAFT-DRAIN');
      expect(markers(all.items)).not.toContain('RESOLVED-DRAIN');
    });

    it('filters by subcategory literally, escaping wildcards', async () => {
      expect(markers((await problemsOf(member, { subcategory: '100%' })).items)).toEqual([
        'PCT',
      ]);
      // Unescaped, "%%" would match every row with a subcategory.
      expect((await problemsOf(member, { subcategory: '%%' })).totalCount).toBe(0);
      expect(
        markers(
          (await problemsOf(member, { subcategory: 'stormwater', city: 'Kochi' })).items,
        ),
      ).toEqual(['NEAR-DRAIN']);
    });

    it('filters by how recently a problem was reported', async () => {
      const week = await problemsOf(member, { scope: 'relevant', reportedWithinDays: 7 });
      expect(markers(week.items)).toEqual(['NEAR-DRAIN']);

      const month = await problemsOf(member, {
        scope: 'relevant',
        reportedWithinDays: 30,
      });
      expect(markers(month.items)).toEqual(['NEAR-DRAIN', 'MID-WATER']);
    });

    it('paginates on the server, with a consistent total', async () => {
      const first = await problemsOf(member, { radiusMeters: 50_000, limit: 3, page: 1 });
      const second = await problemsOf(member, {
        radiusMeters: 50_000,
        limit: 3,
        page: 2,
      });

      expect(first.totalCount).toBe(4);
      expect(first.totalPages).toBe(2);
      expect(first.items).toHaveLength(3);
      expect(second.items).toHaveLength(1);
      expect(markers([...first.items, ...second.items])).toEqual([
        'NEAR-DRAIN',
        'MID-WATER',
        'NEAR-ROADS',
        'PCT',
      ]);

      const beyond = await problemsOf(member, {
        radiusMeters: 50_000,
        limit: 3,
        page: 9,
      });
      expect(beyond.items).toEqual([]);
      expect(beyond.totalCount).toBe(4);
    });

    it('surfaces the AI classification without its raw output', async () => {
      const page = await problemsOf(member, { scope: 'relevant' });
      const near = page.items[0]!;

      expect(near.hasAiAnalysis).toBe(true);
      expect(near.ai).toEqual({
        category: 'DRAINAGE',
        subcategory: 'Blocked stormwater drain',
        severity: 'HIGH',
        confidence: 0.94,
      });
      expect(JSON.stringify(page)).not.toContain('chain of thought');
      expect(page.items[1]!.ai).toBeNull();
    });

    it('never exposes the reporter or exact coordinates', async () => {
      const page = await problemsOf(member, { radiusMeters: 50_000 });
      for (const item of page.items) {
        for (const key of ['reporterId', 'reporter', 'latitude', 'longitude', 'id']) {
          expect(item).not.toHaveProperty(key);
        }
      }
      expect(JSON.stringify(page)).not.toContain('citizen@samadhaan.dev');
    });

    it('uses the registered city as the service area when there are no coordinates', async () => {
      const page = await problemsOf(owner, { scope: 'relevant' }, COLLECTIVE);
      expect(markers(page.items)).toEqual(['NEAR-ROADS']);
      expect(page.items[0]!.relevance.reasons).toEqual(['EXPERTISE_MATCH', 'SAME_CITY']);
      expect(page.origin.kind).toBe('none');
      expect(page.items[0]!.distanceMeters).toBeNull();
    });

    it('refuses a distance filter when the organisation has no location', async () => {
      await request(server)
        .get(`/api/v1/organizations/${COLLECTIVE}/problems?radiusMeters=5000`)
        .set('Cookie', owner)
        .expect(400);
      await request(server)
        .get(`/api/v1/organizations/${COLLECTIVE}/problems?sort=distance`)
        .set('Cookie', owner)
        .expect(400);
    });

    it.each([
      ['category=BOGUS'],
      ['severity=EXTREME'],
      ['status=DRAFT'],
      ['limit=500'],
      ['page=0'],
      ['reportedWithinDays=3'],
      ['radiusMeters=999999'],
      ['scope=everything'],
      // The organisation comes from the path. An id in the query is refused,
      // not quietly ignored.
      [`organizationId=00000000-0000-0000-0000-000000000000`],
    ])('rejects %s', async (query) => {
      await request(server)
        .get(`/api/v1/organizations/${TRUST}/problems?${query}`)
        .set('Cookie', member)
        .expect(400);
    });

    it('treats an injection attempt as an ordinary string', async () => {
      const page = await problemsOf(member, { city: "Kochi' OR '1'='1" });
      expect(page.totalCount).toBe(0);
      expect(
        await prisma.problem.count({
          where: { title: { startsWith: 'Workspace probe ' } },
        }),
      ).toBe(7);
    });
  });

  // ============================================================= dashboard

  describe('GET /organizations/:slug/dashboard', () => {
    it('reports counts computed from the database', async () => {
      const response = await request(server)
        .get(`/api/v1/organizations/${TRUST}/dashboard`)
        .set('Cookie', owner)
        .expect(200);
      const body = response.body.data;

      const teamIds = Object.values(userIds).slice(0, 3);
      const supported = await prisma.problemVote.findMany({
        where: { userId: { in: teamIds }, problem: { deletedAt: null } },
        select: { problemId: true },
        distinct: ['problemId'],
      });

      expect(body.metrics).toEqual({
        opportunities: 2,
        newOpportunities: 1,
        problemsSupportedByTeam: supported.length,
        suggestionsMade: 0,
        suggestionsAccepted: 0,
        teamMembers: 3,
        pendingInvitations: 0,
        pendingAllocations: 0,
        activeAssignments: 0,
        openRooms: 0,
      });
      expect(body.opportunitiesByCategory).toEqual([
        { category: 'DRAINAGE', count: 1 },
        { category: 'WATER', count: 1 },
      ]);
      expect(markers(body.relevantProblems)).toEqual(['NEAR-DRAIN', 'MID-WATER']);
      // Newest first, any category, inside the service area only.
      expect(markers(body.recentProblems)).not.toContain('FAR-DRAIN');
      expect(body.recentProblems).toHaveLength(4);
      expect(markers(body.recentProblems).at(-1)).toBe('MID-WATER');
      expect(body.teamSummary.byRole).toEqual({ OWNER: 1, ADMIN: 1, MEMBER: 1 });
      expect(body.setup).toEqual({ hasExpertise: true, hasLocation: true });
    });

    it('hides pending invitations from a member who cannot manage the team', async () => {
      const response = await request(server)
        .get(`/api/v1/organizations/${TRUST}/dashboard`)
        .set('Cookie', member)
        .expect(200);
      expect(response.body.data.metrics.pendingInvitations).toBeNull();
      expect(response.body.data.viewer.membershipRole).toBe('MEMBER');
    });
  });

  // ======================================================== team management

  describe('Team management', () => {
    const roleOf = async (email: string) =>
      (
        await prisma.organizationMember.findUniqueOrThrow({
          where: { id: membershipIds[email]! },
        })
      ).membershipRole;

    it('shows the roster to a member without private account data', async () => {
      const response = await request(server)
        .get(`/api/v1/organizations/${trustId}/members`)
        .set('Cookie', member)
        .expect(200);
      expect(response.body.data).toHaveLength(3);
      expect(JSON.stringify(response.body.data)).not.toMatch(
        /@samadhaan\.dev|passwordHash/,
      );
    });

    it('refuses a member changing anyone, including promoting themselves', async () => {
      await request(server)
        .patch(
          `/api/v1/organizations/${trustId}/members/${membershipIds['university@samadhaan.dev']}`,
        )
        .set('Cookie', member)
        .send({ membershipRole: 'OWNER' })
        .expect(403);
      await request(server)
        .delete(
          `/api/v1/organizations/${trustId}/members/${membershipIds['industry@samadhaan.dev']}`,
        )
        .set('Cookie', member)
        .expect(403);
      expect(await roleOf('university@samadhaan.dev')).toBe('MEMBER');
    });

    it('refuses anyone changing their own membership', async () => {
      await request(server)
        .patch(
          `/api/v1/organizations/${trustId}/members/${membershipIds['industry@samadhaan.dev']}`,
        )
        .set('Cookie', admin)
        .send({ membershipRole: 'OWNER' })
        .expect(403);
      await request(server)
        .patch(
          `/api/v1/organizations/${trustId}/members/${membershipIds['ngo@samadhaan.dev']}`,
        )
        .set('Cookie', owner)
        .send({ membershipRole: 'MEMBER' })
        .expect(403);
      await request(server)
        .delete(
          `/api/v1/organizations/${trustId}/members/${membershipIds['ngo@samadhaan.dev']}`,
        )
        .set('Cookie', owner)
        .expect(403);
      expect(await roleOf('industry@samadhaan.dev')).toBe('ADMIN');
      expect(await roleOf('ngo@samadhaan.dev')).toBe('OWNER');
    });

    it('lets an admin manage members but never owners', async () => {
      await request(server)
        .patch(
          `/api/v1/organizations/${trustId}/members/${membershipIds['university@samadhaan.dev']}`,
        )
        .set('Cookie', admin)
        .send({ membershipRole: 'OWNER' })
        .expect(403);
      await request(server)
        .patch(
          `/api/v1/organizations/${trustId}/members/${membershipIds['ngo@samadhaan.dev']}`,
        )
        .set('Cookie', admin)
        .send({ membershipRole: 'MEMBER' })
        .expect(403);
      await request(server)
        .delete(
          `/api/v1/organizations/${trustId}/members/${membershipIds['ngo@samadhaan.dev']}`,
        )
        .set('Cookie', admin)
        .expect(403);

      await request(server)
        .patch(
          `/api/v1/organizations/${trustId}/members/${membershipIds['university@samadhaan.dev']}`,
        )
        .set('Cookie', admin)
        .send({ membershipRole: 'ADMIN' })
        .expect(200);
      expect(await roleOf('university@samadhaan.dev')).toBe('ADMIN');

      await request(server)
        .patch(
          `/api/v1/organizations/${trustId}/members/${membershipIds['university@samadhaan.dev']}`,
        )
        .set('Cookie', admin)
        .send({ membershipRole: 'MEMBER' })
        .expect(200);
      expect(await roleOf('university@samadhaan.dev')).toBe('MEMBER');
    });

    it('lets an owner share ownership, and audits the change', async () => {
      await request(server)
        .patch(
          `/api/v1/organizations/${trustId}/members/${membershipIds['industry@samadhaan.dev']}`,
        )
        .set('Cookie', owner)
        .send({ membershipRole: 'OWNER' })
        .expect(200);

      // With two owners, the second may demote the first — never themselves.
      await request(server)
        .patch(
          `/api/v1/organizations/${trustId}/members/${membershipIds['ngo@samadhaan.dev']}`,
        )
        .set('Cookie', admin)
        .send({ membershipRole: 'ADMIN' })
        .expect(200);
      expect(await roleOf('ngo@samadhaan.dev')).toBe('ADMIN');

      // Now the only owner: nobody can demote them (and they cannot demote
      // themselves).
      await request(server)
        .patch(
          `/api/v1/organizations/${trustId}/members/${membershipIds['industry@samadhaan.dev']}`,
        )
        .set('Cookie', platformAdmin)
        .send({ membershipRole: 'MEMBER' })
        .expect(409);

      // Restore.
      await request(server)
        .patch(
          `/api/v1/organizations/${trustId}/members/${membershipIds['ngo@samadhaan.dev']}`,
        )
        .set('Cookie', admin)
        .send({ membershipRole: 'OWNER' })
        .expect(200);
      await request(server)
        .patch(
          `/api/v1/organizations/${trustId}/members/${membershipIds['industry@samadhaan.dev']}`,
        )
        .set('Cookie', owner)
        .send({ membershipRole: 'ADMIN' })
        .expect(200);

      const audit = await prisma.auditLog.findMany({
        where: {
          entityId: trustId,
          action: 'ORGANIZATION_MEMBER_ROLE_CHANGED',
          createdAt: { gte: startedAt },
        },
      });
      expect(audit.length).toBeGreaterThanOrEqual(4);
      expect(JSON.stringify(audit)).not.toMatch(/@samadhaan\.dev|password/i);
    });

    it('cannot leave an organisation without an owner, even under concurrent demotions', async () => {
      await request(server)
        .patch(
          `/api/v1/organizations/${trustId}/members/${membershipIds['industry@samadhaan.dev']}`,
        )
        .set('Cookie', owner)
        .send({ membershipRole: 'OWNER' })
        .expect(200);

      // Each owner demotes the other at the same moment. The row lock means
      // at most one can win.
      const results = await Promise.all([
        request(server)
          .patch(
            `/api/v1/organizations/${trustId}/members/${membershipIds['industry@samadhaan.dev']}`,
          )
          .set('Cookie', owner)
          .send({ membershipRole: 'ADMIN' }),
        request(server)
          .patch(
            `/api/v1/organizations/${trustId}/members/${membershipIds['ngo@samadhaan.dev']}`,
          )
          .set('Cookie', admin)
          .send({ membershipRole: 'ADMIN' }),
      ]);

      const owners = await prisma.organizationMember.count({
        where: { organizationId: trustId, membershipRole: 'OWNER', status: 'ACTIVE' },
      });
      expect(owners).toBeGreaterThanOrEqual(1);
      expect(
        results.map((r) => r.status).filter((s) => s === 200).length,
      ).toBeLessThanOrEqual(1);

      // Restore: ngo@ owner, industry@ admin.
      await prisma.organizationMember.update({
        where: { id: membershipIds['ngo@samadhaan.dev']! },
        data: { membershipRole: 'OWNER' },
      });
      await prisma.organizationMember.update({
        where: { id: membershipIds['industry@samadhaan.dev']! },
        data: { membershipRole: 'ADMIN' },
      });
    });

    it('refuses a membership id from another organisation', async () => {
      const foreign = await prisma.organizationMember.findFirstOrThrow({
        where: { organization: { slug: 'institute-of-urban-systems' } },
      });
      await request(server)
        .patch(`/api/v1/organizations/${trustId}/members/${foreign.id}`)
        .set('Cookie', owner)
        .send({ membershipRole: 'MEMBER' })
        .expect(404);
      await request(server)
        .delete(`/api/v1/organizations/${trustId}/members/${foreign.id}`)
        .set('Cookie', owner)
        .expect(404);
    });

    it("refuses managing another organisation's team by changing the id", async () => {
      const institute = await prisma.organization.findUniqueOrThrow({
        where: { slug: 'institute-of-urban-systems' },
        include: { members: true },
      });
      await request(server)
        .patch(
          `/api/v1/organizations/${institute.id}/members/${institute.members[0]!.id}`,
        )
        .set('Cookie', owner)
        .send({ membershipRole: 'MEMBER' })
        .expect(403);
      await request(server)
        .post(`/api/v1/organizations/${institute.id}/invitations`)
        .set('Cookie', owner)
        .send({ email: 'citizen2@samadhaan.dev', membershipRole: 'ADMIN' })
        .expect(403);
    });
  });

  describe('Invitations', () => {
    it('refuses an invitation from a member', async () => {
      await request(server)
        .post(`/api/v1/organizations/${trustId}/invitations`)
        .set('Cookie', member)
        .send({ email: 'citizen2@samadhaan.dev', membershipRole: 'MEMBER' })
        .expect(403);
    });

    it('never invites someone straight to ownership', async () => {
      await request(server)
        .post(`/api/v1/organizations/${trustId}/invitations`)
        .set('Cookie', owner)
        .send({ email: 'citizen2@samadhaan.dev', membershipRole: 'OWNER' })
        .expect(400);
    });

    it('says when no account uses the address', async () => {
      await request(server)
        .post(`/api/v1/organizations/${trustId}/invitations`)
        .set('Cookie', owner)
        .send({ email: 'nobody-here@samadhaan.dev', membershipRole: 'MEMBER' })
        .expect(404);
    });

    it('invites, and the invitee accepts into the workspace', async () => {
      const invited = await request(server)
        .post(`/api/v1/organizations/${trustId}/invitations`)
        .set('Cookie', admin)
        .send({ email: '  Citizen2@Samadhaan.dev ', membershipRole: 'MEMBER' })
        .expect(201);
      expect(invited.body.data).toMatchObject({
        status: 'INVITED',
        membershipRole: 'MEMBER',
      });

      await request(server)
        .post(`/api/v1/organizations/${trustId}/invitations`)
        .set('Cookie', owner)
        .send({ email: 'citizen2@samadhaan.dev', membershipRole: 'MEMBER' })
        .expect(409);

      const invitee = await loginAs('citizen2@samadhaan.dev');

      // Not a member until they accept.
      await request(server)
        .get(`/api/v1/organizations/${TRUST}/workspace`)
        .set('Cookie', invitee)
        .expect(404);

      const mine = await request(server)
        .get('/api/v1/organizations/mine')
        .set('Cookie', invitee)
        .expect(200);
      expect(mine.body.data.invitations).toHaveLength(1);
      const invitation = mine.body.data.invitations[0];
      expect(invitation.organization.slug).toBe(TRUST);

      // Someone else cannot answer it.
      await request(server)
        .post(`/api/v1/organizations/invitations/${invitation.membershipId}/accept`)
        .set('Cookie', citizen)
        .expect(404);

      await request(server)
        .post(`/api/v1/organizations/invitations/${invitation.membershipId}/accept`)
        .set('Cookie', invitee)
        .expect(204);
      await request(server)
        .post(`/api/v1/organizations/invitations/${invitation.membershipId}/accept`)
        .set('Cookie', invitee)
        .expect(404);

      await request(server)
        .get(`/api/v1/organizations/${TRUST}/workspace`)
        .set('Cookie', invitee)
        .expect(200);

      // Removed, and the workspace closes again.
      await request(server)
        .delete(`/api/v1/organizations/${trustId}/members/${invitation.membershipId}`)
        .set('Cookie', owner)
        .expect(204);
      await request(server)
        .get(`/api/v1/organizations/${TRUST}/workspace`)
        .set('Cookie', invitee)
        .expect(404);
    });

    it('lets the invitee decline', async () => {
      await request(server)
        .post(`/api/v1/organizations/${trustId}/invitations`)
        .set('Cookie', owner)
        .send({ email: 'citizen3@samadhaan.dev', membershipRole: 'ADMIN' })
        .expect(201);

      const invitee = await loginAs('citizen3@samadhaan.dev');
      const mine = await request(server)
        .get('/api/v1/organizations/mine')
        .set('Cookie', invitee)
        .expect(200);

      await request(server)
        .post(
          `/api/v1/organizations/invitations/${mine.body.data.invitations[0].membershipId}/decline`,
        )
        .set('Cookie', invitee)
        .expect(204);

      const after = await request(server)
        .get('/api/v1/organizations/mine')
        .set('Cookie', invitee)
        .expect(200);
      expect(after.body.data).toEqual({ workspaces: [], invitations: [] });
    });
  });

  // ============================================================== settings

  describe('PATCH /organizations/:id (settings)', () => {
    it('refuses a member', async () => {
      await request(server)
        .patch(`/api/v1/organizations/${trustId}`)
        .set('Cookie', member)
        .send({ description: 'Taken over.' })
        .expect(403);
    });

    it('refuses verification, type and slug changes', async () => {
      for (const body of [
        { verificationStatus: 'VERIFIED' },
        { type: 'GOVERNMENT' },
        { slug: 'taken-over' },
        { isActive: false },
      ]) {
        await request(server)
          .patch(`/api/v1/organizations/${trustId}`)
          .set('Cookie', owner)
          .send(body)
          .expect(400);
      }
      const trust = await prisma.organization.findUniqueOrThrow({
        where: { id: trustId },
      });
      expect(trust).toMatchObject({
        verificationStatus: 'PENDING',
        type: 'NGO',
        slug: TRUST,
      });
    });

    it('lets an admin move the registered location, as a pair', async () => {
      await request(server)
        .patch(`/api/v1/organizations/${trustId}`)
        .set('Cookie', admin)
        .send({ latitude: 9.98 })
        .expect(400);
      await request(server)
        .patch(`/api/v1/organizations/${trustId}`)
        .set('Cookie', admin)
        .send({ latitude: null, longitude: 76.28 })
        .expect(400);

      await request(server)
        .patch(`/api/v1/organizations/${trustId}`)
        .set('Cookie', admin)
        .send({ latitude: 9.98, longitude: 76.29 })
        .expect(200);

      const workspace = await request(server)
        .get(`/api/v1/organizations/${TRUST}/workspace`)
        .set('Cookie', member)
        .expect(200);
      expect(workspace.body.data.coordinates).toEqual({
        latitude: 9.98,
        longitude: 76.29,
      });

      // The PostGIS column followed, via the trigger.
      const [row] = await prisma.$queryRaw<Array<{ hasLocation: boolean }>>`
        SELECT "location" IS NOT NULL AS "hasLocation" FROM organizations WHERE id = ${trustId}::uuid
      `;
      expect(row!.hasLocation).toBe(true);

      await request(server)
        .patch(`/api/v1/organizations/${trustId}`)
        .set('Cookie', admin)
        .send({ latitude: ORIGIN.latitude, longitude: ORIGIN.longitude })
        .expect(200);
    });

    it('audits a profile change by field name only', async () => {
      // Only rows from this request: an earlier change in the suite can share
      // a millisecond, so "latest by createdAt" alone is ambiguous.
      const since = new Date(Date.now() - 1);
      await request(server)
        .patch(`/api/v1/organizations/${trustId}`)
        .set('Cookie', owner)
        .send({ phone: '+91 90000 00000' })
        .expect(200);

      const entry = await prisma.auditLog.findFirstOrThrow({
        where: {
          entityId: trustId,
          action: 'ORGANIZATION_PROFILE_UPDATED',
          createdAt: { gte: since },
          metadata: { equals: { fields: ['phone'] } },
        },
      });
      expect(entry.metadata).toEqual({ fields: ['phone'] });
      expect(JSON.stringify(entry)).not.toContain('90000');
    });
  });
});
