import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AiService, type EmbeddingOutcome } from '../src/ai/ai.service.js';
import { configureApp, registerNotFoundHandler } from '../src/bootstrap.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { RedisService } from '../src/redis/redis.service.js';

/**
 * Duplicate detection, end to end against the real application: real pgvector
 * search, real PostGIS distance, real guards, real database writes.
 *
 * The *encoder* is stubbed and nothing else. Vectors are constructed by hand so
 * that "these two reports are similar" is an input to the test rather than a
 * property of a downloaded model — which keeps the assertions about the
 * pipeline, and keeps the suite from depending on a 90 MB download. The model
 * itself is exercised by `services/ai/tests/test_embeddings.py`.
 */
describe('Duplicate detection (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let server: Parameters<typeof request>[0];

  const SEEDED_PASSWORD = 'DevPassword123!';
  const createdProblemIds: string[] = [];

  const DIMENSIONS = 384;

  /**
   * Unit vectors whose pairwise cosine similarity is known by construction.
   *
   * Two axes: `POTHOLE` and `STREETLIGHT` are orthogonal (similarity 0), while
   * `POTHOLE_NEAR` sits at a chosen angle from `POTHOLE`.
   */
  function axisVector(axis: number): number[] {
    return Array.from({ length: DIMENSIONS }, (_, index) => (index === axis ? 1 : 0));
  }

  /** Cosine ~0.92 with `axisVector(0)`, by construction. */
  function similarToPothole(): number[] {
    const vector = Array.from({ length: DIMENSIONS }, () => 0);
    vector[0] = 0.92;
    vector[1] = Math.sqrt(1 - 0.92 ** 2);
    return vector;
  }

  const VECTORS = {
    pothole: axisVector(0),
    potholeSimilar: similarToPothole(),
    streetlight: axisVector(5),
  };

  /** What the stubbed encoder returns next. Tests set this. */
  let nextVector: number[] = VECTORS.pothole;
  let embeddingFails = false;

  const embedText = vi.fn(async (): Promise<EmbeddingOutcome> => {
    if (embeddingFails) {
      return {
        ok: false,
        failure: {
          code: 'PROVIDER_UNAVAILABLE',
          message: 'The analysis service could not be reached.',
          retryable: false,
        },
      };
    }

    return {
      ok: true,
      embeddings: {
        vectors: [nextVector],
        provider: 'test',
        modelName: 'test-encoder',
        modelVersion: 'test/1.0',
        dimensions: DIMENSIONS,
        normalized: true,
        processingMs: 5,
      },
    };
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AiService)
      .useValue({
        embedText,
        // Problem analysis runs on submit too; stubbed so this suite does not
        // depend on the vision provider.
        analyzeProblem: async () => ({
          ok: false,
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
  });

  afterAll(async () => {
    await prisma.problemDuplicateCandidate
      .deleteMany({
        where: {
          OR: [
            { problemId: { in: createdProblemIds } },
            { candidateProblemId: { in: createdProblemIds } },
          ],
        },
      })
      .catch(() => undefined);
    await prisma.problemEmbedding
      .deleteMany({ where: { problemId: { in: createdProblemIds } } })
      .catch(() => undefined);
    await prisma.problemAiAnalysis
      .deleteMany({ where: { problemId: { in: createdProblemIds } } })
      .catch(() => undefined);
    await prisma.problem
      .deleteMany({ where: { id: { in: createdProblemIds } } })
      .catch(() => undefined);

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

  /** Files a report with a chosen embedding and location. */
  async function report(
    cookies: string[],
    options: {
      title: string;
      description?: string;
      category?: string;
      vector: number[];
      latitude: number;
      longitude: number;
      city?: string;
    },
  ): Promise<{ id: string; publicId: string }> {
    nextVector = options.vector;

    const response = await request(server)
      .post('/api/v1/problems')
      .set('Cookie', cookies)
      .send({
        title: options.title,
        description:
          options.description ??
          'A deep pothole has opened at the market entrance and vehicles are swerving around it.',
        category: options.category ?? 'POTHOLES',
        location: {
          latitude: options.latitude,
          longitude: options.longitude,
          city: options.city ?? 'Gurugram',
        },
      })
      .expect(201);

    const problem = response.body.data as { id: string; publicId: string };
    createdProblemIds.push(problem.id);
    return problem;
  }

  /** Polls the public endpoint until the check settles, as the browser does. */
  async function pollUntilChecked(
    publicId: string,
    attempts = 50,
  ): Promise<Record<string, any>> {
    for (let i = 0; i < attempts; i += 1) {
      const response = await request(server)
        .get(`/api/v1/problems/${publicId}/similar`)
        .expect(200);

      const check = response.body.data as Record<string, any>;
      if (check.status === 'COMPLETED' || check.status === 'FAILED') return check;

      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    throw new Error(`Duplicate check for ${publicId} never settled`);
  }

  // ================================================== the detection pipeline

  describe('Detecting a duplicate', () => {
    let original: { id: string; publicId: string };
    let duplicate: { id: string; publicId: string };

    beforeAll(async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');

      original = await report(cookies, {
        title: 'Large pothole near the Sector 12 market',
        vector: VECTORS.pothole,
        latitude: 28.4595,
        longitude: 77.0266,
      });
      await pollUntilChecked(original.publicId);

      duplicate = await report(cookies, {
        title: 'Huge pothole outside the Sector 12 market entrance',
        vector: VECTORS.potholeSimilar,
        // ~40 m away.
        latitude: 28.4598,
        longitude: 77.0268,
      });
      await pollUntilChecked(duplicate.publicId);
    });

    it('finds the earlier report and scores it', async () => {
      const response = await request(server)
        .get(`/api/v1/problems/${duplicate.publicId}/similar`)
        .expect(200);

      const check = response.body.data;
      expect(check.status).toBe('COMPLETED');
      expect(check.candidates).toHaveLength(1);

      const candidate = check.candidates[0];
      expect(candidate.problem.publicId).toBe(original.publicId);
      expect(candidate.verdict).toBe('LIKELY_DUPLICATE');
      expect(candidate.similarity).toBeGreaterThan(0.85);
      expect(candidate.confidence).toBeGreaterThan(0);
    });

    // The PostGIS half of the pipeline, measured through the API.
    it('reports a real distance computed by PostGIS', async () => {
      const response = await request(server)
        .get(`/api/v1/problems/${duplicate.publicId}/similar`)
        .expect(200);

      const { distanceMeters } = response.body.data.candidates[0];
      expect(distanceMeters).toBeGreaterThan(0);
      expect(distanceMeters).toBeLessThan(120);
    });

    it('returns every signal that contributed', async () => {
      const response = await request(server)
        .get(`/api/v1/problems/${duplicate.publicId}/similar`)
        .expect(200);

      const { signals } = response.body.data.candidates[0];
      expect(signals.text).toBeGreaterThan(0.85);
      expect(signals.geographic).toBeGreaterThan(0.9);
      expect(signals.category).toBe(1);
      expect(signals.temporal).toBeGreaterThan(0);
      // No image encoder exists; the signal is absent, never fabricated.
      expect(signals.image).toBeNull();
    });

    it('explains the match in checkable facts', async () => {
      const response = await request(server)
        .get(`/api/v1/problems/${duplicate.publicId}/similar`)
        .expect(200);

      const { evidence } = response.body.data.candidates[0];
      expect(evidence.length).toBeGreaterThan(0);
      for (const entry of evidence) {
        expect(entry.label).not.toMatch(/\b(AI|model|vector|embedding)\b/i);
      }
    });

    /**
     * The security property of this whole feature. An embedding reconstructs
     * its source text; publishing the corpus would let anyone probe the
     * similarity space offline.
     */
    it('never exposes a raw vector', async () => {
      const response = await request(server)
        .get(`/api/v1/problems/${duplicate.publicId}/similar`)
        .expect(200);

      const body = JSON.stringify(response.body);
      expect(body).not.toContain('embedding');
      expect(body).not.toMatch(/"vector"/);
      // A 384-float array would be unmistakable in the payload.
      expect(body.length).toBeLessThan(20_000);
    });

    it('persists the pair with its component signals', async () => {
      const row = await prisma.problemDuplicateCandidate.findFirst({
        where: { problemId: duplicate.id, candidateProblemId: original.id },
      });

      expect(row).not.toBeNull();
      expect(row?.status).toBe('LIKELY_DUPLICATE');
      expect(Number(row?.textSimilarity)).toBeGreaterThan(0.85);
      expect(Number(row?.geographicSimilarity)).toBeGreaterThan(0.9);
      expect(Number(row?.combinedScore)).toBeGreaterThan(0.85);
      // Never written by scoring — only a person sets this.
      expect(row?.status).not.toBe('CONFIRMED_DUPLICATE');
    });

    it('stores the embedding with its model and width', async () => {
      const embedding = await prisma.problemEmbedding.findFirst({
        where: { problemId: duplicate.id, embeddingType: 'TEXT' },
      });

      expect(embedding).toMatchObject({
        modelName: 'test-encoder',
        modelVersion: 'test/1.0',
        dimensions: DIMENSIONS,
      });
    });

    /**
     * Direction matters: the newer report is checked against the older one,
     * because merging is directional and the older report is canonical.
     */
    it('records the pair in one direction only', async () => {
      const forward = await prisma.problemDuplicateCandidate.count({
        where: { problemId: duplicate.id, candidateProblemId: original.id },
      });
      const backward = await prisma.problemDuplicateCandidate.count({
        where: { problemId: original.id, candidateProblemId: duplicate.id },
      });

      expect(forward).toBe(1);
      expect(backward).toBe(0);
    });

    it('does not create a second row when the check is re-run', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');
      nextVector = VECTORS.potholeSimilar;

      await request(server)
        .post(`/api/v1/problems/${duplicate.publicId}/duplicates/analyze`)
        .set('Cookie', cookies)
        .expect(202);

      await pollUntilChecked(duplicate.publicId);

      const count = await prisma.problemDuplicateCandidate.count({
        where: { problemId: duplicate.id, candidateProblemId: original.id },
      });
      expect(count).toBe(1);
    });
  });

  // ================================================== candidates that must not match

  describe('Rejecting implausible candidates', () => {
    it('does not match an identical report filed far away', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');

      // The same vector as the Sector 12 pothole, ~230 km away in Jaipur.
      const distant = await report(cookies, {
        title: 'Large pothole near the main market',
        vector: VECTORS.pothole,
        latitude: 26.9196,
        longitude: 75.8206,
        city: 'Jaipur',
      });

      const check = await pollUntilChecked(distant.publicId);

      expect(check.status).toBe('COMPLETED');
      expect(check.candidates).toEqual([]);
    });

    it('does not match a nearby report about a different kind of problem', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');

      const streetlight = await report(cookies, {
        title: 'Streetlight out near the Sector 12 market',
        description:
          'The light outside the market gate has not worked for two weeks and the path is dark.',
        category: 'STREETLIGHTS',
        vector: VECTORS.streetlight,
        latitude: 28.4596,
        longitude: 77.0267,
      });

      const check = await pollUntilChecked(streetlight.publicId);

      expect(check.status).toBe('COMPLETED');
      expect(check.candidates).toEqual([]);
    });
  });

  // ============================================================== failures

  describe('When the check fails', () => {
    it('marks the check FAILED and leaves the report intact', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');
      embeddingFails = true;

      const problem = await report(cookies, {
        title: 'Pothole that could not be checked for duplicates',
        vector: VECTORS.pothole,
        latitude: 28.4599,
        longitude: 77.0269,
      });

      const check = await pollUntilChecked(problem.publicId);
      embeddingFails = false;

      expect(check.status).toBe('FAILED');
      expect(check.candidates).toEqual([]);
      expect(check.errorMessage).toBe('The analysis service could not be reached.');

      // The civic report is the thing of value. It survives.
      const response = await request(server)
        .get(`/api/v1/problems/${problem.publicId}`)
        .expect(200);
      expect(response.body.data.publicId).toBe(problem.publicId);

      const row = await prisma.problem.findUnique({ where: { id: problem.id } });
      expect(row?.deletedAt).toBeNull();
      expect(row?.status).toBe('SUBMITTED');
    });

    it('returns a PENDING check for a problem never checked', async () => {
      const response = await request(server)
        .get('/api/v1/problems/SAM-1000/similar')
        .expect(200);

      // Not a 404: "nothing checked yet" is a state the UI renders.
      expect(response.body.data.status).toBeDefined();
      expect(Array.isArray(response.body.data.candidates)).toBe(true);
    });
  });

  // ========================================================= authorisation

  describe('Reviewing a candidate', () => {
    let source: { id: string; publicId: string };
    let target: { id: string; publicId: string };
    let candidateId: string;

    beforeAll(async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');

      target = await report(cookies, {
        title: 'Pothole on the review test road',
        vector: VECTORS.pothole,
        latitude: 28.462,
        longitude: 77.029,
      });
      await pollUntilChecked(target.publicId);

      source = await report(cookies, {
        title: 'Another pothole on the review test road',
        vector: VECTORS.potholeSimilar,
        latitude: 28.4621,
        longitude: 77.0291,
      });
      const check = await pollUntilChecked(source.publicId);

      candidateId = check.candidates[0].candidateId;
    });

    it('refuses an anonymous caller', async () => {
      await request(server)
        .post(`/api/v1/problems/${source.publicId}/duplicates/${candidateId}/confirm`)
        .expect(401);

      await request(server)
        .post(`/api/v1/problems/${source.publicId}/duplicates/${candidateId}/reject`)
        .expect(401);
    });

    it('refuses a signed-in user who did not file the report', async () => {
      const cookies = await loginAs('citizen2@samadhaan.dev');

      await request(server)
        .post(`/api/v1/problems/${source.publicId}/duplicates/${candidateId}/confirm`)
        .set('Cookie', cookies)
        .expect(403);
    });

    it('refuses an organisation account', async () => {
      const cookies = await loginAs('ngo@samadhaan.dev');

      await request(server)
        .post(`/api/v1/problems/${source.publicId}/duplicates/${candidateId}/reject`)
        .set('Cookie', cookies)
        .expect(403);
    });

    it('refuses a re-check from someone else', async () => {
      const cookies = await loginAs('citizen2@samadhaan.dev');

      await request(server)
        .post(`/api/v1/problems/${source.publicId}/duplicates/analyze`)
        .set('Cookie', cookies)
        .expect(403);
    });

    /**
     * IDOR: a caller authorised on their own report must not be able to rule on
     * a pair belonging to someone else's by passing its id.
     */
    it('refuses a candidate id belonging to another problem', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');

      await request(server)
        .post(`/api/v1/problems/${target.publicId}/duplicates/${candidateId}/confirm`)
        .set('Cookie', cookies)
        .expect(404);
    });

    it('lets the reporter say the two reports are different', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');

      const response = await request(server)
        .post(`/api/v1/problems/${source.publicId}/duplicates/${candidateId}/reject`)
        .set('Cookie', cookies)
        .expect(201);

      // Withdrawn from the suggestions. Other candidates for this problem may
      // remain — only the reviewed pair disappears.
      const remaining = response.body.data.candidates as Array<{ candidateId: string }>;
      expect(remaining.map((entry) => entry.candidateId)).not.toContain(candidateId);

      const row = await prisma.problemDuplicateCandidate.findUnique({
        where: { id: candidateId },
      });
      // Kept, not deleted: confirmed negatives are the scarcer half of the
      // training data a learned scorer will need.
      expect(row).not.toBeNull();
      expect(row?.status).toBe('NOT_DUPLICATE');
      expect(row?.reviewedById).not.toBeNull();
      expect(row?.reviewedAt).not.toBeNull();

      // Neither problem is harmed.
      const problem = await prisma.problem.findUnique({ where: { id: source.id } });
      expect(problem?.status).toBe('SUBMITTED');
      expect(problem?.duplicateOfId).toBeNull();
    });

    it('refuses to review the same pair twice', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');

      await request(server)
        .post(`/api/v1/problems/${source.publicId}/duplicates/${candidateId}/confirm`)
        .set('Cookie', cookies)
        .expect(409);
    });

    it('does not resurrect a rejected pair on re-check', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');
      nextVector = VECTORS.potholeSimilar;

      await request(server)
        .post(`/api/v1/problems/${source.publicId}/duplicates/analyze`)
        .set('Cookie', cookies)
        .expect(202);

      await pollUntilChecked(source.publicId);

      const row = await prisma.problemDuplicateCandidate.findUnique({
        where: { id: candidateId },
      });
      // A person's decision is not the algorithm's to withdraw.
      expect(row?.status).toBe('NOT_DUPLICATE');
    });
  });

  describe('Confirming a duplicate', () => {
    it('links the newer report to the older one and marks it DUPLICATE', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');

      const older = await report(cookies, {
        title: 'Pothole on the confirm test lane',
        vector: VECTORS.pothole,
        latitude: 28.465,
        longitude: 77.032,
      });
      await pollUntilChecked(older.publicId);

      const newer = await report(cookies, {
        title: 'Another pothole on the confirm test lane',
        vector: VECTORS.potholeSimilar,
        latitude: 28.4651,
        longitude: 77.0321,
      });
      const check = await pollUntilChecked(newer.publicId);
      const candidateId = check.candidates[0].candidateId;

      await request(server)
        .post(`/api/v1/problems/${newer.publicId}/duplicates/${candidateId}/confirm`)
        .set('Cookie', cookies)
        .expect(201);

      const problem = await prisma.problem.findUnique({ where: { id: newer.id } });
      expect(problem?.duplicateOfId).toBe(older.id);
      expect(problem?.status).toBe('DUPLICATE');

      // Neither report is deleted — the newer one is evidence the problem is
      // still there, and the count of people who hit it matters.
      const original = await prisma.problem.findUnique({ where: { id: older.id } });
      expect(original?.deletedAt).toBeNull();
      expect(problem?.deletedAt).toBeNull();

      const row = await prisma.problemDuplicateCandidate.findUnique({
        where: { id: candidateId },
      });
      expect(row?.status).toBe('CONFIRMED_DUPLICATE');

      // The decision is auditable.
      const audit = await prisma.auditLog.findFirst({
        where: { action: 'PROBLEM_DUPLICATE_CONFIRMED', entityId: newer.id },
      });
      expect(audit).not.toBeNull();
    });
  });

  // ============================================== client-supplied scores

  /**
   * Similarity is generated server-side and only server-side. The global
   * validation pipe runs `forbidNonWhitelisted`, so a body carrying scoring or
   * duplicate fields is rejected outright rather than silently stripped — a
   * client bug fails loudly instead of quietly doing nothing.
   */
  it('rejects a report that tries to supply its own scores', async () => {
    const cookies = await loginAs('citizen@samadhaan.dev');
    nextVector = VECTORS.pothole;

    for (const injected of [
      { combinedScore: 1 },
      { confidence: 1 },
      { textSimilarity: 1 },
      { duplicateOfId: '00000000-0000-0000-0000-000000000001' },
      { status: 'VERIFIED' },
    ]) {
      await request(server)
        .post('/api/v1/problems')
        .set('Cookie', cookies)
        .send({
          title: 'Pothole with attacker-supplied scores attached',
          description:
            'A deep pothole has opened at the market entrance and vehicles are swerving around it.',
          category: 'POTHOLES',
          location: { latitude: 28.47, longitude: 77.035, city: 'Gurugram' },
          ...injected,
        })
        .expect(400);
    }
  });

  it('files a clean report at SUBMITTED with no duplicate link', async () => {
    const cookies = await loginAs('citizen@samadhaan.dev');

    const created = await report(cookies, {
      title: 'Pothole filed without any injected fields',
      vector: VECTORS.pothole,
      latitude: 28.47,
      longitude: 77.035,
    });

    const problem = await prisma.problem.findUnique({ where: { id: created.id } });
    expect(problem?.status).toBe('SUBMITTED');
    expect(problem?.duplicateOfId).toBeNull();
  });
});
