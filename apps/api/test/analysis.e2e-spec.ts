import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AiService, type AnalysisOutcome } from '../src/ai/ai.service.js';
import { configureApp, registerNotFoundHandler } from '../src/bootstrap.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { RedisService } from '../src/redis/redis.service.js';

/**
 * AI analysis, end to end against the real application — real guards, real
 * database writes, real polling contract.
 *
 * `AiService` is the one thing replaced. Every other layer is the real one, so
 * this exercises the orchestration, persistence and authorisation that the
 * provider sits behind — without spending money or depending on a model's mood
 * for a deterministic assertion.
 */
describe('AI problem analysis (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let server: Parameters<typeof request>[0];

  const SEEDED_PASSWORD = 'DevPassword123!';
  const createdProblemIds: string[] = [];

  /** What the stubbed provider returns next. Tests set this. */
  let nextOutcome: AnalysisOutcome;
  const analyzeProblem = vi.fn(async () => nextOutcome);

  const COMPLETED: AnalysisOutcome = {
    ok: true,
    analysis: {
      provider: 'test',
      modelName: 'test-model',
      modelVersion: 'test-model-1',
      category: 'DRAINAGE',
      subcategory: 'standing water',
      severity: 'HIGH',
      urgency: 'HIGH',
      summary: 'Standing water at a market entrance has caused people to slip.',
      confidence: 0.88,
      observations: ['Water is described as standing for three days.'],
      severityScore: 7.5,
      processingMs: 1200,
      textOnly: true,
    },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AiService)
      .useValue({ analyzeProblem, getHealth: async () => null })
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    registerNotFoundHandler(app);

    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    server = app.getHttpServer();

    nextOutcome = COMPLETED;
    await clearRateLimits();
  });

  afterAll(async () => {
    await prisma.problemAiAnalysis
      .deleteMany({ where: { problemId: { in: createdProblemIds } } })
      .catch(() => undefined);
    await prisma.problem
      .deleteMany({ where: { id: { in: createdProblemIds } } })
      .catch(() => undefined);

    await app?.close();
  });

  afterEach(() => {
    analyzeProblem.mockClear();
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

  /** Files a report and remembers it for cleanup. */
  async function report(cookies: string[]): Promise<{ id: string; publicId: string }> {
    const response = await request(server)
      .post('/api/v1/problems')
      .set('Cookie', cookies)
      .send({
        title: 'Waterlogging near the Sector 12 market entrance',
        description:
          'Water has been standing at the market entrance for three days after the last rain. Two people have slipped.',
        category: 'DRAINAGE',
        location: { latitude: 28.4595, longitude: 77.0266, city: 'Gurugram' },
      })
      .expect(201);

    const problem = response.body.data as { id: string; publicId: string };
    createdProblemIds.push(problem.id);
    return problem;
  }

  /**
   * Polls the public endpoint the way the browser does, until the analysis
   * reaches a terminal state. Asserting on a background job any other way is
   * how a suite becomes flaky.
   */
  async function pollUntilSettled(
    publicId: string,
    attempts = 40,
  ): Promise<Record<string, any>> {
    for (let i = 0; i < attempts; i += 1) {
      const response = await request(server)
        .get(`/api/v1/problems/${publicId}/analysis`)
        .expect(200);

      const analysis = response.body.data as Record<string, any> | null;
      if (analysis && (analysis.status === 'COMPLETED' || analysis.status === 'FAILED')) {
        return analysis;
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    throw new Error(`Analysis for ${publicId} never settled`);
  }

  // ============================================================== the happy path

  describe('Submitting a problem triggers analysis', () => {
    it('analyses a new report and persists the result', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');
      const problem = await report(cookies);

      const analysis = await pollUntilSettled(problem.publicId);

      expect(analyzeProblem).toHaveBeenCalled();
      expect(analysis).toMatchObject({
        status: 'COMPLETED',
        category: 'DRAINAGE',
        subcategory: 'standing water',
        severity: 'HIGH',
        urgency: 'HIGH',
        confidence: 0.88,
        severityScore: 7.5,
        modelName: 'test-model',
        observations: ['Water is described as standing for three days.'],
        errorMessage: null,
      });

      // Persisted, not just returned.
      const row = await prisma.problemAiAnalysis.findFirst({
        where: { problemId: problem.id },
      });
      expect(row?.processingStatus).toBe('COMPLETED');
      expect(Number(row?.confidence)).toBe(0.88);
    });

    it('returns the documented response shape and nothing more', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');
      const problem = await report(cookies);
      const analysis = await pollUntilSettled(problem.publicId);

      expect(Object.keys(analysis).sort()).toEqual(
        [
          'category',
          'confidence',
          'createdAt',
          'errorMessage',
          'id',
          'modelName',
          'observations',
          'processingMs',
          'severity',
          'severityScore',
          'status',
          'subcategory',
          'summary',
          'textOnly',
          'updatedAt',
          'urgency',
        ].sort(),
      );
      // Internal provenance and prompts never cross the boundary.
      expect(analysis).not.toHaveProperty('rawResult');
      expect(analysis).not.toHaveProperty('provider');
    });

    // AI recommends; a reviewer decides. The report is the citizen's record.
    it('leaves the reported category and status untouched', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');
      const problem = await report(cookies);
      await pollUntilSettled(problem.publicId);

      const row = await prisma.problem.findUnique({ where: { id: problem.id } });
      expect(row?.category).toBe('DRAINAGE');
      expect(row?.status).toBe('SUBMITTED');
    });

    it('returns null for a problem that has no analysis', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');
      const problem = await report(cookies);
      await pollUntilSettled(problem.publicId);

      await prisma.problemAiAnalysis.deleteMany({ where: { problemId: problem.id } });

      const response = await request(server)
        .get(`/api/v1/problems/${problem.publicId}/analysis`)
        .expect(200);

      // Not a 404: "no analysis" is a state the UI renders, not an error.
      expect(response.body.data).toBeNull();
    });
  });

  // ================================================================== failure

  describe('When analysis fails', () => {
    it('marks the analysis FAILED and keeps the report intact', async () => {
      nextOutcome = {
        ok: false,
        failure: {
          code: 'PROVIDER_UNAVAILABLE',
          message: 'The analysis service could not be reached.',
          retryable: false,
        },
      };

      const cookies = await loginAs('citizen@samadhaan.dev');
      const problem = await report(cookies);

      const analysis = await pollUntilSettled(problem.publicId);

      expect(analysis).toMatchObject({
        status: 'FAILED',
        errorMessage: 'The analysis service could not be reached.',
        category: null,
        confidence: null,
      });

      // The civic report is the thing of value. It survives.
      const response = await request(server)
        .get(`/api/v1/problems/${problem.publicId}`)
        .expect(200);
      expect(response.body.data).toMatchObject({
        publicId: problem.publicId,
        title: 'Waterlogging near the Sector 12 market entrance',
      });

      const row = await prisma.problem.findUnique({ where: { id: problem.id } });
      expect(row?.deletedAt).toBeNull();

      nextOutcome = COMPLETED;
    });

    it('does not leak a provider error to the client', async () => {
      nextOutcome = {
        ok: false,
        failure: {
          code: 'PROVIDER_ERROR',
          message: 'The analysis service returned an error.',
          retryable: false,
        },
      };

      const cookies = await loginAs('citizen@samadhaan.dev');
      const problem = await report(cookies);
      const analysis = await pollUntilSettled(problem.publicId);

      expect(analysis.errorMessage).toBe('The analysis service returned an error.');
      expect(analysis.errorMessage).not.toMatch(/api[-_ ]?key|token|sk-|Traceback/i);

      nextOutcome = COMPLETED;
    });
  });

  // ============================================================ re-analysis

  describe('Re-analysis authorisation', () => {
    let publicId: string;

    beforeAll(async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');
      const problem = await report(cookies);
      await pollUntilSettled(problem.publicId);
      publicId = problem.publicId;
    });

    it('refuses an anonymous caller', async () => {
      await request(server).post(`/api/v1/problems/${publicId}/analyze`).expect(401);
    });

    it('refuses a signed-in user who did not file the report', async () => {
      const cookies = await loginAs('citizen2@samadhaan.dev');

      await request(server)
        .post(`/api/v1/problems/${publicId}/analyze`)
        .set('Cookie', cookies)
        .expect(403);
    });

    it('refuses an organisation account', async () => {
      const cookies = await loginAs('ngo@samadhaan.dev');

      await request(server)
        .post(`/api/v1/problems/${publicId}/analyze`)
        .set('Cookie', cookies)
        .expect(403);
    });

    it('allows the reporter, and records a new analysis rather than overwriting', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');
      const before = await prisma.problemAiAnalysis.count({
        where: { problem: { publicId } },
      });

      const response = await request(server)
        .post(`/api/v1/problems/${publicId}/analyze`)
        .set('Cookie', cookies)
        .expect(202);

      // 202: queued, not finished. The client polls from here.
      expect(response.body.data.status).toMatch(/PENDING|PROCESSING|COMPLETED/);

      await pollUntilSettled(publicId);

      const after = await prisma.problemAiAnalysis.count({
        where: { problem: { publicId } },
      });
      // History is preserved: an earlier model's answer stays readable.
      expect(after).toBe(before + 1);
    });
  });
});
