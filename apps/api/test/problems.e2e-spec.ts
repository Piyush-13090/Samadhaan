import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp, registerNotFoundHandler } from '../src/bootstrap.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { RedisService } from '../src/redis/redis.service.js';
import { StorageService } from '../src/storage/storage.types.js';

/**
 * Citizen problem reporting, end to end against the real application:
 * real image decoding, real storage, real database, real guards.
 *
 * Most of these are security assertions rather than feature checks — an upload
 * endpoint is the most directly attackable surface the product has.
 */
describe('Problem reporting (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let storage: StorageService;
  let server: Parameters<typeof request>[0];

  const SEEDED_PASSWORD = 'DevPassword123!';
  const createdProblemIds: string[] = [];
  const uploadedKeys: string[] = [];

  let jpeg: Buffer;
  let png: Buffer;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    registerNotFoundHandler(app);

    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    storage = app.get(StorageService);
    server = app.getHttpServer();

    await clearRateLimits();

    const canvas = (width: number, height: number) =>
      sharp({
        create: { width, height, channels: 3, background: { r: 90, g: 120, b: 200 } },
      });

    [jpeg, png] = await Promise.all([
      canvas(800, 600).jpeg().toBuffer(),
      canvas(640, 480).png().toBuffer(),
    ]);
  });

  afterAll(async () => {
    // Children first: ProblemImage cascades, but be explicit about order.
    await prisma.problemImage
      .deleteMany({ where: { problemId: { in: createdProblemIds } } })
      .catch(() => undefined);
    await prisma.problem
      .deleteMany({ where: { id: { in: createdProblemIds } } })
      .catch(() => undefined);

    // Remove the files this suite wrote, so the dev storage root stays clean.
    await Promise.all(
      uploadedKeys.map((key) => storage.delete(key).catch(() => undefined)),
    );

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
      .send({ email, password: SEEDED_PASSWORD })
      .expect(200);

    const header = response.headers['set-cookie'];
    return Array.isArray(header) ? header : header ? [header] : [];
  }

  /** Uploads a buffer and remembers the key for cleanup. */
  async function upload(
    cookies: string[],
    buffer: Buffer,
    filename: string,
  ): Promise<string> {
    const response = await request(server)
      .post('/api/v1/problems/images')
      .set('Cookie', cookies)
      .attach('file', buffer, filename)
      .expect(201);

    const key = response.body.data.storageKey as string;
    uploadedKeys.push(key);
    return key;
  }

  /** A valid report body; individual tests override what they are testing. */
  function reportBody(overrides: Record<string, unknown> = {}) {
    return {
      title: 'Waterlogging near the Sector 12 market entrance',
      description:
        'Water has been standing at the market entrance for three days after the last rain. Two people have slipped.',
      category: 'DRAINAGE',
      location: { latitude: 28.4595, longitude: 77.0266, city: 'Gurugram' },
      ...overrides,
    };
  }

  // ============================================================ authorisation

  describe('Authorisation', () => {
    it('refuses an unauthenticated upload', async () => {
      await request(server)
        .post('/api/v1/problems/images')
        .attach('file', jpeg, 'photo.jpg')
        .expect(401);
    });

    it('refuses an unauthenticated report', async () => {
      await request(server).post('/api/v1/problems').send(reportBody()).expect(401);
    });

    // Reporting is a citizen action; organisations act *on* problems.
    it('refuses a non-citizen role', async () => {
      const cookies = await loginAs('ngo@samadhaan.dev');

      await request(server)
        .post('/api/v1/problems')
        .set('Cookie', cookies)
        .send(reportBody())
        .expect(403);

      await request(server)
        .post('/api/v1/problems/images')
        .set('Cookie', cookies)
        .attach('file', jpeg, 'photo.jpg')
        .expect(403);
    });

    it('refuses a government account', async () => {
      const cookies = await loginAs('government@samadhaan.dev');

      await request(server)
        .post('/api/v1/problems')
        .set('Cookie', cookies)
        .send(reportBody())
        .expect(403);
    });

    it('allows a citizen', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');

      const response = await request(server)
        .post('/api/v1/problems')
        .set('Cookie', cookies)
        .send(reportBody())
        .expect(201);

      createdProblemIds.push(response.body.data.id);
    });
  });

  // ================================================================= uploads

  describe('Image upload', () => {
    it('accepts a JPEG and reports its real properties', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');

      const response = await request(server)
        .post('/api/v1/problems/images')
        .set('Cookie', cookies)
        .attach('file', jpeg, 'my photo.jpg')
        .expect(201);

      uploadedKeys.push(response.body.data.storageKey);

      expect(response.body.data.contentType).toBe('image/jpeg');
      expect(response.body.data.width).toBe(800);
      expect(response.body.data.height).toBe(600);
    });

    /**
     * The storage key must be server-generated. A user-supplied name invites
     * traversal, collisions, and whatever the filename discloses.
     */
    it('generates a key that does not contain the original filename', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');

      const response = await request(server)
        .post('/api/v1/problems/images')
        .set('Cookie', cookies)
        .attach('file', jpeg, '../../../etc/passwd.jpg')
        .expect(201);

      const { storageKey, originalFileName } = response.body.data;
      uploadedKeys.push(storageKey);

      expect(storageKey).toMatch(/^problems\/\d{4}\/\d{2}\/[0-9a-f]{32}\.jpg$/);
      expect(storageKey).not.toContain('passwd');
      expect(storageKey).not.toContain('..');
      // Kept as metadata, never as a path.
      expect(originalFileName).toContain('passwd');
    });

    it('rejects a script disguised as a JPEG', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');

      const response = await request(server)
        .post('/api/v1/problems/images')
        .set('Cookie', cookies)
        .attach('file', Buffer.from('<?php system($_GET["c"]); ?>'), {
          filename: 'photo.jpg',
          contentType: 'image/jpeg',
        })
        .expect(400);

      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('rejects an SVG, which can carry script', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');

      await request(server)
        .post('/api/v1/problems/images')
        .set('Cookie', cookies)
        .attach('file', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), {
          filename: 'drawing.svg',
          contentType: 'image/svg+xml',
        })
        .expect(400);
    });

    it('rejects a file over the size limit', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');

      // 10 MB against an 8 MB limit; multer rejects before the handler runs.
      const oversized = Buffer.alloc(10 * 1024 * 1024, 1);

      const response = await request(server)
        .post('/api/v1/problems/images')
        .set('Cookie', cookies)
        .attach('file', oversized, 'huge.jpg');

      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    it('rejects a request with no file', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');

      await request(server)
        .post('/api/v1/problems/images')
        .set('Cookie', cookies)
        .expect(400);
    });
  });

  // =============================================================== creation

  describe('Problem creation', () => {
    it('creates a SUBMITTED problem with a SAM- identifier', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');

      const response = await request(server)
        .post('/api/v1/problems')
        .set('Cookie', cookies)
        .send(reportBody())
        .expect(201);

      const problem = response.body.data;
      createdProblemIds.push(problem.id);

      expect(problem.publicId).toMatch(/^SAM-\d+$/);
      // Never VERIFIED on creation, and no AI has run.
      expect(problem.status).toBe('SUBMITTED');
      expect(problem.submittedAt).toBeTruthy();
    });

    it('gives concurrent reports distinct identifiers', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');

      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          request(server)
            .post('/api/v1/problems')
            .set('Cookie', cookies)
            .send(reportBody()),
        ),
      );

      const publicIds = responses.map((response) => {
        createdProblemIds.push(response.body.data.id);
        return response.body.data.publicId;
      });

      expect(new Set(publicIds).size).toBe(5);
    });

    it('persists multiple images with order and a single primary', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');
      const [first, second] = await Promise.all([
        upload(cookies, jpeg, 'one.jpg'),
        upload(cookies, png, 'two.png'),
      ]);

      const response = await request(server)
        .post('/api/v1/problems')
        .set('Cookie', cookies)
        .send(
          reportBody({
            images: [
              { storageKey: first, sortOrder: 0, isPrimary: true },
              { storageKey: second, sortOrder: 1, isPrimary: false },
            ],
          }),
        )
        .expect(201);

      const problem = response.body.data;
      createdProblemIds.push(problem.id);

      expect(problem.images).toHaveLength(2);
      expect(
        problem.images.filter((i: { isPrimary: boolean }) => i.isPrimary),
      ).toHaveLength(1);

      // Metadata reached the database, not just the response.
      const stored = await prisma.problemImage.findMany({
        where: { problemId: problem.id },
        orderBy: { sortOrder: 'asc' },
      });

      expect(stored).toHaveLength(2);
      expect(stored[0]?.mimeType).toBe('image/jpeg');
      expect(stored[0]?.width).toBe(800);
      expect(stored[0]?.isPrimary).toBe(true);
      expect(stored[1]?.mimeType).toBe('image/png');
      // Every image belongs to this problem and no other.
      expect(stored.every((image) => image.problemId === problem.id)).toBe(true);
    });

    it('normalises a client that marks no primary image', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');
      const key = await upload(cookies, jpeg, 'one.jpg');

      const response = await request(server)
        .post('/api/v1/problems')
        .set('Cookie', cookies)
        .send(
          reportBody({
            images: [{ storageKey: key, sortOrder: 0, isPrimary: false }],
          }),
        )
        .expect(201);

      createdProblemIds.push(response.body.data.id);
      expect(response.body.data.images[0].isPrimary).toBe(true);
    });

    it('stores the location as a PostGIS point', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');

      const response = await request(server)
        .post('/api/v1/problems')
        .set('Cookie', cookies)
        .send(reportBody({ location: { latitude: 19.076, longitude: 72.8777 } }))
        .expect(201);

      createdProblemIds.push(response.body.data.id);

      const rows = await prisma.$queryRaw<Array<{ lat: number; lng: number }>>`
        SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
        FROM problems WHERE id = ${response.body.data.id}::uuid
      `;

      expect(rows[0]?.lat).toBeCloseTo(19.076, 3);
      expect(rows[0]?.lng).toBeCloseTo(72.8777, 3);
    });

    it('accepts a report with no photo', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');

      const response = await request(server)
        .post('/api/v1/problems')
        .set('Cookie', cookies)
        .send(reportBody({ images: [] }))
        .expect(201);

      createdProblemIds.push(response.body.data.id);
      expect(response.body.data.images).toEqual([]);
    });
  });

  // ============================================================== validation

  describe('Validation', () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ['missing title', { title: undefined }],
      ['title too short', { title: 'short' }],
      ['missing description', { description: undefined }],
      ['description too short', { description: 'too short' }],
      ['invalid category', { category: 'NOT_A_CATEGORY' }],
      ['missing location', { location: undefined }],
      ['latitude out of range', { location: { latitude: 95, longitude: 77 } }],
      ['longitude out of range', { location: { latitude: 28, longitude: 200 } }],
      ['non-numeric latitude', { location: { latitude: 'north', longitude: 77 } }],
    ];

    for (const [name, override] of cases) {
      it(`rejects ${name}`, async () => {
        const cookies = await loginAs('citizen@samadhaan.dev');

        const response = await request(server)
          .post('/api/v1/problems')
          .set('Cookie', cookies)
          .send(reportBody(override))
          .expect(400);

        expect(response.body.error.code).toBe('VALIDATION_FAILED');
      });
    }

    /**
     * Severity, urgency and status are assessments the AI and a reviewer make.
     * Letting a reporter set them would make the triage queue a measure of how
     * alarmed people are rather than how bad things are.
     */
    it('rejects an attempt to set status, severity or priority', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');

      for (const field of [
        { status: 'VERIFIED' },
        { severity: 'CRITICAL' },
        { urgency: 'CRITICAL' },
        { priorityScore: 100 },
        { reporterId: '00000000-0000-4000-8000-000000000000' },
        { publicId: 'SAM-1' },
      ]) {
        const response = await request(server)
          .post('/api/v1/problems')
          .set('Cookie', cookies)
          .send(reportBody(field))
          .expect(400);

        expect(response.body.error.code).toBe('VALIDATION_FAILED');
      }
    });

    it('rejects more images than the limit allows', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');

      const images = Array.from({ length: 10 }, (_, index) => ({
        storageKey: `problems/2026/09/${'a'.repeat(32)}.jpg`,
        sortOrder: index,
        isPrimary: index === 0,
      }));

      await request(server)
        .post('/api/v1/problems')
        .set('Cookie', cookies)
        .send(reportBody({ images }))
        .expect(400);
    });
  });

  // ======================================================== image references

  describe('Storage key references', () => {
    it('rejects a path-traversal storage key', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');

      const response = await request(server)
        .post('/api/v1/problems')
        .set('Cookie', cookies)
        .send(
          reportBody({
            images: [
              { storageKey: '../../../../etc/passwd', sortOrder: 0, isPrimary: true },
            ],
          }),
        )
        .expect(400);

      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('rejects a key that was never issued', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');

      await request(server)
        .post('/api/v1/problems')
        .set('Cookie', cookies)
        .send(
          reportBody({
            images: [
              {
                storageKey: `problems/2026/09/${'d'.repeat(32)}.jpg`,
                sortOrder: 0,
                isPrimary: true,
              },
            ],
          }),
        )
        .expect(400);
    });

    /**
     * The reason uploads are tracked per user at all: without this, anyone
     * could attach a storage key belonging to someone else's upload.
     */
    it("rejects another user's uploaded image", async () => {
      const ownerCookies = await loginAs('citizen@samadhaan.dev');
      const key = await upload(ownerCookies, jpeg, 'mine.jpg');

      const otherCookies = await loginAs('citizen2@samadhaan.dev');

      const response = await request(server)
        .post('/api/v1/problems')
        .set('Cookie', otherCookies)
        .send(
          reportBody({ images: [{ storageKey: key, sortOrder: 0, isPrimary: true }] }),
        )
        .expect(400);

      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('rejects the same image attached twice', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');
      const key = await upload(cookies, jpeg, 'one.jpg');

      await request(server)
        .post('/api/v1/problems')
        .set('Cookie', cookies)
        .send(
          reportBody({
            images: [
              { storageKey: key, sortOrder: 0, isPrimary: true },
              { storageKey: key, sortOrder: 1, isPrimary: false },
            ],
          }),
        )
        .expect(400);
    });

    // An upload is single-use: once attached, the key cannot be claimed again.
    it('rejects a key that has already been attached to a problem', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');
      const key = await upload(cookies, jpeg, 'one.jpg');

      const first = await request(server)
        .post('/api/v1/problems')
        .set('Cookie', cookies)
        .send(
          reportBody({ images: [{ storageKey: key, sortOrder: 0, isPrimary: true }] }),
        )
        .expect(201);

      createdProblemIds.push(first.body.data.id);

      await request(server)
        .post('/api/v1/problems')
        .set('Cookie', cookies)
        .send(
          reportBody({ images: [{ storageKey: key, sortOrder: 0, isPrimary: true }] }),
        )
        .expect(400);
    });
  });

  // ================================================================ atomicity

  describe('Atomicity', () => {
    /**
     * A report that exists without the photo proving it is worse than no
     * report: nothing downstream can distinguish "no photo was taken" from
     * "the photo was lost".
     */
    it('creates no problem when an attached image is invalid', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');
      const valid = await upload(cookies, jpeg, 'one.jpg');

      const before = await prisma.problem.count();

      await request(server)
        .post('/api/v1/problems')
        .set('Cookie', cookies)
        .send(
          reportBody({
            title: 'A report that must not be created at all',
            images: [
              { storageKey: valid, sortOrder: 0, isPrimary: true },
              {
                storageKey: `problems/2026/09/${'f'.repeat(32)}.jpg`,
                sortOrder: 1,
                isPrimary: false,
              },
            ],
          }),
        )
        .expect(400);

      expect(await prisma.problem.count()).toBe(before);

      const orphan = await prisma.problem.findFirst({
        where: { title: 'A report that must not be created at all' },
      });
      expect(orphan).toBeNull();
    });
  });

  // ================================================================ retrieval

  describe('Retrieval', () => {
    it('serves a problem publicly by its public identifier', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');

      const created = await request(server)
        .post('/api/v1/problems')
        .set('Cookie', cookies)
        .send(reportBody())
        .expect(201);

      createdProblemIds.push(created.body.data.id);

      const response = await request(server)
        .get(`/api/v1/problems/${created.body.data.publicId}`)
        .expect(200);

      expect(response.body.data.publicId).toBe(created.body.data.publicId);
    });

    /**
     * A civic report is public, but the person who filed it did not thereby
     * consent to publishing their contact details.
     */
    it('never exposes the reporter’s private data', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');

      const created = await request(server)
        .post('/api/v1/problems')
        .set('Cookie', cookies)
        .send(reportBody())
        .expect(201);

      createdProblemIds.push(created.body.data.id);

      const response = await request(server).get(
        `/api/v1/problems/${created.body.data.publicId}`,
      );

      const body = JSON.stringify(response.body);
      expect(body).not.toContain('citizen@samadhaan.dev');
      expect(body).not.toContain('argon2');
      expect(response.body.data.reporter).not.toHaveProperty('email');
      expect(response.body.data.reporter).not.toHaveProperty('phone');
      expect(Object.keys(response.body.data.reporter).sort()).toEqual([
        'avatarUrl',
        'id',
        'name',
      ]);
    });

    it('returns 404 for an unknown identifier', async () => {
      await request(server).get('/api/v1/problems/SAM-99999999').expect(404);
    });

    it('lists the signed-in user’s own reports', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');

      const response = await request(server)
        .get('/api/v1/problems/mine')
        .set('Cookie', cookies)
        .expect(200);

      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('requires authentication to list own reports', async () => {
      await request(server).get('/api/v1/problems/mine').expect(401);
    });
  });

  // ==================================================================== media

  describe('Media serving', () => {
    it('serves an uploaded image with hardening headers', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');
      const key = await upload(cookies, jpeg, 'one.jpg');

      const response = await request(server).get(`/api/v1/media/${key}`).expect(200);

      expect(response.headers['content-type']).toContain('image/jpeg');
      // Stops a browser re-interpreting the bytes as another type.
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['content-security-policy']).toContain("default-src 'none'");
    });

    it('refuses a traversal path', async () => {
      await request(server).get('/api/v1/media/../../../etc/passwd').expect(404);
      await request(server).get('/api/v1/media/problems/../../secret').expect(404);
    });

    it('returns 404 for an unknown key', async () => {
      await request(server)
        .get(`/api/v1/media/problems/2026/09/${'0'.repeat(32)}.jpg`)
        .expect(404);
    });
  });
});
