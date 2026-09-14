import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AiService } from '../src/ai/ai.service.js';
import { configureApp, registerNotFoundHandler } from '../src/bootstrap.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { RedisService } from '../src/redis/redis.service.js';

/**
 * Citizen dashboard and problem discovery, end to end.
 *
 * Real PostGIS, real guards, real database. Problems are created directly
 * through Prisma rather than the reporting endpoint so each one has exactly the
 * coordinates, severity and age a case needs — the reporting flow is covered by
 * its own suite.
 */
describe('Discovery and dashboard (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let server: Parameters<typeof request>[0];

  const SEEDED_PASSWORD = 'DevPassword123!';
  const createdIds: string[] = [];

  /** Sector 12 market, Gurugram — the origin every distance is measured from. */
  const ORIGIN = { latitude: 28.4595, longitude: 77.0266 };

  let citizenId: string;
  let otherCitizenId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      // Creating a problem queues analysis and a duplicate check. Neither is
      // under test here, and both would otherwise reach a real AI service.
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

    await clearRateLimits();

    const [citizen, other] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { email: 'citizen@samadhaan.dev' } }),
      prisma.user.findUniqueOrThrow({ where: { email: 'citizen2@samadhaan.dev' } }),
    ]);
    citizenId = citizen.id;
    otherCitizenId = other.id;

    // A controlled set at known distances from ORIGIN.
    await seed('E2E-NEAR', {
      reporterId: citizenId,
      title: 'Discovery probe: pothole 50 m away',
      category: 'POTHOLES',
      severity: 'HIGH',
      status: 'SUBMITTED',
      latitude: 28.45995,
      longitude: 77.0266,
      daysAgo: 1,
      voteCount: 10,
    });
    await seed('E2E-MID', {
      reporterId: citizenId,
      title: 'Discovery probe: garbage 2 km away',
      category: 'GARBAGE',
      severity: 'LOW',
      status: 'UNDER_REVIEW',
      latitude: 28.4775,
      longitude: 77.0266,
      daysAgo: 30,
      voteCount: 0,
    });
    await seed('E2E-FAR', {
      reporterId: otherCitizenId,
      title: 'Discovery probe: streetlight 200 km away',
      category: 'STREETLIGHTS',
      severity: 'CRITICAL',
      status: 'SUBMITTED',
      latitude: 26.9196,
      longitude: 75.8206,
      daysAgo: 1,
      voteCount: 400,
    });
    await seed('E2E-DRAFT', {
      reporterId: otherCitizenId,
      title: 'Discovery probe: unpublished draft nearby',
      category: 'POTHOLES',
      severity: 'HIGH',
      status: 'DRAFT',
      latitude: 28.4596,
      longitude: 77.0267,
      daysAgo: 1,
      voteCount: 0,
    });
  });

  afterAll(async () => {
    await prisma.problem
      .deleteMany({ where: { id: { in: createdIds } } })
      .catch(() => undefined);
    await app?.close();
  });

  /** Creates a problem with exact geography; the trigger fills `location`. */
  async function seed(
    marker: string,
    input: {
      reporterId: string;
      title: string;
      category: string;
      severity: string;
      status: string;
      latitude: number;
      longitude: number;
      daysAgo: number;
      voteCount: number;
    },
  ): Promise<void> {
    const createdAt = new Date(Date.now() - input.daysAgo * 86_400_000);

    const problem = await prisma.problem.create({
      data: {
        reporterId: input.reporterId,
        title: input.title,
        description: `${marker} — a fixture created by the discovery e2e suite for ranking and distance assertions.`,
        category: input.category as never,
        severity: input.severity as never,
        status: input.status as never,
        latitude: input.latitude,
        longitude: input.longitude,
        city: 'Gurugram',
        state: 'Haryana',
        address: `${marker} test road`,
        voteCount: input.voteCount,
        createdAt,
        submittedAt: createdAt,
      },
    });

    createdIds.push(problem.id);
  }

  async function clearRateLimits(): Promise<void> {
    const keys = await redis.connection.keys('ratelimit:*');
    if (keys.length > 0) await redis.connection.del(...keys);
  }

  async function loginAs(email: string): Promise<string[]> {
    await clearRateLimits();

    const response = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: SEEDED_PASSWORD })
      .expect(200);

    const header = response.headers['set-cookie'];
    return Array.isArray(header) ? header : header ? [header] : [];
  }

  /** The probe problems from a feed, which also contains seeded data. */
  function probes(items: Array<{ title: string }>): string[] {
    return items
      .filter((item) => item.title.startsWith('Discovery probe:'))
      .map((item) => item.title.replace('Discovery probe: ', ''));
  }

  // =============================================================== nearby

  describe('GET /problems/nearby', () => {
    it('validates coordinates', async () => {
      const base = '/api/v1/problems/nearby';

      await request(server).get(`${base}?latitude=91&longitude=77`).expect(400);
      await request(server).get(`${base}?latitude=28.45&longitude=181`).expect(400);
      await request(server).get(`${base}?latitude=abc&longitude=77`).expect(400);
    });

    /**
     * Half a coordinate pair is a client bug. Accepting it would silently
     * return a citywide feed that looks like a nearby one.
     */
    it('requires latitude and longitude together', async () => {
      await request(server).get('/api/v1/problems/nearby?latitude=28.4595').expect(400);
      await request(server).get('/api/v1/problems/nearby?longitude=77.0266').expect(400);
    });

    it('bounds the radius at both ends', async () => {
      const base = `/api/v1/problems/nearby?latitude=${ORIGIN.latitude}&longitude=${ORIGIN.longitude}`;

      await request(server).get(`${base}&radiusMeters=-1`).expect(400);
      await request(server).get(`${base}&radiusMeters=0`).expect(400);
      // Beyond the cap, an unbounded scan is exactly what this prevents.
      await request(server).get(`${base}&radiusMeters=100000000`).expect(400);
      await request(server).get(`${base}&radiusMeters=5000`).expect(200);
    });

    it('bounds the page size', async () => {
      const base = `/api/v1/problems/nearby?latitude=${ORIGIN.latitude}&longitude=${ORIGIN.longitude}`;

      await request(server).get(`${base}&limit=0`).expect(400);
      await request(server).get(`${base}&limit=5000`).expect(400);
    });

    it('rejects a malformed cursor rather than silently restarting', async () => {
      await request(server)
        .get('/api/v1/problems/nearby?cursor=not-a-real-cursor')
        .expect(400);
    });

    /** The PostGIS half: distances are measured, not estimated. */
    it('returns real distances computed by PostGIS', async () => {
      const response = await request(server)
        .get(
          `/api/v1/problems/nearby?latitude=${ORIGIN.latitude}&longitude=${ORIGIN.longitude}&radiusMeters=5000&limit=50`,
        )
        .expect(200);

      const near = response.body.data.items.find((item: { title: string }) =>
        item.title.includes('50 m away'),
      );

      expect(near).toBeDefined();
      // ~50 m, allowing for the ellipsoid and the coordinates chosen.
      expect(near.distanceMeters).toBeGreaterThan(20);
      expect(near.distanceMeters).toBeLessThan(120);
    });

    it('respects the radius', async () => {
      const at1km = await request(server)
        .get(
          `/api/v1/problems/nearby?latitude=${ORIGIN.latitude}&longitude=${ORIGIN.longitude}&radiusMeters=1000&limit=50`,
        )
        .expect(200);

      const at5km = await request(server)
        .get(
          `/api/v1/problems/nearby?latitude=${ORIGIN.latitude}&longitude=${ORIGIN.longitude}&radiusMeters=5000&limit=50`,
        )
        .expect(200);

      // The 2 km problem is outside 1 km and inside 5 km.
      expect(probes(at1km.body.data.items)).not.toContain('garbage 2 km away');
      expect(probes(at5km.body.data.items)).toContain('garbage 2 km away');

      // 200 km away is in neither, whatever its severity or support.
      expect(probes(at5km.body.data.items)).not.toContain('streetlight 200 km away');
    });

    it('sorts by distance when asked', async () => {
      const response = await request(server)
        .get(
          `/api/v1/problems/nearby?latitude=${ORIGIN.latitude}&longitude=${ORIGIN.longitude}&radiusMeters=25000&limit=50&sort=distance`,
        )
        .expect(200);

      const distances = response.body.data.items.map(
        (item: { distanceMeters: number }) => item.distanceMeters,
      );

      for (let i = 1; i < distances.length; i += 1) {
        expect(distances[i]).toBeGreaterThanOrEqual(distances[i - 1]!);
      }
    });

    /**
     * The documented ranking: nearby + recent + severe outranks far + old +
     * mild. Both probes are in range, so only the ordering is being asserted.
     */
    it('ranks a near, recent, severe problem above a far, old, mild one', async () => {
      const response = await request(server)
        .get(
          `/api/v1/problems/nearby?latitude=${ORIGIN.latitude}&longitude=${ORIGIN.longitude}&radiusMeters=5000&limit=50`,
        )
        .expect(200);

      const found = probes(response.body.data.items);
      expect(found).toContain('pothole 50 m away');
      expect(found).toContain('garbage 2 km away');
      expect(found.indexOf('pothole 50 m away')).toBeLessThan(
        found.indexOf('garbage 2 km away'),
      );
    });

    it('filters by category', async () => {
      const response = await request(server)
        .get(
          `/api/v1/problems/nearby?latitude=${ORIGIN.latitude}&longitude=${ORIGIN.longitude}&radiusMeters=25000&limit=50&category=GARBAGE`,
        )
        .expect(200);

      const items = response.body.data.items as Array<{ category: string }>;
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((item) => item.category === 'GARBAGE')).toBe(true);
    });

    it('filters by status', async () => {
      const response = await request(server)
        .get(
          `/api/v1/problems/nearby?latitude=${ORIGIN.latitude}&longitude=${ORIGIN.longitude}&radiusMeters=25000&limit=50&status=UNDER_REVIEW`,
        )
        .expect(200);

      const items = response.body.data.items as Array<{ status: string }>;
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((item) => item.status === 'UNDER_REVIEW')).toBe(true);
    });

    // A draft was never published; a feed must not be a way to read one.
    it('never returns an unpublished draft', async () => {
      const response = await request(server)
        .get(
          `/api/v1/problems/nearby?latitude=${ORIGIN.latitude}&longitude=${ORIGIN.longitude}&radiusMeters=25000&limit=50`,
        )
        .expect(200);

      expect(probes(response.body.data.items)).not.toContain('unpublished draft nearby');
    });

    it('paginates with a stable cursor', async () => {
      const base = `/api/v1/problems/nearby?latitude=${ORIGIN.latitude}&longitude=${ORIGIN.longitude}&radiusMeters=25000`;

      const first = await request(server).get(`${base}&limit=2`).expect(200);
      expect(first.body.data.items).toHaveLength(2);
      expect(first.body.data.nextCursor).toBeTruthy();

      const second = await request(server)
        .get(`${base}&limit=2&cursor=${encodeURIComponent(first.body.data.nextCursor)}`)
        .expect(200);

      const firstIds = first.body.data.items.map((i: { publicId: string }) => i.publicId);
      const secondIds = second.body.data.items.map((i: { publicId: string }) => i.publicId);

      // No overlap: an OFFSET would repeat rows as new reports arrive mid-scroll.
      expect(secondIds.filter((id: string) => firstIds.includes(id))).toEqual([]);
    });

    it('falls back to a city search when no coordinates are given', async () => {
      const response = await request(server)
        .get('/api/v1/problems/nearby?city=Gurugram&limit=5')
        .expect(200);

      expect(response.body.data.origin).toEqual({
        kind: 'city',
        label: 'Gurugram',
        radiusMeters: null,
      });
      // No origin point, so no distance is claimed.
      const items = response.body.data.items as Array<{ distanceMeters: number | null }>;
      expect(items.every((item) => item.distanceMeters === null)).toBe(true);
    });

    it('returns a clean empty response when nothing is in range', async () => {
      const response = await request(server)
        // The middle of the Bay of Bengal.
        .get('/api/v1/problems/nearby?latitude=15.0&longitude=88.0&radiusMeters=1000')
        .expect(200);

      expect(response.body.data.items).toEqual([]);
      expect(response.body.data.nextCursor).toBeNull();
      expect(response.body.data.origin.kind).toBe('coordinates');
    });

    it('answers an anonymous caller, since civic reports are public', async () => {
      const response = await request(server)
        .get('/api/v1/problems/nearby?city=Gurugram&limit=3')
        .expect(200);

      expect(response.body.data.items.length).toBeGreaterThan(0);
      // Nothing identifies the viewer, so nothing is marked as theirs.
      const items = response.body.data.items as Array<Record<string, unknown>>;
      expect(items.every((item) => item.isOwnReport === undefined)).toBe(true);
    });

    it('marks the viewer’s own reports when signed in', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');

      const response = await request(server)
        .get(
          `/api/v1/problems/nearby?latitude=${ORIGIN.latitude}&longitude=${ORIGIN.longitude}&radiusMeters=5000&limit=50`,
        )
        .set('Cookie', cookies)
        .expect(200);

      const own = response.body.data.items.find((item: { title: string }) =>
        item.title.includes('50 m away'),
      );
      expect(own.isOwnReport).toBe(true);
    });

    /**
     * The privacy contract for a feed. A discovery list shows many people's
     * reports, so it carries civic facts and nothing about who filed them.
     */
    it('never exposes the reporter, internal ids or coordinates', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');

      const response = await request(server)
        .get(
          `/api/v1/problems/nearby?latitude=${ORIGIN.latitude}&longitude=${ORIGIN.longitude}&radiusMeters=25000&limit=50`,
        )
        .set('Cookie', cookies)
        .expect(200);

      const body = JSON.stringify(response.body);
      expect(body).not.toMatch(/samadhaan\.dev/);
      expect(body).not.toMatch(/"reporter"/);
      expect(body).not.toMatch(/"reporterId"/);
      expect(body).not.toMatch(/"email"/);
      expect(body).not.toMatch(/"phone"/);
      expect(body).not.toMatch(/"latitude"/);
      expect(body).not.toMatch(/"longitude"/);

      const item = response.body.data.items[0] as Record<string, unknown>;
      // `publicId` is the only identity a feed publishes.
      expect(item).not.toHaveProperty('id');
      expect(item.publicId).toMatch(/^SAM-/);
    });
  });

  // =============================================================== my reports

  describe('GET /problems/my', () => {
    it('refuses an anonymous caller', async () => {
      await request(server).get('/api/v1/problems/my').expect(401);
    });

    it('returns the signed-in citizen’s own reports', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');

      const response = await request(server)
        .get('/api/v1/problems/my?limit=50')
        .set('Cookie', cookies)
        .expect(200);

      const items = response.body.data.items as Array<{ title: string; isOwnReport: boolean }>;
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((item) => item.isOwnReport === true)).toBe(true);
      expect(probes(items)).toContain('pothole 50 m away');
      // Filed by the other citizen.
      expect(probes(items)).not.toContain('streetlight 200 km away');
    });

    /**
     * The identity cannot be redirected. `MyProblemsQueryDto` has no field for
     * a user, and `forbidNonWhitelisted` rejects an invented one outright
     * rather than ignoring it — a 400, not a quiet leak.
     */
    it('cannot be pointed at another user', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');

      for (const query of [
        `userId=${otherCitizenId}`,
        `reporterId=${otherCitizenId}`,
        'user=citizen2@samadhaan.dev',
      ]) {
        await request(server)
          .get(`/api/v1/problems/my?${query}`)
          .set('Cookie', cookies)
          .expect(400);
      }
    });

    it('returns only that user’s reports even when two accounts overlap', async () => {
      const mine = await request(server)
        .get('/api/v1/problems/my?limit=50')
        .set('Cookie', await loginAs('citizen@samadhaan.dev'))
        .expect(200);

      const theirs = await request(server)
        .get('/api/v1/problems/my?limit=50')
        .set('Cookie', await loginAs('citizen2@samadhaan.dev'))
        .expect(200);

      const mineIds = mine.body.data.items.map((i: { publicId: string }) => i.publicId);
      const theirIds = theirs.body.data.items.map((i: { publicId: string }) => i.publicId);

      expect(mineIds.filter((id: string) => theirIds.includes(id))).toEqual([]);
    });

    it('filters by status and category', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');

      const byStatus = await request(server)
        .get('/api/v1/problems/my?status=UNDER_REVIEW&limit=50')
        .set('Cookie', cookies)
        .expect(200);
      expect(
        (byStatus.body.data.items as Array<{ status: string }>).every(
          (item) => item.status === 'UNDER_REVIEW',
        ),
      ).toBe(true);

      const byCategory = await request(server)
        .get('/api/v1/problems/my?category=GARBAGE&limit=50')
        .set('Cookie', cookies)
        .expect(200);
      expect(
        (byCategory.body.data.items as Array<{ category: string }>).every(
          (item) => item.category === 'GARBAGE',
        ),
      ).toBe(true);
    });

    it('sorts', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');

      const newest = await request(server)
        .get('/api/v1/problems/my?sort=recent&limit=50')
        .set('Cookie', cookies)
        .expect(200);
      const oldest = await request(server)
        .get('/api/v1/problems/my?sort=oldest&limit=50')
        .set('Cookie', cookies)
        .expect(200);

      const first = newest.body.data.items[0].publicId;
      const last = oldest.body.data.items[0].publicId;
      expect(first).not.toBe(last);
    });

    it('paginates and reports a total', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');

      const page1 = await request(server)
        .get('/api/v1/problems/my?limit=2')
        .set('Cookie', cookies)
        .expect(200);

      expect(page1.body.data.items).toHaveLength(2);
      expect(page1.body.data.totalCount).toBeGreaterThan(2);
      expect(page1.body.data.nextCursor).toBeTruthy();

      const page2 = await request(server)
        .get(`/api/v1/problems/my?limit=2&cursor=${encodeURIComponent(page1.body.data.nextCursor)}`)
        .set('Cookie', cookies)
        .expect(200);

      const ids1 = page1.body.data.items.map((i: { publicId: string }) => i.publicId);
      const ids2 = page2.body.data.items.map((i: { publicId: string }) => i.publicId);
      expect(ids2.filter((id: string) => ids1.includes(id))).toEqual([]);
    });

    it('rejects a malformed cursor', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');

      await request(server)
        .get('/api/v1/problems/my?cursor=nonsense')
        .set('Cookie', cookies)
        .expect(400);
    });

    it('returns a clean empty page when a filter matches nothing', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');

      const response = await request(server)
        .get('/api/v1/problems/my?category=PUBLIC_TRANSPORT')
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body.data.items).toEqual([]);
      expect(response.body.data.totalCount).toBe(0);
      expect(response.body.data.nextCursor).toBeNull();
    });
  });

  // =============================================================== dashboard

  describe('GET /dashboard/citizen', () => {
    it('refuses an anonymous caller', async () => {
      await request(server).get('/api/v1/dashboard/citizen').expect(401);
    });

    it('returns the caller’s own name, counts and recent reports', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');

      const response = await request(server)
        .get('/api/v1/dashboard/citizen')
        .set('Cookie', cookies)
        .expect(200);

      const data = response.body.data;
      expect(data.user.firstName).toBeTruthy();
      expect(data.user.city).toBe('Gurugram');
      expect(data.activity.problemsReported).toBeGreaterThan(0);
      expect(data.reportCount).toBeGreaterThan(0);
      expect(data.recentReports.length).toBeGreaterThan(0);
      expect(
        (data.recentReports as Array<{ isOwnReport: boolean }>).every(
          (item) => item.isOwnReport === true,
        ),
      ).toBe(true);
    });

    /**
     * A zero here would read as a measured score of nothing. The ledger does
     * not exist, so the honest answer is null and the UI says "coming soon".
     */
    it('reports impact points as null rather than zero', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');

      const response = await request(server)
        .get('/api/v1/dashboard/citizen')
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body.data.activity.impactPoints).toBeNull();
    });

    it('scopes every figure to the caller', async () => {
      const mine = await request(server)
        .get('/api/v1/dashboard/citizen')
        .set('Cookie', await loginAs('citizen@samadhaan.dev'))
        .expect(200);

      const theirs = await request(server)
        .get('/api/v1/dashboard/citizen')
        .set('Cookie', await loginAs('citizen2@samadhaan.dev'))
        .expect(200);

      expect(mine.body.data.activity.problemsReported).not.toBe(
        theirs.body.data.activity.problemsReported,
      );

      const mineIds = mine.body.data.recentReports.map((i: { publicId: string }) => i.publicId);
      const theirIds = theirs.body.data.recentReports.map(
        (i: { publicId: string }) => i.publicId,
      );
      expect(mineIds.filter((id: string) => theirIds.includes(id))).toEqual([]);
    });

    it('does not leak private profile fields', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');

      const response = await request(server)
        .get('/api/v1/dashboard/citizen')
        .set('Cookie', cookies)
        .expect(200);

      const body = JSON.stringify(response.body.data);
      expect(body).not.toMatch(/samadhaan\.dev/);
      expect(body).not.toMatch(/"phone"/);
      expect(body).not.toMatch(/"passwordHash"/);
      expect(body).not.toMatch(/"reporterId"/);
    });
  });
});
