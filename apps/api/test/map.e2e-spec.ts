import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GeocodeResult } from '@samadhaan/shared';
import { AppModule } from '../src/app.module.js';
import { AiService } from '../src/ai/ai.service.js';
import { configureApp, registerNotFoundHandler } from '../src/bootstrap.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { GeocodingProvider } from '../src/geo/geocoding.provider.js';
import { RedisService } from '../src/redis/redis.service.js';

/**
 * The civic map end to end: real PostGIS, real GiST index, real guards.
 *
 * Fixtures sit in an isolated box near Chennai (12.90–12.96 N, 80.10–80.16 E),
 * far from the development seed in Gurugram and Jaipur, so every count below is
 * exact.
 */
describe('Map and geocoding (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let server: Parameters<typeof request>[0];

  const createdIds: string[] = [];
  let reporterId: string;
  let citizen: string[];

  /** The test area. Inside the detail limit, and empty but for our fixtures. */
  const AREA = { west: 80.1, south: 12.9, east: 80.16, north: 12.96 };
  const ORIGIN = { latitude: 12.93, longitude: 80.13 };

  const geocoder = {
    name: 'fake',
    search: vi.fn(async (): Promise<GeocodeResult[]> => [
      {
        label: 'Velachery, Chennai, Tamil Nadu, India',
        latitude: 12.9815,
        longitude: 80.218,
        address: 'Velachery',
        city: 'Chennai',
        state: 'Tamil Nadu',
        postalCode: '600042',
        country: 'India',
        boundingBox: [80.2, 12.97, 80.23, 12.99],
      },
    ]),
    reverse: vi.fn(async (): Promise<GeocodeResult | null> => null),
  };

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
      .overrideProvider(GeocodingProvider)
      .useValue(geocoder)
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    registerNotFoundHandler(app);

    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    server = app.getHttpServer();

    reporterId = (
      await prisma.user.findUniqueOrThrow({ where: { email: 'citizen@samadhaan.dev' } })
    ).id;

    await clearKeys();
    const login = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: 'citizen@samadhaan.dev', password: 'DevPassword123!' })
      .expect(200);
    const header = login.headers['set-cookie'];
    citizen = Array.isArray(header) ? header : header ? [header] : [];

    // ~110 m north of the origin, HIGH, roads.
    await seed('MAP-A', {
      latitude: 12.931,
      longitude: 80.13,
      category: 'ROADS',
      severity: 'HIGH',
      status: 'SUBMITTED',
    });
    // ~2.2 km north, CRITICAL, water, in progress.
    await seed('MAP-B', {
      latitude: 12.95,
      longitude: 80.13,
      category: 'WATER',
      severity: 'CRITICAL',
      status: 'IN_PROGRESS',
    });
    // South-west corner, LOW, garbage, resolved — hidden unless asked for.
    await seed('MAP-C', {
      latitude: 12.905,
      longitude: 80.105,
      category: 'GARBAGE',
      severity: 'LOW',
      status: 'RESOLVED',
    });
    // Never on any map.
    await seed('MAP-DRAFT', {
      latitude: 12.932,
      longitude: 80.131,
      category: 'ROADS',
      severity: 'HIGH',
      status: 'DRAFT',
    });
    // Just outside the box to the east.
    await seed('MAP-OUT', {
      latitude: 12.93,
      longitude: 80.17,
      category: 'ROADS',
      severity: 'HIGH',
      status: 'SUBMITTED',
    });
  });

  beforeEach(clearKeys);

  afterAll(async () => {
    await prisma?.problem
      .deleteMany({ where: { id: { in: createdIds } } })
      .catch(() => undefined);
    await app?.close();
  });

  async function clearKeys(): Promise<void> {
    const keys = [
      ...(await redis.connection.keys('ratelimit:*')),
      ...(await redis.connection.keys('geo:*')),
    ];
    if (keys.length > 0) await redis.connection.del(...keys);
  }

  async function seed(
    marker: string,
    input: {
      latitude: number;
      longitude: number;
      category: string;
      severity: string;
      status: string;
    },
  ): Promise<void> {
    const problem = await prisma.problem.create({
      data: {
        reporterId,
        title: `Map probe ${marker}`,
        description: `${marker} — created by the map e2e suite.`,
        category: input.category as never,
        severity: input.severity as never,
        status: input.status as never,
        latitude: input.latitude,
        longitude: input.longitude,
        address: `${marker} Street, Velachery`,
        city: 'Chennai',
        state: 'Tamil Nadu',
      },
    });
    createdIds.push(problem.id);
  }

  const query = (params: Record<string, string | number>) =>
    new URLSearchParams(
      Object.entries({ ...AREA, ...params }).map(([key, value]) => [key, String(value)]),
    ).toString();

  async function mapOf(params: Record<string, string | number> = {}) {
    const response = await request(server)
      .get(`/api/v1/problems/map?${query(params)}`)
      .expect(200);
    return response.body.data as {
      type: string;
      bbox: number[];
      truncated: boolean;
      features: Array<{
        type: string;
        id: string;
        geometry: { type: string; coordinates: [number, number] };
        properties: Record<string, unknown> & {
          title: string;
          distanceMeters: number | null;
        };
      }>;
    };
  }

  const titles = (features: Array<{ properties: { title: string } }>) =>
    features.map((feature) => feature.properties.title.replace('Map probe ', '')).sort();

  // ============================================================== viewport

  describe('GET /problems/map', () => {
    it('returns the problems inside the box as GeoJSON, using PostGIS', async () => {
      const collection = await mapOf();

      expect(collection.type).toBe('FeatureCollection');
      expect(collection.bbox).toEqual([AREA.west, AREA.south, AREA.east, AREA.north]);
      expect(titles(collection.features)).toEqual(['MAP-A', 'MAP-B']);

      const [first] = collection.features;
      expect(first).toMatchObject({ type: 'Feature', geometry: { type: 'Point' } });
      // GeoJSON order: [longitude, latitude].
      const a = collection.features.find((f) => f.properties.title.endsWith('MAP-A'))!;
      expect(a.geometry.coordinates).toEqual([80.13, 12.931]);
      expect(a.id).toBe(a.properties.publicId);
    });

    it('is ordered most severe first', async () => {
      const collection = await mapOf();
      expect(collection.features.map((f) => f.properties.severity)).toEqual([
        'CRITICAL',
        'HIGH',
      ]);
    });

    it('never includes drafts or problems outside the box', async () => {
      const collection = await mapOf({ status: 'SUBMITTED' });
      expect(titles(collection.features)).toEqual(['MAP-A']);
    });

    it('publishes civic facts only — no reporter, no internal id', async () => {
      const collection = await mapOf();
      const body = JSON.stringify(collection);

      expect(Object.keys(collection.features[0]!.properties).sort()).toEqual(
        [
          'area',
          'category',
          'city',
          'createdAt',
          'distanceMeters',
          'publicId',
          'severity',
          'status',
          'subcategory',
          'title',
          'voteCount',
        ].sort(),
      );
      expect(body).not.toContain(reporterId);
      expect(body).not.toContain('@samadhaan.dev');
      // The coarse area, not the full street address.
      expect(collection.features[0]!.properties.area).toMatch(/^MAP-[AB] Street$/);
    });

    it('filters by category, severity and status', async () => {
      expect(titles((await mapOf({ category: 'WATER' })).features)).toEqual(['MAP-B']);
      expect(titles((await mapOf({ severity: 'HIGH' })).features)).toEqual(['MAP-A']);
      expect(titles((await mapOf({ status: 'IN_PROGRESS' })).features)).toEqual([
        'MAP-B',
      ]);
      // Resolved problems appear only when asked for.
      expect(titles((await mapOf({ status: 'RESOLVED' })).features)).toEqual(['MAP-C']);
    });

    it('rejects filter values outside the taxonomy, and internal statuses', async () => {
      const invalid: Array<Record<string, string>> = [
        { category: 'ROCKETS' },
        { severity: 'EXTREME' },
        { status: 'DRAFT' },
        { status: 'DUPLICATE' },
      ];
      for (const params of invalid) {
        await request(server)
          .get(`/api/v1/problems/map?${query(params)}`)
          .expect(400);
      }
    });

    it('caps the result and says so', async () => {
      const collection = await mapOf({ limit: 1 });
      expect(collection.features).toHaveLength(1);
      expect(collection.features[0]!.properties.severity).toBe('CRITICAL');
      expect(collection.truncated).toBe(true);

      expect((await mapOf({ limit: 50 })).truncated).toBe(false);
      await request(server)
        .get(`/api/v1/problems/map?${query({ limit: 0 })}`)
        .expect(400);
      await request(server)
        .get(`/api/v1/problems/map?${query({ limit: 5000 })}`)
        .expect(400);
    });

    it('measures distance with PostGIS when an origin is given', async () => {
      const collection = await mapOf({
        originLatitude: ORIGIN.latitude,
        originLongitude: ORIGIN.longitude,
      });

      const distance = (marker: string) =>
        collection.features.find((f) => f.properties.title.endsWith(marker))!.properties
          .distanceMeters!;

      // 0.001° of latitude ≈ 110.6 m; 0.02° ≈ 2.21 km, on the spheroid.
      expect(distance('MAP-A')).toBeGreaterThan(105);
      expect(distance('MAP-A')).toBeLessThan(115);
      expect(distance('MAP-B')).toBeGreaterThan(2180);
      expect(distance('MAP-B')).toBeLessThan(2240);

      // Without an origin, no distance is invented.
      expect(
        (await mapOf()).features.every((f) => f.properties.distanceMeters === null),
      ).toBe(true);
    });

    it('requires the origin as a pair', async () => {
      await request(server)
        .get(`/api/v1/problems/map?${query({ originLatitude: 12.93 })}`)
        .expect(400);
    });

    it('returns an empty collection where there is nothing', async () => {
      const response = await request(server)
        .get('/api/v1/problems/map?west=80.5&south=13.5&east=80.6&north=13.6')
        .expect(200);
      expect(response.body.data).toMatchObject({
        type: 'FeatureCollection',
        features: [],
        truncated: false,
      });
    });

    it('validates every edge of the box', async () => {
      const bad = [
        'south=12.9&east=80.16&north=12.96', // missing west
        'west=80.1&south=-91&east=80.16&north=12.96',
        'west=181&south=12.9&east=80.16&north=12.96',
        'west=abc&south=12.9&east=80.16&north=12.96',
        'west=80.1&south=12.96&east=80.16&north=12.9', // inverted
        'west=80.16&south=12.9&east=80.1&north=12.96', // antimeridian / inverted
      ];
      for (const params of bad) {
        await request(server).get(`/api/v1/problems/map?${params}`).expect(400);
      }
    });

    it('refuses an oversized box rather than scanning a country', async () => {
      const response = await request(server)
        .get('/api/v1/problems/map?west=68&south=8&east=97&north=37')
        .expect(400);
      expect(response.body.error.message).toMatch(/too large/);
    });

    it('rejects unknown parameters', async () => {
      await request(server)
        .get(`/api/v1/problems/map?${query({ reporterId })}`)
        .expect(400);
    });

    it('is public and briefly cacheable, since it carries no viewer state', async () => {
      const response = await request(server)
        .get(`/api/v1/problems/map?${query({})}`)
        .expect(200);
      expect(response.headers['cache-control']).toBe('public, max-age=30');
    });

    it('treats injection attempts as invalid input, not SQL', async () => {
      await request(server)
        .get(`/api/v1/problems/map?${query({ category: "ROADS' OR 1=1 --" })}`)
        .expect(400);
      await request(server)
        .get(
          '/api/v1/problems/map?west=80.1);DROP TABLE problems;--&south=12.9&east=80.16&north=12.96',
        )
        .expect(400);
      expect(await prisma.problem.count()).toBeGreaterThan(0);
    });
  });

  // ============================================================ aggregation

  describe('GET /problems/map/aggregate', () => {
    it('groups problems into cells with severity and category breakdowns', async () => {
      const response = await request(server)
        .get(
          '/api/v1/problems/map/aggregate?west=79&south=12&east=81&north=14&status=IN_PROGRESS',
        )
        .expect(200);
      const collection = response.body.data;

      expect(collection.type).toBe('FeatureCollection');
      expect(collection.totalCount).toBe(1);
      expect(collection.features[0].properties).toEqual({
        count: 1,
        severity: { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 1 },
        topCategories: [{ category: 'WATER', count: 1 }],
      });
      expect(collection.features[0].geometry.coordinates).toEqual([80.13, 12.95]);
    });

    it('counts every live problem in a larger area', async () => {
      const response = await request(server)
        .get('/api/v1/problems/map/aggregate?west=79&south=12&east=81&north=14')
        .expect(200);
      // A, B and OUT are live; C is resolved; the draft never counts.
      expect(response.body.data.totalCount).toBe(3);
    });

    it('accepts a country-sized box but not a hemisphere', async () => {
      await request(server)
        .get('/api/v1/problems/map/aggregate?west=68&south=8&east=97&north=37')
        .expect(200);
      await request(server)
        .get('/api/v1/problems/map/aggregate?west=0&south=-60&east=170&north=60')
        .expect(400);
    });
  });

  // ============================================================== radius

  /** Distance queries in the radius shape, through the discovery feed. */
  describe('radius queries', () => {
    it('finds problems within 1 km and within 5 km', async () => {
      const within = async (radiusMeters: number) => {
        const response = await request(server)
          .get(
            `/api/v1/problems/nearby?latitude=${ORIGIN.latitude}&longitude=${ORIGIN.longitude}&radiusMeters=${radiusMeters}&limit=50`,
          )
          .expect(200);
        return titles(
          (response.body.data.items as Array<{ title: string }>)
            .filter((item) => item.title.startsWith('Map probe'))
            .map((item) => ({ properties: item })),
        );
      };

      expect(await within(1000)).toEqual(['MAP-A']);
      expect(await within(5000)).toEqual(['MAP-A', 'MAP-B', 'MAP-OUT']);
    });
  });

  // ============================================================= geocoding

  describe('geocoding', () => {
    it('searches through the configured provider, behind a session', async () => {
      await request(server).get('/api/v1/geo/search?q=Velachery').expect(401);

      const response = await request(server)
        .get('/api/v1/geo/search?q=Velachery')
        .set('Cookie', citizen)
        .expect(200);
      expect(response.body.data[0]).toMatchObject({ city: 'Chennai', latitude: 12.9815 });
    });

    it('caches results so the provider is asked once', async () => {
      geocoder.search.mockClear();

      for (let index = 0; index < 3; index += 1) {
        await request(server)
          .get('/api/v1/geo/search?q=Adyar')
          .set('Cookie', citizen)
          .expect(200);
      }
      expect(geocoder.search).toHaveBeenCalledTimes(1);
    });

    it('validates search text and coordinates', async () => {
      await request(server)
        .get('/api/v1/geo/search?q=a')
        .set('Cookie', citizen)
        .expect(400);
      await request(server)
        .get(`/api/v1/geo/search?q=${'x'.repeat(201)}`)
        .set('Cookie', citizen)
        .expect(400);
      await request(server)
        .get('/api/v1/geo/reverse?latitude=95&longitude=80')
        .set('Cookie', citizen)
        .expect(400);
    });

    it('answers a reverse lookup with no address as null', async () => {
      const response = await request(server)
        .get('/api/v1/geo/reverse?latitude=12.5&longitude=85.5')
        .set('Cookie', citizen)
        .expect(200);
      expect(response.body.data).toBeNull();
    });

    it('reports a provider outage as 503 with a usable message', async () => {
      geocoder.search.mockRejectedValueOnce(
        new (await import('../src/geo/geocoding.provider.js')).GeocodingUnavailableError(
          'down',
        ),
      );

      const response = await request(server)
        .get('/api/v1/geo/search?q=Guindy')
        .set('Cookie', citizen)
        .expect(503);
      expect(response.body.error.message).toMatch(/enter the address yourself/);
    });
  });
});
