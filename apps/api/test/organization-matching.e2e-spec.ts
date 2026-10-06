import { createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiService } from '../src/ai/ai.service.js';
import type {
  AiMatchResult,
  MatchCandidateInput,
  MatchProblemInput,
} from '../src/ai/dto/matching.dto.js';
import { configureApp, registerNotFoundHandler } from '../src/bootstrap.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { MatchingEventHandler } from '../src/matching/matching-event.handler.js';
import { OrganizationEmbeddingService } from '../src/matching/organization-embedding.service.js';
import { OrganizationMatchingService } from '../src/matching/organization-matching.service.js';
import { RedisService } from '../src/redis/redis.service.js';
import { deleteAuditLogs } from './audit-maintenance.js';

// The setup file turns matching off for every e2e file; this one needs it.
process.env.MATCHING_ENABLED = 'true';

/**
 * Organisation matching end to end, against real PostgreSQL, pgvector and
 * PostGIS.
 *
 * The AI service is replaced by a deterministic stand-in: bag-of-words
 * vectors (shared words → similar texts) and a simple, transparent scorer.
 * The real engine is tested in services/ai; this suite tests everything the
 * API owns — retrieval, eligibility, what is sent, persistence, versioning,
 * deduplication, dismissal, freshness and authorisation.
 *
 * Fixtures sit around Bhopal (23.2 N, 77.4 E), away from the seed data.
 */
describe('Organisation matching (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let matching: OrganizationMatchingService;
  let embeddings: OrganizationEmbeddingService;
  let handler: MatchingEventHandler;
  let server: Parameters<typeof request>[0];

  const PASSWORD = 'DevPassword123!';
  const PREFIX = 'e2e-match-';
  const CENTRE = { latitude: 23.2599, longitude: 77.4126 };

  const orgIds: Record<string, string> = {};
  const problemIds: Record<string, string> = {};
  const publicIds: Record<string, string> = {};

  let owner: string[];
  let member: string[];
  let outsider: string[];
  let citizen: string[];
  let admin: string[];

  // ------------------------------------------------------- AI stand-in

  const embedCalls: string[][] = [];
  const matchCalls: Array<{
    problem: MatchProblemInput;
    candidates: MatchCandidateInput[];
  }> = [];
  let failMatching = false;

  function bagOfWords(text: string): number[] {
    const vector = Array.from({ length: 384 }, () => 0);
    for (const word of text.toLowerCase().split(/[^a-z0-9]+/)) {
      if (word.length <= 3) continue;
      const slot =
        parseInt(createHash('md5').update(word).digest('hex').slice(0, 8), 16) % 384;
      vector[slot] = (vector[slot] ?? 0) + 1;
    }
    const norm = Math.hypot(...vector) || 1;
    return vector.map((value) => value / norm);
  }

  const ai = {
    embedText: vi.fn(async (texts: string[]) => {
      embedCalls.push(texts);
      // An organisation whose embedding fails: the cold-start path.
      if (texts.some((text) => text.includes('Unembeddable'))) {
        return {
          ok: false as const,
          failure: { code: 'PROVIDER_UNAVAILABLE', message: 'down', retryable: true },
        };
      }
      return {
        ok: true as const,
        embeddings: {
          vectors: texts.map(bagOfWords),
          provider: 'test',
          modelName: 'test-bag-of-words',
          modelVersion: '1',
          dimensions: 384,
          normalized: true,
          processingMs: 1,
        },
      };
    }),
    matchOrganizations: vi.fn(
      async (
        problem: MatchProblemInput,
        candidates: MatchCandidateInput[],
        options: { resultLimit: number; minScore: number },
      ) => {
        matchCalls.push({ problem, candidates });
        if (failMatching) {
          return {
            ok: false as const,
            failure: {
              code: 'PROVIDER_ERROR',
              message: 'Matching failed.',
              retryable: true,
            },
          };
        }
        const scored = candidates.map((candidate) => {
          const semantic =
            candidate.semanticSimilarity === null
              ? null
              : Math.max(0, Math.min(1, (candidate.semanticSimilarity - 0.05) / 0.5));
          const matched = candidate.expertise
            .map((entry, index) => ({ entry, index }))
            .filter(({ entry }) => entry.category === problem.category);
          const category = matched.length > 0 ? 1 : 0;
          // Weak geography, as in the real engine: decays with distance,
          // neutral when unknown.
          const geographic =
            candidate.distanceMeters === null
              ? 0.3
              : Math.exp(-candidate.distanceMeters / 25_000);
          const parts = [semantic, category, geographic].filter(
            (value): value is number => value !== null,
          );
          const finalScore =
            Math.round((parts.reduce((a, b) => a + b, 0) / parts.length) * 1e4) / 1e4;
          return { candidate, semantic, category, finalScore, matched };
        });
        const ranked = scored
          .filter((entry) => entry.finalScore >= options.minScore)
          .sort((a, b) => b.finalScore - a.finalScore)
          .slice(0, options.resultLimit);
        const result: AiMatchResult = {
          matches: ranked.map((entry, index) => ({
            organizationId: entry.candidate.organizationId,
            rank: index + 1,
            finalScore: entry.finalScore,
            signals: {
              semantic: entry.semantic,
              expertise: entry.category,
              category: entry.category,
              geographic:
                entry.candidate.distanceMeters === null
                  ? 0.3
                  : Math.exp(-entry.candidate.distanceMeters / 25_000),
              capability: null,
              activity: 0.5,
            },
            reasons: [
              ...(entry.category
                ? [{ code: 'EXPERTISE_STRONG' as const, signal: 'expertise', value: 1 }]
                : []),
              ...(entry.candidate.distanceMeters !== null &&
              entry.candidate.distanceMeters <= 25_000
                ? [
                    {
                      code: 'WITHIN_SERVICE_AREA' as const,
                      signal: 'geographic',
                      value: entry.candidate.distanceMeters,
                    },
                  ]
                : []),
            ],
            matchedExpertise: entry.matched.map(({ index }) => index),
          })),
          considered: candidates.length,
          degraded: [],
          engine: 'test-engine',
          engineVersion: '1.0.0',
          matchingVersion: 'test-engine@1.0.0+e2e',
          weights: { semantic: 0.5, category: 0.5 },
          embeddingModel: 'test-bag-of-words',
          trained: false,
          processingMs: 1,
        };
        return { ok: true as const, result };
      },
    ),
    analyzeProblem: async () => ({
      ok: false as const,
      failure: { code: 'PROVIDER_UNAVAILABLE', message: 'n/a', retryable: false },
    }),
    getHealth: async () => null,
  };

  // ----------------------------------------------------------- set-up

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [(await import('../src/app.module.js')).AppModule],
    })
      .overrideProvider(AiService)
      .useValue(ai)
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    registerNotFoundHandler(app);

    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    matching = app.get(OrganizationMatchingService);
    embeddings = app.get(OrganizationEmbeddingService);
    handler = app.get(MatchingEventHandler);
    server = app.getHttpServer();

    await cleanUp();

    const user = async (email: string) =>
      (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
    const reporter = await user('citizen@samadhaan.dev');

    const org = async (
      key: string,
      data: {
        name: string;
        type: 'NGO' | 'UNIVERSITY' | 'INDUSTRY' | 'GOVERNMENT';
        description: string | null;
        expertise: Array<[string, string | null]>;
        at?: [number, number] | null;
        verificationStatus?: 'PENDING' | 'VERIFIED' | 'SUSPENDED' | 'REJECTED';
      },
    ) => {
      const created = await prisma.organization.create({
        data: {
          name: data.name,
          slug: `${PREFIX}${key}`,
          type: data.type,
          description: data.description,
          email: `${key}@e2e-match.example`,
          phone: '+91 90000 11111',
          city: data.at === null ? null : 'Bhopal',
          state: 'Madhya Pradesh',
          latitude: data.at === null ? null : (data.at?.[0] ?? CENTRE.latitude),
          longitude: data.at === null ? null : (data.at?.[1] ?? CENTRE.longitude),
          verificationStatus: data.verificationStatus ?? 'VERIFIED',
        },
      });
      orgIds[key] = created.id;
      await prisma.organizationExpertise.createMany({
        data: data.expertise.map(([category, subcategory]) => ({
          organizationId: created.id,
          category: category as never,
          subcategory,
          level: 'SPECIALIST' as const,
        })),
      });
    };

    await org('roadsafe', {
      name: 'RoadSafe Bhopal',
      type: 'NGO',
      description:
        'Pothole repair drives and road safety for two-wheeler riders on city roads.',
      expertise: [
        ['POTHOLES', 'Pothole repair'],
        ['ROADS', 'Road safety'],
      ],
      at: [23.262, 77.41],
    });
    await org('mobility', {
      name: 'Mobility Research Lab',
      type: 'UNIVERSITY',
      description: 'Research on traffic flow, road condition surveys and smart mobility.',
      expertise: [['TRAFFIC', 'Smart mobility']],
      at: [23.24, 77.43],
    });
    await org('waste', {
      name: 'Waste Warriors Bhopal',
      type: 'NGO',
      description: 'Garbage collection, segregation and clean-up drives.',
      expertise: [['GARBAGE', 'Waste management']],
    });
    await org('suspended', {
      name: 'Suspended Pothole Fixers',
      type: 'NGO',
      description: 'Pothole repair drives and road safety for two-wheeler riders.',
      expertise: [['POTHOLES', 'Pothole repair']],
      verificationStatus: 'SUSPENDED',
    });
    await org('government', {
      name: 'Bhopal Roads Department',
      type: 'GOVERNMENT',
      description: 'Pothole repair and road maintenance.',
      expertise: [['POTHOLES', null]],
    });
    // Cold start: brand new, unverified, no location, no history, and its
    // embedding fails — it must still be found through its expertise.
    await org('newcomer', {
      name: 'Unembeddable Newcomer Trust',
      type: 'NGO',
      description: null,
      expertise: [['POTHOLES', null]],
      at: null,
      verificationStatus: 'PENDING',
    });

    const memberships: Array<[string, string, 'OWNER' | 'ADMIN' | 'MEMBER']> = [
      ['roadsafe', 'ngo@samadhaan.dev', 'OWNER'],
      ['roadsafe', 'university@samadhaan.dev', 'MEMBER'],
      ['waste', 'industry@samadhaan.dev', 'OWNER'],
    ];
    for (const [key, email, role] of memberships) {
      await prisma.organizationMember.create({
        data: {
          organizationId: orgIds[key]!,
          userId: await user(email),
          membershipRole: role,
          status: 'ACTIVE',
          joinedAt: new Date(),
        },
      });
    }

    const problem = async (
      key: string,
      data: {
        title: string;
        description: string;
        category: string;
        at: [number, number];
      },
    ) => {
      const created = await prisma.problem.create({
        data: {
          reporterId: reporter,
          title: `Matching probe ${data.title}`,
          description: data.description,
          category: data.category as never,
          severity: 'HIGH',
          status: 'SUBMITTED',
          latitude: data.at[0],
          longitude: data.at[1],
          address: `${key} Road, Bhopal`,
          city: 'Bhopal',
          state: 'Madhya Pradesh',
        },
      });
      problemIds[key] = created.id;
      publicIds[key] = created.publicId;
    };

    await problem('pothole', {
      title: 'Deep pothole on the main road',
      description: 'A deep pothole is damaging two-wheeler riders on the main road.',
      category: 'POTHOLES',
      at: [23.2605, 77.4115],
    });
    await problem('garbage', {
      title: 'Garbage not collected for a week',
      description: 'Garbage collection has stopped and waste is piling up.',
      category: 'GARBAGE',
      at: [23.255, 77.42],
    });

    for (const key of Object.keys(orgIds)) await embeddings.refresh(orgIds[key]!);

    await clearRateLimits();
    owner = await loginAs('ngo@samadhaan.dev');
    member = await loginAs('university@samadhaan.dev');
    outsider = await loginAs('industry@samadhaan.dev');
    citizen = await loginAs('citizen@samadhaan.dev');
    admin = await loginAs('admin@samadhaan.dev');
  });

  beforeEach(async () => {
    await clearRateLimits();
    failMatching = false;
    matchCalls.length = 0;
    embedCalls.length = 0;
  });

  afterAll(async () => {
    if (prisma) {
      await matching?.idle();
      await cleanUp();
    }
    await app?.close();
  });

  async function cleanUp(): Promise<void> {
    const orgs = await prisma.organization.findMany({
      where: { slug: { startsWith: PREFIX } },
      select: { id: true },
    });
    await deleteAuditLogs(prisma, {
      entityType: 'Organization',
      entityId: { in: orgs.map((org) => org.id) },
    });
    await prisma.organization.deleteMany({ where: { slug: { startsWith: PREFIX } } });
    await prisma.problem.deleteMany({
      where: { title: { startsWith: 'Matching probe ' } },
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

  const rowsFor = (problemKey: string) =>
    prisma.organizationProblemMatch.findMany({
      where: { problemId: problemIds[problemKey]! },
      orderBy: { finalScore: 'desc' },
    });

  const keyOf = (organizationId: string) =>
    Object.entries(orgIds).find(([, id]) => id === organizationId)?.[0] ?? 'other';

  // ------------------------------------------------------------- tests

  describe('Organisation embeddings', () => {
    it('embeds each organisation once, and only again when its profile changes', async () => {
      const before = await prisma.organizationEmbedding.findFirstOrThrow({
        where: { organizationId: orgIds.roadsafe },
      });
      expect(before.sourceHash).toMatch(/^[0-9a-f]{64}$/);
      expect(before.modelName).toBe('test-bag-of-words');

      expect(await embeddings.refresh(orgIds.roadsafe!)).toBe('unchanged');
      expect(embedCalls).toHaveLength(0);

      // Contact details are not part of the profile text.
      await prisma.organization.update({
        where: { id: orgIds.roadsafe },
        data: { phone: '+91 90000 22222' },
      });
      expect(await embeddings.refresh(orgIds.roadsafe!)).toBe('unchanged');

      await prisma.organization.update({
        where: { id: orgIds.roadsafe },
        data: { description: 'Pothole repair drives, road safety and footpath repair.' },
      });
      expect(await embeddings.refresh(orgIds.roadsafe!)).toBe('updated');
      const after = await prisma.organizationEmbedding.findFirstOrThrow({
        where: { organizationId: orgIds.roadsafe },
      });
      expect(after.sourceHash).not.toBe(before.sourceHash);
      expect(
        await prisma.organizationEmbedding.count({
          where: { organizationId: orgIds.roadsafe },
        }),
      ).toBe(1);
    });

    it('never puts contact details or people into the embedded text', () => {
      const texts = embedCalls.flat().join('\n');
      expect(texts).not.toMatch(/@e2e-match\.example|\+91|samadhaan\.dev/);
    });

    it('records a failed embedding without blocking the organisation', async () => {
      expect(await embeddings.refresh(orgIds.newcomer!)).toBe('failed');
      expect(
        await prisma.organizationEmbedding.count({
          where: { organizationId: orgIds.newcomer },
        }),
      ).toBe(0);
    });
  });

  describe('Matching a problem', () => {
    it('retrieves eligible candidates by vector similarity and by category', async () => {
      await matching.run(problemIds.pothole!, 'test');

      expect(matchCalls).toHaveLength(1);
      const { candidates } = matchCalls[0]!;
      const keys = candidates.map((candidate) => keyOf(candidate.organizationId));

      expect(keys).toContain('roadsafe');
      // Cold start: no embedding, no location, no history — still a candidate.
      expect(keys).toContain('newcomer');
      expect(keys).not.toContain('suspended');
      expect(keys).not.toContain('government');
      expect(candidates.length).toBeLessThanOrEqual(80);

      const roadsafe = candidates.find((c) => c.organizationId === orgIds.roadsafe)!;
      expect(roadsafe.semanticSimilarity).toBeGreaterThan(0.2);
      expect(roadsafe.distanceMeters).toBeGreaterThan(100);
      expect(roadsafe.distanceMeters).toBeLessThan(1_000);
      expect(roadsafe.sameCity).toBe(true);
      expect(roadsafe.expertise.map((entry) => entry.category)).toEqual(
        expect.arrayContaining(['POTHOLES', 'ROADS']),
      );

      const newcomer = candidates.find((c) => c.organizationId === orgIds.newcomer)!;
      expect(newcomer.semanticSimilarity).toBeNull();
      expect(newcomer.hasLocation).toBe(false);
      expect(newcomer.relevantActivityCount).toBe(0);
    });

    it('sends the AI service the civic record only — no reporter, no coordinates', () => {
      const payload = JSON.stringify(matchCalls.at(-1) ?? matchCalls);
      expect(payload).not.toMatch(
        /citizen@samadhaan\.dev|Priya|reporter|latitude|longitude/i,
      );
    });

    it('reuses the problem embedding instead of encoding the problem again', async () => {
      await matching.run(problemIds.pothole!, 'test');
      expect(embedCalls.flat().some((text) => text.includes('Deep pothole'))).toBe(false);
    });

    it('persists ranked matches with every signal and the engine version', async () => {
      const rows = await rowsFor('pothole');
      const keys = rows.map((row) => keyOf(row.organizationId));

      expect(keys[0]).toBe('roadsafe');
      expect(keys).toContain('newcomer');
      expect(keys).not.toContain('suspended');
      expect(rows.map((row) => row.rank)).toEqual(rows.map((_, index) => index + 1));
      for (const row of rows) {
        expect(row.matchingVersion).toBe('test-engine@1.0.0+e2e');
        expect(row.status).toBe('CALCULATED');
        expect(row.finalScore).toBeGreaterThanOrEqual(0.35);
      }
      const roadsafe = rows[0]!;
      expect(roadsafe.semanticScore).not.toBeNull();
      expect(roadsafe.explanation).toMatchObject({
        reasons: expect.arrayContaining([{ code: 'EXPERTISE_STRONG', value: 1 }]),
        matchedExpertise: [
          { category: 'POTHOLES', subcategory: 'Pothole repair', level: 'SPECIALIST' },
        ],
      });

      const job = await prisma.problemAiAnalysis.findFirstOrThrow({
        where: { problemId: problemIds.pothole, analysisType: 'ORGANIZATION_MATCHING' },
        orderBy: { createdAt: 'desc' },
      });
      expect(job).toMatchObject({
        processingStatus: 'COMPLETED',
        modelVersion: 'test-engine@1.0.0+e2e',
      });
      expect(job.rawResult).toMatchObject({ trained: false, engine: 'test-engine' });
    });

    it('never duplicates a match when re-run', async () => {
      const before = await rowsFor('pothole');
      await matching.run(problemIds.pothole!, 'test');
      await matching.run(problemIds.pothole!, 'test');
      const after = await rowsFor('pothole');
      expect(after).toHaveLength(before.length);
      expect(new Set(after.map((row) => row.organizationId)).size).toBe(after.length);
    });

    it('keeps the previous matches when the engine fails', async () => {
      const before = await rowsFor('pothole');
      failMatching = true;
      await matching.run(problemIds.pothole!, 'test');
      expect(await rowsFor('pothole')).toHaveLength(before.length);
      const job = await prisma.problemAiAnalysis.findFirstOrThrow({
        where: { problemId: problemIds.pothole, analysisType: 'ORGANIZATION_MATCHING' },
        orderBy: { createdAt: 'desc' },
      });
      expect(job.processingStatus).toBe('FAILED');
    });

    it('drops matches when the problem stops being open work', async () => {
      await matching.run(problemIds.garbage!, 'test');
      expect((await rowsFor('garbage')).length).toBeGreaterThan(0);

      await prisma.problem.update({
        where: { id: problemIds.garbage },
        data: { status: 'RESOLVED' },
      });
      await matching.run(problemIds.garbage!, 'test');
      expect(await rowsFor('garbage')).toHaveLength(0);

      const response = await request(server)
        .get(`/api/v1/problems/${publicIds.garbage}/matches`)
        .expect(200);
      expect(response.body.data).toMatchObject({ state: 'unavailable', items: [] });

      await prisma.problem.update({
        where: { id: problemIds.garbage },
        data: { status: 'SUBMITTED' },
      });
      await matching.run(problemIds.garbage!, 'test');
    });
  });

  describe('GET /problems/:publicId/matches', () => {
    it('is public and lists potentially relevant organisations, public facts only', async () => {
      const response = await request(server)
        .get(`/api/v1/problems/${publicIds.pothole}/matches`)
        .expect(200);
      const body = response.body.data;

      expect(body.state).toBe('ready');
      expect(body.items[0].organization).toEqual({
        slug: `${PREFIX}roadsafe`,
        name: 'RoadSafe Bhopal',
        type: 'NGO',
        logoUrl: null,
        verificationStatus: 'VERIFIED',
        location: { city: 'Bhopal', state: 'Madhya Pradesh' },
      });
      expect(body.items[0].relevance).toBeGreaterThan(0.5);
      expect(body.items[0].rank).toBe(1);
      expect(Object.keys(body.items[0].signals).sort()).toEqual([
        'activity',
        'capability',
        'category',
        'expertise',
        'geographic',
        'semantic',
      ]);
      const serialized = JSON.stringify(body);
      expect(serialized).not.toMatch(
        /e2e-match\.example|\+91|organizationId|test-bag-of-words/,
      );
      expect(
        body.items.map(
          (item: { organization: { slug: string } }) => item.organization.slug,
        ),
      ).not.toContain(`${PREFIX}suspended`);
    });

    it('rejects an out-of-range limit and an unknown problem', async () => {
      await request(server)
        .get(`/api/v1/problems/${publicIds.pothole}/matches?limit=50`)
        .expect(400);
      await request(server).get('/api/v1/problems/SAM-999999/matches').expect(404);
    });

    it('hides an organisation that is suspended after it was matched', async () => {
      await prisma.organization.update({
        where: { id: orgIds.mobility },
        data: { verificationStatus: 'SUSPENDED' },
      });
      try {
        const response = await request(server)
          .get(`/api/v1/problems/${publicIds.pothole}/matches?limit=10`)
          .expect(200);
        expect(JSON.stringify(response.body.data)).not.toContain(`${PREFIX}mobility`);
      } finally {
        await prisma.organization.update({
          where: { id: orgIds.mobility },
          data: { verificationStatus: 'VERIFIED' },
        });
      }
    });
  });

  describe('POST /problems/:publicId/matches/recompute', () => {
    it('requires a session and the platform admin role', async () => {
      await request(server)
        .post(`/api/v1/problems/${publicIds.pothole}/matches/recompute`)
        .expect(401);
      await request(server)
        .post(`/api/v1/problems/${publicIds.pothole}/matches/recompute`)
        .set('Cookie', citizen)
        .expect(403);
      await request(server)
        .post(`/api/v1/problems/${publicIds.pothole}/matches/recompute`)
        .set('Cookie', owner)
        .expect(403);
    });

    it('queues a re-match for an admin', async () => {
      await request(server)
        .post(`/api/v1/problems/${publicIds.pothole}/matches/recompute`)
        .set('Cookie', admin)
        .expect(202);
      await matching.idle();
      expect(matchCalls).toHaveLength(1);
    });
  });

  describe('Recommendations in the workspace', () => {
    const list = (cookies: string[], slug = `${PREFIX}roadsafe`, query = '') =>
      request(server)
        .get(`/api/v1/organizations/${slug}/recommendations${query}`)
        .set('Cookie', cookies);

    it('lists this organisation’s matched problems, most relevant first', async () => {
      const response = await list(member).expect(200);
      const page = response.body.data;
      expect(page.items[0].publicId).toBe(publicIds.pothole);
      expect(page.items[0].match).toMatchObject({ status: 'CALCULATED', rank: 1 });
      expect(page.items[0].match.relevance).toBeGreaterThan(0.5);
      expect(page.items[0].match.reasons).toEqual(
        expect.arrayContaining([{ code: 'EXPERTISE_STRONG', value: 1 }]),
      );
      // The garbage problem never matched a road organisation.
      expect(page.items.map((item: { publicId: string }) => item.publicId)).not.toContain(
        publicIds.garbage,
      );
      expect(page.items[0]).not.toHaveProperty('reporterId');
    });

    it('filters on the server by relevance, category and distance', async () => {
      expect(
        (await list(member, undefined, '?minRelevance=0.99').expect(200)).body.data
          .totalCount,
      ).toBe(0);
      expect(
        (await list(member, undefined, '?category=GARBAGE').expect(200)).body.data
          .totalCount,
      ).toBe(0);
      expect(
        (await list(member, undefined, '?radiusMeters=5000&sort=distance').expect(200))
          .body.data.items[0].publicId,
      ).toBe(publicIds.pothole);
      await list(member, undefined, '?minRelevance=2').expect(400);
      await list(member, undefined, '?organizationId=x').expect(400);
    });

    it('is closed to non-members', async () => {
      await list(outsider).expect(404);
      await list(citizen).expect(404);
    });

    it('lets owners dismiss and restore, and the dismissal survives re-matching', async () => {
      const dismiss = `/api/v1/organizations/${PREFIX}roadsafe/recommendations/${publicIds.pothole}/dismiss`;
      const restore = `/api/v1/organizations/${PREFIX}roadsafe/recommendations/${publicIds.pothole}/restore`;

      await request(server).post(dismiss).set('Cookie', member).expect(403);
      await request(server)
        .post(
          `/api/v1/organizations/${PREFIX}waste/recommendations/${publicIds.pothole}/dismiss`,
        )
        .set('Cookie', outsider)
        .expect(404);

      await request(server).post(dismiss).set('Cookie', owner).expect(204);
      expect(
        (await list(member).expect(200)).body.data.items.map(
          (i: { publicId: string }) => i.publicId,
        ),
      ).not.toContain(publicIds.pothole);
      expect(
        (await list(member, undefined, '?view=dismissed').expect(200)).body.data.items[0]
          .publicId,
      ).toBe(publicIds.pothole);

      // Not shown publicly either, and still dismissed after a re-match.
      const publicView = await request(server).get(
        `/api/v1/problems/${publicIds.pothole}/matches`,
      );
      expect(JSON.stringify(publicView.body.data)).not.toContain(`${PREFIX}roadsafe`);
      await matching.run(problemIds.pothole!, 'test');
      const row = await prisma.organizationProblemMatch.findFirstOrThrow({
        where: { problemId: problemIds.pothole, organizationId: orgIds.roadsafe },
      });
      expect(row.status).toBe('DISMISSED');
      expect(
        await prisma.organizationProblemMatch.count({
          where: { problemId: problemIds.pothole, organizationId: orgIds.roadsafe },
        }),
      ).toBe(1);

      await request(server).post(restore).set('Cookie', owner).expect(204);
      await request(server).post(restore).set('Cookie', owner).expect(404);
      expect((await list(member).expect(200)).body.data.items[0].publicId).toBe(
        publicIds.pothole,
      );

      const audit = await prisma.auditLog.count({
        where: {
          entityId: orgIds.roadsafe,
          action: {
            in: [
              'ORGANIZATION_RECOMMENDATION_DISMISSED',
              'ORGANIZATION_RECOMMENDATION_RESTORED',
            ],
          },
        },
      });
      expect(audit).toBe(2);
    });

    it('appears on the dashboard', async () => {
      const response = await request(server)
        .get(`/api/v1/organizations/${PREFIX}roadsafe/dashboard`)
        .set('Cookie', member)
        .expect(200);
      expect(response.body.data.recommendations.total).toBeGreaterThanOrEqual(1);
      expect(response.body.data.recommendations.items[0].match.relevance).toBeGreaterThan(
        0.5,
      );
    });
  });

  describe('Freshness', () => {
    it('re-embeds and re-matches when an organisation changes its expertise', async () => {
      await request(server)
        .post(`/api/v1/organizations/${orgIds.waste}/expertise`)
        .set('Cookie', outsider)
        .send({
          category: 'POTHOLES',
          subcategory: 'Pothole filling',
          level: 'EXPERIENCED',
        })
        .expect(201);

      await handler.flush();
      await matching.idle();

      // The changed organisation's profile was re-embedded …
      expect(embedCalls.flat().some((text) => text.includes('Pothole filling'))).toBe(
        true,
      );
      // … and the pothole problem was re-matched and now includes it.
      const rows = await rowsFor('pothole');
      expect(rows.map((row) => keyOf(row.organizationId))).toContain('waste');
      expect(rows.every((row) => row.status !== 'STALE')).toBe(true);
    });

    it('marks an organisation’s matches stale until they are recomputed', async () => {
      // Without the queue running, the staleness is visible.
      await prisma.organizationProblemMatch.updateMany({
        where: { organizationId: orgIds.waste, status: 'CALCULATED' },
        data: { status: 'STALE' },
      });
      const stale = await matching.problemsNeedingMatches(500);
      expect(stale).toContain(problemIds.pothole);

      await matching.run(problemIds.pothole!, 'test');
      const rows = await rowsFor('pothole');
      expect(rows.every((row) => row.status !== 'STALE')).toBe(true);
    });
  });
});
