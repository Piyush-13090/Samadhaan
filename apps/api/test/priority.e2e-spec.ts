import { createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { err, ok } from '@samadhaan/shared';
import { AppModule } from '../src/app.module.js';
import { AiClient, AiRequestError } from '../src/ai/ai.client.js';
import { configureApp, registerNotFoundHandler } from '../src/bootstrap.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { DomainEventBus } from '../src/events/domain-event-bus.js';
import { KnowledgeIngestionService } from '../src/knowledge/knowledge-ingestion.service.js';
import { PriorityCalculationService } from '../src/priority/priority-calculation.service.js';
import { PriorityJobsService } from '../src/priority/priority-jobs.service.js';
import { RedisService } from '../src/redis/redis.service.js';
import { deleteAuditLogs } from './audit-maintenance.js';

/**
 * AI Priority Engine (Prompt 21) end to end, against real PostgreSQL/PostGIS.
 *
 * Only the AI transport is faked. `/priority/features` returns configurable
 * signals and records every request; `/embeddings/text` and `/knowledge/chunk`
 * are deterministic doubles so the supporting-guidance retrieval runs the real
 * SQL and access predicate.
 */
describe('AI Priority Engine (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let calculation: PriorityCalculationService;
  let jobs: PriorityJobsService;
  let bus: DomainEventBus;
  let server: Parameters<typeof request>[0];

  const PASSWORD = 'DevPassword123!';
  const PREFIX = 'e2e-prio-';
  const TITLE = 'Priority probe ';
  const EMAIL = (key: string) => `${PREFIX}${key}@samadhaan.test`;

  type Mode = 'ai' | 'none' | 'fail';
  let mode: Mode = 'ai';
  const featureCalls: Array<Record<string, unknown>> = [];

  const users: Record<string, string> = {};
  const cookies: Record<string, string[]> = {};
  const problems: Record<string, { id: string; publicId: string }> = {};
  const orgs: Record<string, string> = {};

  // ----------------------------------------------------------------- fakes

  function embed(text: string): number[] {
    const vector = Array.from({ length: 384 }, () => 0);
    for (const word of text.toLowerCase().match(/[a-z]{3,}/g) ?? []) {
      vector[createHash('md5').update(word).digest().readUInt32BE(0) % 384]! += 1;
    }
    const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0)) || 1;
    return vector.map((v) => v / norm);
  }

  const fakeClient = {
    post: async (path: string, body: Record<string, unknown>) => {
      if (path === '/priority/features') {
        featureCalls.push(body);
        if (mode === 'fail') {
          return err(
            new AiRequestError('down', 503, {
              code: 'PROVIDER_UNAVAILABLE',
              message: 'x',
              retryable: true,
            }),
          );
        }
        const hazardous = String(body.category) === 'ELECTRICITY';
        const signal = (value: number, confidence: number, evidence: string[]) =>
          mode === 'none'
            ? { value: null, confidence: 0, evidence: [] }
            : { value, confidence, evidence };
        return ok({
          safety_risk: signal(
            hazardous ? 0.95 : 0.1,
            0.9,
            hazardous ? ['live wire in floodwater'] : [],
          ),
          urgency: signal(hazardous ? 0.9 : 0.15, 0.85, []),
          impact_breadth: signal(hazardous ? 0.7 : 0.2, 0.8, []),
          stated_affected:
            mode === 'ai' && hazardous
              ? {
                  value: 200,
                  unit: 'households',
                  confidence: 0.9,
                  evidence: ['about 200 families'],
                }
              : { value: null, unit: 'unknown', confidence: 0, evidence: [] },
          ai_ran: mode === 'ai',
          provider: mode === 'ai' ? 'fake' : 'development',
          model_name: mode === 'ai' ? 'fake-priority' : 'development',
          model_version: '1',
          prompt_version: 'priority-features-2026-10-v1',
          processing_ms: 3,
          dropped_evidence: 0,
        });
      }
      if (path === '/embeddings/text') {
        const texts = body.texts as string[];
        return ok({
          embeddings: texts.map((t, index) => ({ index, embedding: embed(t) })),
          provider: 'test',
          model_name: 'test-hash-embedding',
          model_version: '1',
          dimensions: 384,
          normalized: true,
          processing_ms: 1,
        });
      }
      if (path === '/knowledge/chunk') {
        const text = body.text as string;
        return ok({
          detected_type: 'text/markdown',
          page_count: null,
          character_count: text.length,
          chunks: [
            {
              index: 0,
              content: text,
              token_count: 20,
              section_title: 'Electrical hazards',
              page_number: null,
              content_hash: createHash('sha256').update(text).digest('hex'),
            },
          ],
          chunker_version: 'paragraph-v1',
          processing_ms: 1,
        });
      }
      return err(
        new AiRequestError('n/a', 503, {
          code: 'PROVIDER_UNAVAILABLE',
          message: 'n/a',
          retryable: false,
        }),
      );
    },
    get: async () => err(new Error('not used')),
  };

  // ----------------------------------------------------------------- setup

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AiClient)
      .useValue(fakeClient)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    registerNotFoundHandler(app);
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    calculation = app.get(PriorityCalculationService);
    jobs = app.get(PriorityJobsService);
    bus = app.get(DomainEventBus);

    await cleanUp();

    const template = await prisma.user.findUniqueOrThrow({
      where: { email: 'government@samadhaan.dev' },
    });
    for (const [key, role] of [
      ['official', 'GOVERNMENT'],
      ['official2', 'GOVERNMENT'],
      ['other', 'GOVERNMENT'],
      ['lapsed', 'GOVERNMENT'],
      ['ngo', 'NGO'],
      ['citizen', 'CITIZEN'],
      ['supporter1', 'CITIZEN'],
      ['supporter2', 'CITIZEN'],
      ['supporter3', 'CITIZEN'],
    ] as const) {
      users[key] = (
        await prisma.user.create({
          data: {
            email: EMAIL(key),
            passwordHash: template.passwordHash,
            fullName: `Prio ${key}`,
            role,
            status: 'ACTIVE',
          },
        })
      ).id;
    }
    const office = async (
      key: string,
      bbox: number[],
      members: Array<[string, 'ACTIVE' | 'SUSPENDED']>,
    ) => {
      const created = await prisma.organization.create({
        data: {
          name: `E2E Prio ${key}`,
          slug: `${PREFIX}${key}`,
          type: 'GOVERNMENT',
          verificationStatus: 'VERIFIED',
          jurisdictionType: 'MUNICIPAL_CORPORATION',
          jurisdictionName: key,
        },
      });
      orgs[key] = created.id;
      const [w, s, e, n] = bbox;
      await prisma.$executeRaw`UPDATE organizations SET "jurisdictionBoundary" = ST_Multi(ST_MakeEnvelope(${w}, ${s}, ${e}, ${n}, 4326))::geography WHERE id = ${created.id}::uuid`;
      for (const [userKey, status] of members) {
        await prisma.organizationMember.create({
          data: {
            organizationId: created.id,
            userId: users[userKey]!,
            membershipRole: 'MEMBER',
            status,
            joinedAt: new Date(),
          },
        });
      }
    };
    await office(
      'pune',
      [73.7, 18.4, 74.0, 18.65],
      [
        ['official', 'ACTIVE'],
        ['official2', 'ACTIVE'],
        ['lapsed', 'SUSPENDED'],
      ],
    );
    await office('nagpur', [78.95, 21.05, 79.2, 21.25], [['other', 'ACTIVE']]);

    const problem = async (
      key: string,
      data: {
        category: 'ELECTRICITY' | 'PARKS' | 'POTHOLES';
        status: 'SUBMITTED' | 'VERIFIED';
        lat: number;
        lng: number;
        description: string;
        analysis?: {
          severity: 'CRITICAL' | 'LOW' | 'MEDIUM';
          score: number;
          urgency: 'HIGH' | 'LOW' | 'MEDIUM';
        };
      },
    ) => {
      const created = await prisma.problem.create({
        data: {
          reporterId: users.citizen!,
          title: `${TITLE}${key}`,
          description: data.description,
          category: data.category,
          status: data.status,
          latitude: data.lat,
          longitude: data.lng,
          city: 'Pune',
          address: '12 Example Lane, Kothrud',
          submittedAt: new Date(),
        },
      });
      problems[key] = { id: created.id, publicId: created.publicId };
      if (data.analysis) {
        await prisma.problemAiAnalysis.create({
          data: {
            problemId: created.id,
            modelName: 'fake-vision',
            modelVersion: '1',
            analysisType: 'INITIAL_ANALYSIS',
            category: data.category,
            severity: data.analysis.severity,
            urgency: data.analysis.urgency,
            severityScore: data.analysis.score,
            summary: 'Analysis summary for the e2e probe.',
            confidence: 0.9,
            processingStatus: 'COMPLETED',
            rawResult: { observations: ['cable touching water'] },
          },
        });
      }
    };
    await problem('hazard', {
      category: 'ELECTRICITY',
      status: 'VERIFIED',
      lat: 18.52,
      lng: 73.85,
      description:
        'A snapped live wire hangs into floodwater by the school gate; about 200 families use this lane.',
      analysis: { severity: 'CRITICAL', score: 9.2, urgency: 'HIGH' },
    });
    await problem('bench', {
      category: 'PARKS',
      status: 'VERIFIED',
      lat: 18.6,
      lng: 73.75,
      description: 'A park bench has a loose slat.',
      analysis: { severity: 'LOW', score: 1.5, urgency: 'LOW' },
    });
    await problem('fresh', {
      category: 'POTHOLES',
      status: 'SUBMITTED',
      lat: 18.45,
      lng: 73.9,
      description: 'A pothole on the service road.',
    });
    await problem('elsewhere', {
      category: 'POTHOLES',
      status: 'VERIFIED',
      lat: 21.15,
      lng: 79.08,
      description: 'A pothole in another city.',
      analysis: { severity: 'MEDIUM', score: 5, urgency: 'MEDIUM' },
    });

    await clearKeys();
    for (const key of ['official', 'official2', 'other', 'lapsed', 'ngo', 'citizen'])
      cookies[key] = await loginAs(EMAIL(key));
    cookies.admin = await loginAs('admin@samadhaan.dev');

    // Supporting guidance: one PUBLIC source, one PRIVATE with the same words.
    for (const [as, visibility] of [
      ['admin', 'PUBLIC'],
      ['citizen', 'PRIVATE'],
    ] as const) {
      await request(server)
        .post('/api/v1/knowledge/sources')
        .set('Cookie', cookies[as]!)
        .send({
          title: `${TITLE}${visibility} electrical guidance`,
          sourceType: 'CIVIC_GUIDELINE',
          visibility,
          content:
            'Electricity live wire safety guidance: isolate the supply and barricade the area before anyone approaches.',
        })
        .expect(201);
    }
    await app.get(KnowledgeIngestionService).idle();
  });

  beforeEach(async () => {
    mode = 'ai';
    await clearKeys();
  });

  afterAll(async () => {
    if (prisma) await cleanUp();
    await app?.close();
  });

  async function cleanUp(): Promise<void> {
    const sources = await prisma.knowledgeSource.findMany({
      where: { title: { startsWith: TITLE } },
      select: { id: true },
    });
    await deleteAuditLogs(prisma, { entityId: { in: sources.map((s) => s.id) } });
    await prisma.knowledgeSource.deleteMany({
      where: { id: { in: sources.map((s) => s.id) } },
    });
    const ids = (
      await prisma.problem.findMany({
        where: { title: { startsWith: TITLE } },
        select: { id: true },
      })
    ).map((p) => p.id);
    await prisma.notification.deleteMany({ where: { entityId: { in: ids } } });
    await deleteAuditLogs(prisma, { entityId: { in: ids } });
    await prisma.problemPriorityOverride.deleteMany({
      where: { problemId: { in: ids } },
    });
    await prisma.problem.deleteMany({ where: { id: { in: ids } } });
    await prisma.organization.deleteMany({ where: { slug: { startsWith: PREFIX } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
  }

  async function clearKeys(): Promise<void> {
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

  const gov = (as: string, slug = 'pune') => ({
    get: (path: string) =>
      request(server)
        .get(`/api/v1/government/${PREFIX}${slug}${path}`)
        .set('Cookie', cookies[as]!),
    post: (path: string, body: object = {}) =>
      request(server)
        .post(`/api/v1/government/${PREFIX}${slug}${path}`)
        .set('Cookie', cookies[as]!)
        .send(body),
    delete: (path: string, body: object = {}) =>
      request(server)
        .delete(`/api/v1/government/${PREFIX}${slug}${path}`)
        .set('Cookie', cookies[as]!)
        .send(body),
  });
  const latest = (key: string) =>
    prisma.problemPriorityAssessment.findFirstOrThrow({
      where: { problemId: problems[key]!.id },
      orderBy: { calculatedAt: 'desc' },
    });
  const count = (key: string) =>
    prisma.problemPriorityAssessment.count({ where: { problemId: problems[key]!.id } });

  // ============================================================ pipeline

  describe('feature extraction → score → persistence', () => {
    it('ranks a live electrical hazard far above a loose park bench, with reasons', async () => {
      await calculation.calculate(problems.hazard!.id, 'test');
      await calculation.calculate(problems.bench!.id, 'test');
      const hazard = await latest('hazard');
      const bench = await latest('bench');
      expect(['HIGH', 'CRITICAL']).toContain(hazard.priorityTier);
      expect(bench.priorityTier).toBe('LOW');
      expect(Number(hazard.priorityScore)).toBeGreaterThan(
        Number(bench.priorityScore) + 25,
      );
      expect(hazard).toMatchObject({
        aiStatus: 'COMPLETED',
        modelName: 'fake-priority',
        scoringModel: 'heuristic',
        scoringVersion: 'priority-heuristic-v1',
        featureVersion: 'priority-features-v1',
      });
      const texts = (hazard.explanation as Array<{ kind: string; text: string }>).map(
        (r) => r.text,
      );
      expect(texts.some((t) => t.includes('safety-risk'))).toBe(true);
      expect(texts.some((t) => /200 households/.test(t))).toBe(true);
      // The problem row carries the denormalised score for the queue.
      const row = await prisma.problem.findUniqueOrThrow({
        where: { id: problems.hazard!.id },
      });
      expect(row.priorityTier).toBe(hazard.priorityTier);
      expect(Number(row.priorityScore)).toBe(Number(hazard.priorityScore));
    });

    it('sends the AI service the report and a coarse area — never coordinates, a score, or guidance', async () => {
      const sent = featureCalls.find((c) => c.problem_id === problems.hazard!.id)!;
      expect(sent.locality).toBe('Kothrud, Pune');
      expect(JSON.stringify(sent)).not.toMatch(
        /latitude|longitude|18\.52|73\.85|score|isolate the supply/,
      );
    });

    it('marks missing data unavailable instead of zero, and stores no invented population', async () => {
      const bench = await latest('bench');
      expect(bench.affectedPopulationScore).toBeNull();
      expect(Number(bench.dataCompleteness)).toBeLessThan(1);
      const warnings = (
        bench.explanation as Array<{ kind: string; text: string }>
      ).filter((r) => r.kind === 'warning');
      expect(warnings.map((w) => w.text).join(' ')).toMatch(
        /Affected population unavailable/,
      );
    });

    it('attaches PUBLIC guidance only, as context', async () => {
      const guidance = (await latest('hazard')).guidance as Array<{ title: string }>;
      expect(guidance.map((g) => g.title)).toContain(
        `${TITLE}PUBLIC electrical guidance`,
      );
      expect(guidance.map((g) => g.title)).not.toContain(
        `${TITLE}PRIVATE electrical guidance`,
      );
    });

    it('confirms instead of duplicating history, and reuses AI features', async () => {
      const before = await count('hazard');
      const calls = featureCalls.length;
      await calculation.calculate(problems.hazard!.id, 'test');
      expect(await count('hazard')).toBe(before);
      expect(featureCalls.length).toBe(calls); // inputs unchanged: no AI call
      const forced = await calculation.calculate(problems.hazard!.id, 'test', {
        forceAi: true,
      });
      expect(featureCalls.length).toBe(calls + 1);
      expect(forced!.created).toBe(false);
    });

    it('records a new assessment, with what changed, when engagement grows', async () => {
      const id = problems.bench!.id;
      // One person supporting, following and commenting counts once.
      await prisma.problemVote.create({
        data: { problemId: id, userId: users.supporter1! },
      });
      await prisma.problemFollow.create({
        data: { problemId: id, userId: users.supporter1! },
      });
      await prisma.problemComment.create({
        data: { problemId: id, userId: users.supporter1!, body: 'Same here.' },
      });
      await prisma.problemVote.createMany({
        data: [users.supporter2!, users.supporter3!].map((userId) => ({
          problemId: id,
          userId,
        })),
      });
      const before = await count('bench');
      await calculation.calculate(id, 'engagement');
      const after = await latest('bench');
      expect(await count('bench')).toBe(before + 1);
      const facts = (after.featureMetadata as { facts: { distinctPeople: number } })
        .facts;
      expect(facts.distinctPeople).toBe(3);
      expect((after.changes as string[]).join(' ')).toMatch(/Community impact rose/);
    });

    it('scores without AI when no model ran, and when the AI service is down', async () => {
      mode = 'none';
      await calculation.calculate(problems.fresh!.id, 'test');
      const none = await latest('fresh');
      expect(none.aiStatus).toBe('UNAVAILABLE');
      expect(none.modelName).toBeNull();
      expect(Number(none.dataCompleteness)).toBeLessThan(1);
      expect(none.safetyRiskScore).not.toBeNull(); // the category prior still applies, with low confidence
      mode = 'fail';
      await calculation.calculate(problems.fresh!.id, 'test', { forceAi: true });
      expect((await latest('fresh')).aiStatus).toBe('FAILED');
    });

    it('recalculates from domain events, in the background', async () => {
      const events: string[] = [];
      const unsubscribe = bus.subscribe((e) => {
        if (e.type === 'PRIORITY_TIER_CHANGED') events.push(e.problemPublicId);
      });
      await prisma.problemPriorityAssessment.deleteMany({
        where: { problemId: problems.elsewhere!.id },
      });
      bus.publish({
        type: 'AI_ANALYSIS_COMPLETED',
        problemId: problems.elsewhere!.id,
        problemPublicId: problems.elsewhere!.publicId,
        reporterId: users.citizen!,
        analysisId: 'a',
        category: 'POTHOLES',
      });
      await bus.drain();
      await jobs.idle();
      await bus.drain();
      unsubscribe();
      expect(await count('elsewhere')).toBe(1);
      expect(events).toContain(problems.elsewhere!.publicId);
    });
  });

  // ======================================================= government queue

  describe('government review queue', () => {
    it('sorts by effective priority, filters by tier, and shows the explanation', async () => {
      await calculation.calculate(problems.fresh!.id, 'test');
      const page = (
        await gov('official').get('/problems?view=all&sort=priority&limit=50').expect(200)
      ).body.data;
      const ours = page.items.filter((i: { publicId: string }) =>
        Object.values(problems).some((p) => p.publicId === i.publicId),
      );
      expect(ours[0].publicId).toBe(problems.hazard!.publicId);
      expect(ours[0].priority).toMatchObject({ overridden: false });
      expect(ours[0].priority.summary.length).toBeGreaterThan(0);
      expect(ours.map((i: { publicId: string }) => i.publicId)).not.toContain(
        problems.elsewhere!.publicId,
      );

      const low = (
        await gov('official').get('/problems?view=all&priority=LOW&limit=50').expect(200)
      ).body.data.items;
      expect(
        low.every((i: { priority: { tier: string } }) => i.priority.tier === 'LOW'),
      ).toBe(true);
      await gov('official').get('/problems?priority=URGENT').expect(400);
      await gov('official').get('/problems?sort=urgency').expect(200);
    });

    it('exposes the full breakdown and history to officials', async () => {
      const view = (
        await gov('official')
          .get(`/problems/${problems.bench!.publicId}/priority`)
          .expect(200)
      ).body.data;
      expect(view.assessment.breakdown).toHaveLength(8);
      expect(
        view.assessment.breakdown.find(
          (f: { key: string }) => f.key === 'affectedPopulation',
        ).available,
      ).toBe(false);
      expect(view.history.length).toBeGreaterThanOrEqual(2);
      expect(view.effective).toEqual({ tier: view.assessment.tier, source: 'AI' });
      expect(JSON.stringify(view)).not.toMatch(/system_prompt|<report>/);
      const hazard = (
        await gov('official')
          .get(`/problems/${problems.hazard!.publicId}/priority`)
          .expect(200)
      ).body.data;
      expect(hazard.assessment.guidance[0].href).toMatch(
        /^\/knowledge\/sources\/.+#chunk-/,
      );
    });

    it('recalculates on request', async () => {
      const view = (
        await gov('official')
          .post(`/problems/${problems.bench!.publicId}/priority/recalculate`)
          .expect(200)
      ).body.data;
      expect(view.assessment).not.toBeNull();
    });
  });

  // ============================================================== override

  describe('government override', () => {
    const path = () => `/problems/${problems.bench!.publicId}/priority/override`;
    const reason = 'School access road is required for emergency evacuation.';

    it('requires a valid tier and a reason, and nothing else', async () => {
      await gov('official').post(path(), { tier: 'CRITICAL' }).expect(400);
      await gov('official')
        .post(path(), { tier: 'CRITICAL', reason: 'short' })
        .expect(400);
      await gov('official').post(path(), { tier: 'URGENT', reason }).expect(400);
      await gov('official')
        .post(path(), { tier: 'CRITICAL', reason, overriddenById: users.ngo })
        .expect(400);
    });

    it('sets the effective priority without touching the AI assessment, and audits it', async () => {
      const ai = await latest('bench');
      const view = (
        await gov('official').post(path(), { tier: 'CRITICAL', reason }).expect(200)
      ).body.data;
      expect(view.effective).toEqual({ tier: 'CRITICAL', source: 'OVERRIDE' });
      expect(view.override).toMatchObject({
        tier: 'CRITICAL',
        reason,
        aiTierAtOverride: ai.priorityTier,
      });
      expect(view.assessment.tier).toBe(ai.priorityTier);
      const after = await latest('bench');
      expect(after.id).toBe(ai.id);
      expect(Number(after.priorityScore)).toBe(Number(ai.priorityScore));

      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { entityId: problems.bench!.id, action: 'PRIORITY_OVERRIDE_CREATED' },
      });
      expect(audit).toMatchObject({ actorUserId: users.official });
      expect(audit.metadata).toMatchObject({
        organizationId: orgs.pune,
        fromTier: ai.priorityTier,
        toTier: 'CRITICAL',
        note: reason,
      });

      const queue = (
        await gov('official')
          .get('/problems?view=all&sort=priority&priority=CRITICAL&limit=50')
          .expect(200)
      ).body.data.items;
      const item = queue.find(
        (i: { publicId: string }) => i.publicId === problems.bench!.publicId,
      );
      expect(item.priority).toMatchObject({
        tier: 'CRITICAL',
        aiTier: ai.priorityTier,
        overridden: true,
      });
    });

    it('is updated and removed with audit entries, visible in the office activity', async () => {
      await gov('official2')
        .post(path(), {
          tier: 'HIGH',
          reason: 'Downgraded after a site visit confirmed a detour.',
        })
        .expect(200);
      const removed = (
        await gov('official')
          .delete(path(), { reason: 'Back to the assessment.' })
          .expect(200)
      ).body.data;
      expect(removed.override).toBeNull();
      expect(removed.effective.source).toBe('AI');
      await gov('official').delete(path()).expect(404);
      const actions = (
        await prisma.auditLog.findMany({
          where: { entityId: problems.bench!.id },
          orderBy: { createdAt: 'asc' },
        })
      ).map((a) => a.action);
      expect(actions).toEqual(
        expect.arrayContaining([
          'PRIORITY_OVERRIDE_CREATED',
          'PRIORITY_OVERRIDE_UPDATED',
          'PRIORITY_OVERRIDE_REMOVED',
        ]),
      );
      const activity = (
        await gov('official')
          .get(`/problems/${problems.bench!.publicId}/audit`)
          .expect(200)
      ).body.data;
      expect(
        activity.find((e: { kind: string }) => e.kind === 'PRIORITY_OVERRIDE_UPDATED'),
      ).toMatchObject({
        fromPriority: 'CRITICAL',
        toPriority: 'HIGH',
      });
    });

    it('is refused to everyone outside the problem’s jurisdiction', async () => {
      const body = { tier: 'LOW', reason };
      const url = `/api/v1/government/${PREFIX}pune${path()}`;
      await request(server)
        .post(url)
        .set('Cookie', cookies.citizen!)
        .send(body)
        .expect(403);
      await request(server).post(url).set('Cookie', cookies.ngo!).send(body).expect(403);
      await request(server)
        .post(url)
        .set('Cookie', cookies.admin!)
        .send(body)
        .expect(403);
      await request(server)
        .post(url)
        .set('Cookie', cookies.other!)
        .send(body)
        .expect(404);
      await request(server)
        .post(url)
        .set('Cookie', cookies.lapsed!)
        .send(body)
        .expect(404);
      // Another office cannot reach it through its own portal either (IDOR).
      await gov('other', 'nagpur').post(path(), body).expect(404);
      await gov('other', 'nagpur')
        .get(`/problems/${problems.bench!.publicId}/priority`)
        .expect(404);
      await request(server).post(url).send(body).expect(401);
      expect(
        await prisma.problemPriorityOverride.count({
          where: { problemId: problems.bench!.id },
        }),
      ).toBe(0);
    });

    it('is refused once the office is suspended', async () => {
      await prisma.organization.update({
        where: { id: orgs.pune },
        data: { verificationStatus: 'SUSPENDED' },
      });
      try {
        await gov('official').post(path(), { tier: 'LOW', reason }).expect(403);
      } finally {
        await prisma.organization.update({
          where: { id: orgs.pune },
          data: { verificationStatus: 'VERIFIED' },
        });
      }
    });
  });

  // =============================================================== public

  describe('what citizens see', () => {
    it('a level and plain reasons — no score, confidence, override or reason', async () => {
      const reason = 'Internal: councillor escalation, not for publication.';
      await gov('official')
        .post(`/problems/${problems.hazard!.publicId}/priority/override`, {
          tier: 'CRITICAL',
          reason,
        })
        .expect(200);
      const view = (
        await request(server)
          .get(`/api/v1/problems/${problems.hazard!.publicId}/priority`)
          .expect(200)
      ).body.data;
      expect(view.level).toBe('CRITICAL');
      expect(Object.keys(view).sort()).toEqual(['assessedAt', 'level', 'reasons']);
      const text = JSON.stringify(view);
      expect(text).not.toMatch(/councillor|score|confidence|“/i);
    });

    it('nothing before verification', async () => {
      const view = (
        await request(server)
          .get(`/api/v1/problems/${problems.fresh!.publicId}/priority`)
          .expect(200)
      ).body.data;
      expect(view).toEqual({ level: null, reasons: [], assessedAt: null });
      await request(server).get('/api/v1/problems/SAM-999999999/priority').expect(404);
    });
  });

  // ======================================================== notifications

  describe('escalation notifications', () => {
    it('reach active officials of covering offices only, once, and not after an override', async () => {
      const event = {
        type: 'PRIORITY_TIER_CHANGED' as const,
        problemId: problems.bench!.id,
        problemPublicId: problems.bench!.publicId,
        assessmentId: '00000000-0000-4000-8000-00000000e2e1',
        fromTier: 'HIGH' as const,
        toTier: 'CRITICAL' as const,
        score: 85,
      };
      bus.publish(event);
      bus.publish(event);
      await bus.drain();
      const sent = await prisma.notification.findMany({
        where: { entityId: problems.bench!.id, type: 'PRIORITY_ESCALATED' },
      });
      expect(sent.map((n) => n.recipientId).sort()).toEqual(
        [users.official, users.official2].sort(),
      );
      expect(sent[0]!.metadata).toMatchObject({ governmentSlug: `${PREFIX}pune` });

      // The hazard has an override: officials already decided.
      bus.publish({
        ...event,
        problemId: problems.hazard!.id,
        problemPublicId: problems.hazard!.publicId,
        assessmentId: '00000000-0000-4000-8000-00000000e2e2',
      });
      await bus.drain();
      expect(
        await prisma.notification.count({
          where: { entityId: problems.hazard!.id, type: 'PRIORITY_ESCALATED' },
        }),
      ).toBe(0);
    });
  });
});
