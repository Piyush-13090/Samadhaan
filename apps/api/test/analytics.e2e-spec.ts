import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiService } from '../src/ai/ai.service.js';
import type { InsightRequestInput } from '../src/ai/dto/insights.dto.js';
import { addDays, localDate, zonedMidnight } from '../src/analytics/analytics-time.js';
import { AppModule } from '../src/app.module.js';
import { configureApp, registerNotFoundHandler } from '../src/bootstrap.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { RedisService } from '../src/redis/redis.service.js';
import { deleteAuditLogs } from './audit-maintenance.js';

const DAY = 86_400_000;

/**
 * Civic analytics (Prompt 24), end to end against real PostgreSQL: exact
 * aggregates over a known dataset, the office's jurisdiction as the only
 * scope, local-day bucketing, suppression of small groups, and exports and
 * insights that carry no private data.
 */
describe('Civic analytics (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let server: Parameters<typeof request>[0];

  const PASSWORD = 'DevPassword123!';
  const PREFIX = 'e2e-analytics-';
  const CITY = 'Analytipur';
  const OTHER_CITY = 'Otherpur';
  const TITLE = 'Analytics probe ';
  const EMAIL = (key: string) => `${PREFIX}${key}@samadhaan.test`;
  const OFFICE = `${PREFIX}office`;
  const BASE = `/government/${OFFICE}/analytics`;

  const users: Record<string, string> = {};
  const cookies: Record<string, string[]> = {};
  const problems: Record<string, { id: string; publicId: string }> = {};
  let officeId = '';
  let streetlightLocalDate = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    registerNotFoundHandler(app);
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);

    await cleanUp();
    const template = await prisma.user.findUniqueOrThrow({
      where: { email: 'government@samadhaan.dev' },
    });
    for (const [key, role] of [
      ['r1', 'CITIZEN'],
      ['r2', 'CITIZEN'],
      ['r3', 'CITIZEN'],
      ['official', 'GOVERNMENT'],
      ['other', 'GOVERNMENT'],
      ['member', 'CITIZEN'],
    ] as const) {
      users[key] = (
        await prisma.user.create({
          data: {
            email: EMAIL(key),
            passwordHash: template.passwordHash,
            fullName: `Analytics ${key}`,
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
        name: 'E2E Analytics Office',
        slug: OFFICE,
        type: 'GOVERNMENT',
        verificationStatus: 'VERIFIED',
        jurisdictionType: 'MUNICIPAL_CORPORATION',
        jurisdictionName: CITY,
        jurisdictionCities: [CITY],
      },
    });
    officeId = office.id;
    const otherOffice = await prisma.organization.create({
      data: {
        name: 'E2E Other Office',
        slug: `${PREFIX}other-office`,
        type: 'GOVERNMENT',
        verificationStatus: 'VERIFIED',
        jurisdictionType: 'MUNICIPAL_CORPORATION',
        jurisdictionName: OTHER_CITY,
        jurisdictionCities: [OTHER_CITY],
      },
    });
    const ngo = await prisma.organization.create({
      data: {
        name: 'E2E Analytics NGO',
        slug: `${PREFIX}ngo`,
        type: 'NGO',
        verificationStatus: 'VERIFIED',
      },
    });
    for (const [organizationId, userId] of [
      [office.id, users.official!],
      [otherOffice.id, users.other!],
      [ngo.id, users.member!],
    ]) {
      await prisma.organizationMember.create({
        data: {
          organizationId,
          userId,
          membershipRole: 'OWNER',
          status: 'ACTIVE',
          joinedAt: new Date(),
        },
      });
    }

    const now = Date.now();
    const problem = async (
      key: string,
      data: {
        reporter: string;
        category: 'DRAINAGE' | 'POTHOLES' | 'STREETLIGHTS' | 'GARBAGE';
        createdAt: Date;
        latitude: number;
        status?: 'SUBMITTED' | 'RESOLVED' | 'REJECTED' | 'DUPLICATE';
        resolvedAt?: Date;
        postalCode?: string;
        city?: string;
        title?: string;
      },
    ) => {
      const created = await prisma.problem.create({
        data: {
          reporterId: users[data.reporter]!,
          title: data.title ?? `${TITLE}${key}`,
          description: 'A test problem for civic analytics.',
          category: data.category,
          status: data.status ?? 'SUBMITTED',
          latitude: data.latitude,
          longitude: 76.0,
          city: data.city ?? CITY,
          state: 'Testland',
          postalCode: data.postalCode ?? null,
          submittedAt: data.createdAt,
          createdAt: data.createdAt,
          resolvedAt: data.resolvedAt ?? null,
        },
      });
      problems[key] = { id: created.id, publicId: created.publicId };
    };

    // The same drain, reported again and again over 20 days by two people.
    await problem('d1', {
      reporter: 'r1',
      category: 'DRAINAGE',
      createdAt: new Date(now - 25 * DAY),
      latitude: 21.0,
      postalCode: 'A1',
    });
    await problem('d2', {
      reporter: 'r2',
      category: 'DRAINAGE',
      createdAt: new Date(now - 15 * DAY),
      latitude: 21.0005,
      postalCode: 'A1',
    });
    await problem('d3', {
      reporter: 'r1',
      category: 'DRAINAGE',
      createdAt: new Date(now - 5 * DAY),
      latitude: 21.001,
      postalCode: 'A1',
    });
    // A confirmed duplicate there too: not a recurrence.
    await problem('d4', {
      reporter: 'r3',
      category: 'DRAINAGE',
      createdAt: new Date(now - 4 * DAY),
      latitude: 21.001,
      postalCode: 'A1',
      status: 'DUPLICATE',
    });
    await problem('p1', {
      reporter: 'r3',
      category: 'POTHOLES',
      createdAt: new Date(now - 10 * DAY),
      latitude: 21.01,
      postalCode: 'B2',
    });
    await problem('p2', {
      reporter: 'r3',
      category: 'POTHOLES',
      createdAt: new Date(now - 10 * DAY),
      latitude: 21.02,
      postalCode: 'B2',
    });
    await problem('p3', {
      reporter: 'r2',
      category: 'POTHOLES',
      createdAt: new Date(now - 20 * DAY),
      latitude: 21.03,
      postalCode: 'B2',
      status: 'RESOLVED',
      resolvedAt: new Date(now - 8 * DAY),
    });
    // 01:00 in Kolkata three local days ago — 19:30 UTC the day before.
    streetlightLocalDate = addDays(localDate(new Date(now), 'Asia/Kolkata'), -3);
    await problem('s1', {
      reporter: 'r2',
      category: 'STREETLIGHTS',
      createdAt: new Date(
        zonedMidnight(streetlightLocalDate, 'Asia/Kolkata').getTime() + 3_600_000,
      ),
      latitude: 21.04,
      postalCode: 'C3',
    });
    await problem('f1', {
      reporter: 'r3',
      category: 'GARBAGE',
      createdAt: new Date(now - 2 * DAY),
      latitude: 21.05,
      status: 'REJECTED',
      title: `=HYPERLINK("http://evil") ${TITLE}f1`,
    });
    // Another office's problem.
    await problem('o1', {
      reporter: 'r1',
      category: 'DRAINAGE',
      createdAt: new Date(now - 3 * DAY),
      latitude: 25.0,
      city: OTHER_CITY,
    });

    await clearKeys();
    for (const key of ['r1', 'official', 'other', 'member'])
      cookies[key] = await loginAs(EMAIL(key));
    cookies.citizen = await loginAs('citizen@samadhaan.dev');

    // Two real verifications, through the portal, so the audit trail exists.
    for (const key of ['p1', 'p2']) {
      const path = `/government/${OFFICE}/problems/${problems[key]!.publicId}/status`;
      await api('official').patch(path, { status: 'UNDER_REVIEW' }).expect(200);
      await api('official').patch(path, { status: 'VERIFIED' }).expect(200);
    }
  });

  beforeEach(async () => {
    await clearKeys();
  });

  afterAll(async () => {
    vi.restoreAllMocks();
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
        where: { title: { contains: TITLE } },
        select: { id: true },
      })
    ).map((p) => p.id);
    const orgIds = (
      await prisma.organization.findMany({
        where: { slug: { startsWith: PREFIX } },
        select: { id: true },
      })
    ).map((o) => o.id);
    await prisma.notification.deleteMany({ where: { recipientId: { in: ids } } });
    await deleteAuditLogs(prisma, {
      OR: [
        { entityId: { in: [...problemIds, ...ids, ...orgIds] } },
        { actorUserId: { in: ids } },
      ],
    });
    await prisma.problemPriorityAssessment.deleteMany({
      where: { problemId: { in: problemIds } },
    });
    await prisma.problem.deleteMany({ where: { id: { in: problemIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }

  async function clearKeys(): Promise<void> {
    const keys = [
      ...(await redis.connection.keys('ratelimit:*')),
      ...(await redis.connection.keys('analytics:*')),
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

  // =============================================================== overview

  it('counts exactly what is inside the jurisdiction and period', async () => {
    const { body } = await api('official').get(`${BASE}/overview?preset=30d`).expect(200);
    const m = body.data.metrics;
    expect(m.reported.value).toBe(9); // o1 is another office's
    expect(m.verified.value).toBe(3); // p1, p2 verified; p3 resolved
    expect(m.resolved.value).toBe(1);
    expect(m.rejected.value).toBe(1);
    expect(m.resolutionRate.value).toBe(33.3);
    // Previous period is empty: no comparison, not a fake +∞ %.
    expect(m.reported.previous).toBe(0);
    expect(m.reported.changePct).toBeNull();
    // Durations need three observations; there is one resolution.
    expect(m.avgDaysToResolution.value).toBeNull();
    expect(body.data.period).toMatchObject({ preset: '30d', timezone: 'Asia/Kolkata' });
  });

  it('narrows with filters and never widens beyond the jurisdiction', async () => {
    const drainage = await api('official')
      .get(`${BASE}/overview?category=DRAINAGE`)
      .expect(200);
    expect(drainage.body.data.metrics.reported.value).toBe(4);
    const elsewhere = await api('official')
      .get(`${BASE}/overview?city=${OTHER_CITY}`)
      .expect(200);
    expect(elsewhere.body.data.metrics.reported.value).toBe(0);
    const area = await api('official').get(`${BASE}/overview?area=b2`).expect(200);
    expect(area.body.data.metrics.reported.value).toBe(3);
  });

  // ========================================================== time zones

  it('groups by the local day of the reporting time zone (day-boundary regression)', async () => {
    const at = async (timezone: string) =>
      (
        await api('official')
          .get(`${BASE}/trends?preset=7d&category=STREETLIGHTS&timezone=${timezone}`)
          .expect(200)
      ).body.data.buckets as Array<{ start: string; reported: number }>;
    const kolkata = await at('Asia/Kolkata');
    expect(kolkata.find((b) => b.reported === 1)?.start).toBe(streetlightLocalDate);
    const utc = await at('UTC');
    expect(utc.find((b) => b.reported === 1)?.start).toBe(
      addDays(streetlightLocalDate, -1),
    );
  });

  it('returns every bucket, with events counted when they happened', async () => {
    const { body } = await api('official').get(`${BASE}/trends?preset=30d`).expect(200);
    const buckets = body.data.buckets as Array<Record<string, number>>;
    expect(buckets).toHaveLength(30);
    const total = (key: string) =>
      buckets.reduce((sum, b) => sum + (b[key] as number), 0);
    expect(total('reported')).toBe(9);
    expect(total('verified')).toBe(2); // the two audited verifications
    expect(total('resolved')).toBe(1);
  });

  // ================================================== categories and areas

  it('reports category shares and says when comparison is unavailable', async () => {
    const { body } = await api('official').get(`${BASE}/categories`).expect(200);
    const drainage = body.data.categories.find(
      (c: { category: string }) => c.category === 'DRAINAGE',
    );
    expect(drainage).toMatchObject({
      count: 4,
      share: 44.4,
      changePct: null,
      direction: 'unknown',
    });
    expect(body.data.total).toBe(9);
  });

  it('suppresses areas below the minimum group size', async () => {
    const { body } = await api('official').get(`${BASE}/areas`).expect(200);
    const postal = Object.fromEntries(
      body.data.byPostalCode.map((r: { name: string }) => [r.name, r]),
    );
    expect(postal.A1).toMatchObject({ count: 4, suppressed: false });
    expect(postal.B2).toMatchObject({ count: 3, suppressed: false });
    expect(postal.C3).toMatchObject({ count: null, open: null, suppressed: true });
    expect(body.data.jurisdiction).toMatchObject({ name: CITY, count: 9 });
  });

  // ============================================================ resolution

  it('builds a cumulative funnel and a time-to-resolution distribution', async () => {
    const { body } = await api('official').get(`${BASE}/resolution`).expect(200);
    const funnel = Object.fromEntries(
      body.data.funnel.map((s: { key: string; count: number }) => [s.key, s.count]),
    );
    expect(funnel).toEqual({
      submitted: 9,
      review: 4,
      verified: 3,
      allocated: 1,
      inProgress: 1,
      resolved: 1,
    });
    expect(
      body.data.distribution.find((d: { bucket: string }) => d.bucket === '7–14 days')
        .count,
    ).toBe(1);
    expect(body.data.summary.resolutionRate).toBe(33.3);
    expect(body.data.summary.medianDays).toBeNull(); // one observation is not enough
    expect(body.data.summary.longestOpenDays).toBeGreaterThanOrEqual(25);
  });

  // ================================================ hotspots and recurring

  it('finds the recurring drain, excluding the confirmed duplicate', async () => {
    const { body } = await api('official').get(`${BASE}/recurring`).expect(200);
    expect(body.data.clusters).toHaveLength(1);
    expect(body.data.clusters[0]).toMatchObject({
      category: 'DRAINAGE',
      reports: 3,
      distinctReporters: 2,
      area: 'A1',
    });
    expect(body.data.clusters[0].spanDays).toBeGreaterThanOrEqual(19);
  });

  it('returns hotspot cells as rounded aggregates of at least the minimum size', async () => {
    const { body } = await api('official').get(`${BASE}/hotspots`).expect(200);
    expect(body.data.algorithmVersion).toBe('grid-zscore-v1');
    expect(body.data.occupiedCells).toBe(6);
    expect(body.data.cells).toHaveLength(1);
    const [lng, lat] = body.data.cells[0].geometry.coordinates;
    expect(Number(lat.toFixed(3))).toBe(lat);
    expect(Number(lng.toFixed(3))).toBe(lng);
    expect(body.data.cells[0].properties.count).toBe(4);
    expect(JSON.stringify(body.data)).not.toMatch(/publicId|reporter|SAM-/);
  });

  // ============================================================== community

  it('summarises community participation without naming anyone', async () => {
    const { body } = await api('official').get(`${BASE}/community`).expect(200);
    expect(body.data).toMatchObject({
      reported: 9,
      verifiedReports: 3,
      confirmedDuplicates: 1,
    });
    expect(JSON.stringify(body.data)).not.toMatch(/e2e-analytics-r\d|@samadhaan/);
  });

  // ================================================================ export

  it('exports public fields only, defuses formulas, and audits the export', async () => {
    const response = await api('official')
      .get(`${BASE}/export?dataset=problems&format=csv`)
      .expect(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain(`${OFFICE}-problems-`);
    const text = response.text;
    const [header, ...lines] = text.split('\r\n');
    expect(header).toBe(
      '"problemId","title","category","severity","status","priority","city","state","postalCode","reportedOn","resolvedOn","supporters"',
    );
    expect(lines).toHaveLength(9);
    expect(text).not.toMatch(/21\.0|76\.0|e2e-analytics-r/); // no coordinates, no people
    expect(text).toContain(`"'=HYPERLINK(""http://evil"")`);

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'ANALYTICS_EXPORTED', entityId: officeId },
    });
    expect(audit?.actorUserId).toBe(users.official);
    expect(audit?.metadata).toMatchObject({ dataset: 'problems', rows: 9 });

    const json = await api('official')
      .get(`${BASE}/export?dataset=categories&format=json`)
      .expect(200);
    expect(JSON.parse(json.text)).toMatchObject({
      dataset: 'categories',
      truncated: false,
    });
  });

  // ============================================================== insights

  it('generates insights from computed facts only, and caches them', async () => {
    const ai = app.get(AiService);
    const spy = vi.spyOn(ai, 'analyticsInsights').mockImplementation(async () => ({
      ok: true,
      insight: {
        summary: 'Reports were mostly drainage.',
        observations: [
          {
            text: 'Drainage was the largest category.',
            metricKeys: ['category.DRAINAGE'],
          },
        ],
        attention: [],
        guidanceNotes: [],
        aiRan: true,
        provider: 'fake',
        modelName: 'fake',
        modelVersion: '1',
        promptVersion: 'test',
      },
    }));

    expect(
      (await api('official').get(`${BASE}/insights`).expect(200)).body.data.insight,
    ).toBeNull();
    const { body } = await api('official').post(`${BASE}/insights`).expect(200);
    const sent = spy.mock.calls[0]![0] as InsightRequestInput;
    expect(sent.facts.find((f) => f.key === 'reported')?.value).toBe('9');
    expect(JSON.stringify(sent)).not.toMatch(
      /HYPERLINK|Analytics probe|21\.0|e2e-analytics/,
    );
    expect(body.data.insight.observations[0].metricKeys).toEqual(['category.DRAINAGE']);
    expect(body.data.insight.facts.length).toBeGreaterThan(5);

    const cached = await api('official').get(`${BASE}/insights`).expect(200);
    expect(cached.body.data.insight.summary).toBe('Reports were mostly drainage.');
    spy.mockRestore();
  });

  // ============================================================ validation

  it('rejects invalid time zones, ranges and unknown parameters', async () => {
    await api('official').get(`${BASE}/overview?timezone=Mars/Base`).expect(400);
    await api('official')
      .get(`${BASE}/overview?preset=custom&from=2026-09-30&to=2026-09-01`)
      .expect(400);
    await api('official')
      .get(`${BASE}/overview?preset=custom&from=2020-01-01&to=2026-01-01`)
      .expect(400);
    await api('official').get(`${BASE}/overview?jurisdiction=everywhere`).expect(400);
    await api('official').get(`${BASE}/export?dataset=users`).expect(400);
  });

  // ================================================================ access

  it('is for this office’s officials only', async () => {
    await api('citizen').get(`${BASE}/overview`).expect(403);
    await api('member').get(`${BASE}/overview`).expect(403);
    await api('other').get(`${BASE}/overview`).expect(404); // not their office
    await api('other').get(`${BASE}/export?dataset=problems`).expect(404);
    await request(server).get(`/api/v1${BASE}/overview`).expect(401);
    const own = await api('other')
      .get(`/government/${PREFIX}other-office/analytics/overview`)
      .expect(200);
    expect(own.body.data.metrics.reported.value).toBe(1);
  });

  it('gives organisation analytics to members only, without ranking', async () => {
    const { body } = await api('member')
      .get(`/organizations/${PREFIX}ngo/analytics?preset=90d`)
      .expect(200);
    expect(body.data).toMatchObject({
      projectsCompleted: 0,
      onTimeRate: null,
      evidenceApprovalRate: null,
    });
    expect(JSON.stringify(body.data)).not.toMatch(/rank/i);
    await api('r1').get(`/organizations/${PREFIX}ngo/analytics`).expect(404);
    await api('official').get(`/organizations/${PREFIX}ngo/analytics`).expect(404);
  });

  it('gives citizens their own figures only', async () => {
    const { body } = await api('r1').get('/users/me/analytics').expect(200);
    expect(body.data).toMatchObject({ reported: 3, awaitingReview: 3, resolved: 0 }); // d1, d3, o1
  });
});
