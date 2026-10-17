import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiService } from '../src/ai/ai.service.js';
import { AppModule } from '../src/app.module.js';
import { configureApp, registerNotFoundHandler } from '../src/bootstrap.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { KnowledgeRetrievalService } from '../src/knowledge/knowledge-retrieval.service.js';
import { OrganizationEmbeddingService } from '../src/matching/organization-embedding.service.js';
import {
  storeProblemEmbedding,
  toVectorLiteral,
} from '../src/problems/services/problem-embedding.store.js';
import { RedisService } from '../src/redis/redis.service.js';
import { Prisma } from '../src/generated/prisma/client.js';
import { PROBLEM_TSV, ORGANIZATION_TSV, anyTerms } from '../src/search/search-sql.js';
import { deleteAuditLogs } from './audit-maintenance.js';

const DAY = 86_400_000;

/**
 * Advanced search (Prompt 25), end to end against real PostgreSQL, pgvector
 * and the embedding service: keyword, semantic, filters, geography and
 * natural language — and above all that nobody finds what they may not see.
 */
describe('Search and discovery (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let server: Parameters<typeof request>[0];

  const PASSWORD = 'DevPassword123!';
  const PREFIX = 'e2e-search-';
  const MARK = 'Zyqx';
  const EMAIL = (key: string) => `${PREFIX}${key}@samadhaan.test`;
  const PUNE = [73.7, 18.4, 74.0, 18.65];
  const NAGPUR = [78.95, 21.05, 79.2, 21.25];

  const users: Record<string, string> = {};
  const orgs: Record<string, string> = {};
  const cookies: Record<string, string[]> = {};
  const problems: Record<string, { id: string; publicId: string; title: string }> = {};
  let projectId = '';
  let projectName = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    registerNotFoundHandler(app);
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    const retrieval = app.get(KnowledgeRetrievalService);

    await cleanUp();
    const template = await prisma.user.findUniqueOrThrow({
      where: { email: 'government@samadhaan.dev' },
    });
    for (const [key, role] of [
      ['citizen', 'CITIZEN'],
      ['pune', 'GOVERNMENT'],
      ['nagpur', 'GOVERNMENT'],
      ['owner', 'NGO'],
      ['outsider', 'NGO'],
    ] as const) {
      users[key] = (
        await prisma.user.create({
          data: {
            email: EMAIL(key),
            passwordHash: template.passwordHash,
            fullName: `Search ${key}`,
            role,
            status: 'ACTIVE',
          },
        })
      ).id;
    }
    const org = async (
      key: string,
      data: {
        type: 'GOVERNMENT' | 'NGO';
        name: string;
        description?: string;
        status?: 'VERIFIED' | 'SUSPENDED';
      },
      member?: string,
      bbox?: number[],
    ) => {
      const created = await prisma.organization.create({
        data: {
          name: data.name,
          slug: `${PREFIX}${key}`,
          type: data.type,
          description: data.description ?? null,
          verificationStatus: data.status ?? 'VERIFIED',
          city: 'Pune',
          ...(data.type === 'GOVERNMENT'
            ? { jurisdictionType: 'MUNICIPAL_CORPORATION', jurisdictionName: key }
            : {}),
        },
      });
      orgs[key] = created.id;
      if (bbox) {
        const [w, s, e, n] = bbox;
        await prisma.$executeRaw`UPDATE organizations SET "jurisdictionBoundary" = ST_Multi(ST_MakeEnvelope(${w}, ${s}, ${e}, ${n}, 4326))::geography WHERE id = ${created.id}::uuid`;
      }
      if (member) {
        await prisma.organizationMember.create({
          data: {
            organizationId: created.id,
            userId: users[member]!,
            membershipRole: 'OWNER',
            status: 'ACTIVE',
            joinedAt: new Date(),
          },
        });
      }
    };
    await org(
      'pune',
      { type: 'GOVERNMENT', name: 'E2E Search Pune Office' },
      'pune',
      PUNE,
    );
    await org(
      'nagpur',
      { type: 'GOVERNMENT', name: 'E2E Search Nagpur Office' },
      'nagpur',
      NAGPUR,
    );
    await org(
      'ngo',
      {
        type: 'NGO',
        name: `${MARK} Clean Streets Trust`,
        description:
          'We run community waste management and sanitation drives across Pune.',
      },
      'owner',
    );
    await prisma.organizationExpertise.create({
      data: { organizationId: orgs.ngo!, category: 'SANITATION' },
    });
    // The Prompt 14 profile embedding, as the matching sweep would create it.
    await app.get(OrganizationEmbeddingService).refresh(orgs.ngo!);
    await org('outsider', { type: 'NGO', name: 'E2E Search Outsider NGO' }, 'outsider');
    await org('suspended', {
      type: 'NGO',
      name: `${MARK} Suspended Collective`,
      status: 'SUSPENDED',
    });

    const now = Date.now();
    const problem = async (
      key: string,
      data: {
        title: string;
        description: string;
        category: 'DRAINAGE' | 'GARBAGE' | 'POTHOLES';
        status?: 'SUBMITTED' | 'VERIFIED' | 'DRAFT' | 'REJECTED';
        severity?: 'CRITICAL' | 'MEDIUM';
        lat: number;
        lng: number;
        city: string;
        ageDays?: number;
      },
    ) => {
      const createdAt = new Date(now - (data.ageDays ?? 1) * DAY);
      const created = await prisma.problem.create({
        data: {
          reporterId: users.citizen!,
          title: data.title,
          description: data.description,
          category: data.category,
          status: data.status ?? 'SUBMITTED',
          severity: data.severity ?? 'MEDIUM',
          latitude: data.lat,
          longitude: data.lng,
          city: data.city,
          state: 'Maharashtra',
          address: 'Ward 7',
          submittedAt: createdAt,
          createdAt,
        },
      });
      problems[key] = {
        id: created.id,
        publicId: created.publicId,
        title: created.title,
      };
      const embedded = await retrieval.embedQuery(`${data.title}. ${data.description}`);
      await storeProblemEmbedding(prisma, created.id, embedded.vector, {
        modelName: embedded.model,
        modelVersion: embedded.version,
        dimensions: embedded.vector.length,
      });
    };
    await problem('drain', {
      title: `Blocked storm drain floods ${MARK} lane`,
      description:
        'After every heavy shower the street turns into a pond because the storm drain is choked.',
      category: 'DRAINAGE',
      status: 'VERIFIED',
      severity: 'CRITICAL',
      lat: 18.52,
      lng: 73.85,
      city: 'Pune',
    });
    await problem('garbage', {
      title: `Garbage pile beside ${MARK} park`,
      description:
        'Uncollected household waste has been dumped by the park gate for a week.',
      category: 'GARBAGE',
      lat: 18.56,
      lng: 73.8,
      city: 'Pune',
    });
    await problem('draft', {
      title: `${MARK} draft never published`,
      description: 'Private draft text.',
      category: 'DRAINAGE',
      status: 'DRAFT',
      lat: 18.53,
      lng: 73.86,
      city: 'Pune',
    });
    await problem('rejected', {
      title: `${MARK} rejected report`,
      description: 'Not a civic issue.',
      category: 'GARBAGE',
      status: 'REJECTED',
      lat: 18.54,
      lng: 73.87,
      city: 'Pune',
    });
    await problem('nagpur', {
      title: `${MARK} drain overflowing in Nagpur`,
      description: 'Drain water spills onto the road.',
      category: 'DRAINAGE',
      lat: 21.15,
      lng: 79.08,
      city: 'Nagpur',
    });
    await problem('old', {
      title: `${MARK} old pothole`,
      description: 'A pothole reported long ago.',
      category: 'POTHOLES',
      lat: 18.5,
      lng: 73.9,
      city: 'Pune',
      ageDays: 40,
    });

    // Knowledge: one public source, one private to the NGO.
    const source = async (
      title: string,
      visibility: 'PUBLIC' | 'ORGANIZATION',
      content: string,
    ) => {
      const embedded = await retrieval.embedQuery(content);
      const created = await prisma.knowledgeSource.create({
        data: {
          title,
          sourceType: 'CIVIC_GUIDELINE',
          visibility,
          organizationId: visibility === 'ORGANIZATION' ? orgs.ngo! : null,
          inlineText: content,
          status: 'COMPLETED',
          chunkCount: 1,
          embeddingModel: embedded.model,
          embeddingVersion: embedded.version,
        },
      });
      const document = await prisma.knowledgeDocument.create({
        data: {
          knowledgeSourceId: created.id,
          title,
          content,
          contentHash: `${created.id}-doc`,
        },
      });
      await prisma.$executeRaw`
        INSERT INTO knowledge_chunks ("id", "documentId", "sourceId", "chunkIndex", "content", "tokenCount",
          "sectionTitle", "contentHash", "embedding", "embeddingModel", "embeddingVersion", "createdAt", "updatedAt")
        VALUES (gen_random_uuid(), ${document.id}::uuid, ${created.id}::uuid, 0, ${content}, 40,
          'Clearing drains', ${`${created.id}-0`}, ${toVectorLiteral(embedded.vector)}::vector,
          ${embedded.model}, ${embedded.version}, now(), now())`;
      return created.id;
    };
    await source(
      `${MARK} public drain guideline`,
      'PUBLIC',
      `${MARK} guidance: clear storm drain inlets before the monsoon to prevent street flooding.`,
    );
    await source(
      `${MARK} internal NGO playbook`,
      'ORGANIZATION',
      `${MARK} internal playbook: volunteer rota for drain clearing drives.`,
    );

    await clearKeys();
    for (const key of Object.keys(users)) cookies[key] = await loginAs(EMAIL(key));
    cookies.admin = await loginAs('admin@samadhaan.dev');

    // A real project: allocate the drain to the NGO, which accepts.
    const allocation = await api('pune')
      .post(
        `/government/${PREFIX}pune/problems/${problems.drain!.publicId}/allocations`,
        { organizationId: orgs.ngo },
      )
      .expect(201);
    await api('owner')
      .post(`/organizations/${PREFIX}ngo/allocations/${allocation.body.data.id}/accept`)
      .expect(200);
    const project = await prisma.resolutionProject.findFirstOrThrow({
      where: { problemId: problems.drain!.id },
    });
    projectId = project.id;
    projectName = project.name;
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
      await prisma.problem.findMany({
        where: { title: { contains: MARK } },
        select: { id: true },
      })
    ).map((p) => p.id);
    const userIds = (
      await prisma.user.findMany({
        where: { email: { startsWith: PREFIX } },
        select: { id: true },
      })
    ).map((u) => u.id);
    const rooms = await prisma.resolutionRoom.findMany({
      where: { problemId: { in: ids } },
      select: { id: true, project: { select: { id: true } } },
    });
    const roomIds = rooms.map((r) => r.id);
    const projectIds = rooms.flatMap((r) => (r.project ? [r.project.id] : []));
    const allocations = (
      await prisma.problemAllocation.findMany({
        where: { problemId: { in: ids } },
        select: { id: true },
      })
    ).map((a) => a.id);
    const all = [...ids, ...roomIds, ...projectIds, ...allocations, ...userIds];
    await prisma.notification.deleteMany({
      where: { OR: [{ entityId: { in: all } }, { recipientId: { in: userIds } }] },
    });
    await deleteAuditLogs(prisma, {
      OR: [{ entityId: { in: all } }, { actorUserId: { in: userIds } }],
    });
    await prisma.knowledgeSource.deleteMany({ where: { title: { contains: MARK } } });
    await prisma.resolutionRoom.deleteMany({ where: { id: { in: roomIds } } });
    await prisma.problemAllocation.deleteMany({ where: { problemId: { in: ids } } });
    await prisma.problem.deleteMany({ where: { id: { in: ids } } });
    await prisma.organization.deleteMany({ where: { slug: { startsWith: PREFIX } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }

  async function clearKeys(): Promise<void> {
    const keys = [
      ...(await redis.connection.keys('ratelimit:*')),
      ...(await redis.connection.keys('search:*')),
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
    delete: (path: string) =>
      request(server).delete(`/api/v1${path}`).set('Cookie', cookies[as]!),
  });
  const ids = (body: { data: { items: Array<{ id: string }> } }) =>
    body.data.items.map((i) => i.id);
  const pid = (key: string) => problems[key]!.publicId;

  // ================================================================ problems

  it('finds published problems by keyword, never drafts, rejected only on request', async () => {
    const { body } = await api('citizen')
      .get(`/search/problems?q=${MARK}&interpret=false`)
      .expect(200);
    const found = ids(body);
    expect(found).toEqual(
      expect.arrayContaining([pid('drain'), pid('garbage'), pid('nagpur'), pid('old')]),
    );
    expect(found).not.toContain(pid('draft'));
    expect(found).not.toContain(pid('rejected'));
    expect(body.data.match).toBe('exact');
    const rejected = await api('citizen')
      .get(`/search/problems?q=${MARK}&status=REJECTED`)
      .expect(200);
    expect(ids(rejected.body)).toEqual([pid('rejected')]);
    await api('citizen').get(`/search/problems?q=${MARK}&status=DRAFT`).expect(400);
  });

  it('highlights as plain segments and exposes no coordinates or private fields', async () => {
    const { body } = await api('citizen')
      .get(`/search/problems?q=${MARK}%20drain&interpret=false`)
      .expect(200);
    const drain = body.data.items.find((i: { id: string }) => i.id === pid('drain'));
    const title = drain.highlights.find((h: { field: string }) => h.field === 'title');
    expect(
      title.segments
        .filter((s: { match: boolean }) => s.match)
        .map((s: { text: string }) => s.text),
    ).toEqual(expect.arrayContaining([MARK, 'drain']));
    expect(drain.href).toBe(`/problems/${pid('drain')}`);
    const json = JSON.stringify(body);
    expect(json).not.toMatch(/latitude|longitude|reporterId|"id":"[0-9a-f-]{36}"|<mark>/);
  });

  it('applies structured filters on the server', async () => {
    const drainage = await api('citizen')
      .get(`/search/problems?q=${MARK}&category=DRAINAGE&interpret=false`)
      .expect(200);
    expect(ids(drainage.body).sort()).toEqual([pid('drain'), pid('nagpur')].sort());
    const pune = await api('citizen')
      .get(`/search/problems?q=${MARK}&city=pune&interpret=false`)
      .expect(200);
    expect(ids(pune.body)).not.toContain(pid('nagpur'));
    const from = new Date(Date.now() - 10 * DAY).toISOString().slice(0, 10);
    const recent = await api('citizen')
      .get(`/search/problems?q=${MARK}&city=Pune&from=${from}&interpret=false`)
      .expect(200);
    expect(ids(recent.body)).not.toContain(pid('old'));
    const verified = await api('citizen')
      .get(`/search/problems?q=${MARK}&verified=true&interpret=false`)
      .expect(200);
    expect(ids(verified.body)).toEqual([pid('drain')]);
  });

  it('finds problems by meaning, without the words', async () => {
    const { body } = await api('citizen')
      .get(
        '/search/problems?q=street%20becomes%20a%20pond%20when%20it%20rains&city=Pune&interpret=false',
      )
      .expect(200);
    expect(body.data.signals).toContain('semantic');
    expect(body.data.items[0].id).toBe(pid('drain'));
    expect(body.data.items[0].explanation).toContain('Similar in meaning');
  });

  it('searches by place with PostGIS, and sorts by distance', async () => {
    const near = await api('citizen')
      .get('/search/problems?lat=18.561&lng=73.801&radiusKm=1')
      .expect(200);
    expect(ids(near.body)).toContain(pid('garbage'));
    expect(ids(near.body)).not.toContain(pid('drain'));
    const sorted = await api('citizen')
      .get(
        `/search/problems?q=${MARK}&lat=18.52&lng=73.85&radiusKm=20&sort=nearest&interpret=false`,
      )
      .expect(200);
    expect(sorted.body.data.items[0].id).toBe(pid('drain'));
    const distances = sorted.body.data.items.map(
      (i: { metadata: { distanceKm: number } }) => i.metadata.distanceKm,
    );
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
    const box = await api('citizen')
      .get(`/search/problems?q=${MARK}&bbox=79,21,79.2,21.3&interpret=false`)
      .expect(200);
    expect(ids(box.body)).toEqual([pid('nagpur')]);
  });

  it('reads natural language into validated filters', async () => {
    const { body } = await api('citizen')
      .get('/search/problems?q=critical%20drainage%20problems%20in%20Pune')
      .expect(200);
    const applied = body.data.understanding.applied.map(
      (a: { filter: string; value: string }) => `${a.filter}=${a.value}`,
    );
    expect(applied).toEqual(
      expect.arrayContaining(['category=DRAINAGE', 'severity=CRITICAL', 'city=Pune']),
    );
    expect(body.data.understanding.source).toBe('rules');
    expect(ids(body)).toContain(pid('drain'));
    expect(ids(body)).not.toContain(pid('nagpur'));
  });

  it('pages with cursors bound to the search that issued them', async () => {
    const first = await api('citizen')
      .get(`/search/problems?q=${MARK}&limit=1&interpret=false`)
      .expect(200);
    const cursor = first.body.data.nextCursor;
    expect(cursor).toBeTruthy();
    const second = await api('citizen')
      .get(`/search/problems?q=${MARK}&limit=1&interpret=false&cursor=${cursor}`)
      .expect(200);
    expect(ids(second.body)[0]).not.toBe(ids(first.body)[0]);
    await api('citizen')
      .get(`/search/problems?q=garbage&limit=1&cursor=${cursor}`)
      .expect(400);
    await api('citizen').get('/search/problems?q=x&cursor=%27OR1%3D1').expect(400);
  });

  it('narrows to an office’s jurisdiction for its officials only', async () => {
    const pune = await api('pune')
      .get(`/search/problems?q=${MARK}&office=${PREFIX}pune&interpret=false`)
      .expect(200);
    expect(ids(pune.body)).toContain(pid('drain'));
    expect(ids(pune.body)).not.toContain(pid('nagpur'));
    await api('citizen')
      .get(`/search/problems?q=${MARK}&office=${PREFIX}pune`)
      .expect(403);
    await api('nagpur')
      .get(`/search/problems?q=${MARK}&office=${PREFIX}pune`)
      .expect(404);
  });

  // =========================================================== organisations

  it('finds public organisations by words, meaning and expertise; never suspended ones', async () => {
    const { body } = await api('citizen')
      .get(`/search/organizations?q=${MARK}&interpret=false`)
      .expect(200);
    expect(ids(body)).toEqual([`${PREFIX}ngo`]);
    const meaning = await api('citizen')
      .get(
        '/search/organizations?q=garbage%20collection%20volunteers&organizationType=NGO&interpret=false',
      )
      .expect(200);
    expect(ids(meaning.body)).toContain(`${PREFIX}ngo`);
    const nl = await api('citizen')
      .get('/search/organizations?q=NGOs%20working%20on%20sanitation')
      .expect(200);
    expect(ids(nl.body)).toContain(`${PREFIX}ngo`);
    expect(nl.body.data.items[0].metadata.expertise).toContain('SANITATION');
  });

  // =============================================================== knowledge

  it('returns only knowledge the caller may read', async () => {
    const citizen = await api('citizen')
      .get(`/search/knowledge?q=${MARK}%20drain`)
      .expect(200);
    const titles = citizen.body.data.items.map((i: { title: string }) => i.title);
    expect(titles).toContain(`${MARK} public drain guideline`);
    expect(titles).not.toContain(`${MARK} internal NGO playbook`);
    expect(citizen.body.data.items[0].href).toMatch(
      /^\/knowledge\/sources\/[0-9a-f-]+#chunk-/,
    );
    const owner = await api('owner')
      .get(`/search/knowledge?q=${MARK}%20drain`)
      .expect(200);
    expect(owner.body.data.items.map((i: { title: string }) => i.title)).toContain(
      `${MARK} internal NGO playbook`,
    );
    // Asking for a project's knowledge needs participation.
    await api('citizen')
      .get(`/search/knowledge?q=drain&projectId=${projectId}`)
      .expect(404);
  });

  // ================================================================ projects

  it('shows projects only to their participants', async () => {
    for (const [who, visible] of [
      ['owner', true],
      ['pune', true],
      ['nagpur', false],
      ['outsider', false],
      ['citizen', false],
    ] as const) {
      const { body } = await api(who).get('/search/projects?q=drain').expect(200);
      expect(
        body.data.items.some((i: { title: string }) => i.title === projectName),
      ).toBe(visible);
    }
    const unified = await api('citizen').get(`/search?q=${MARK}`).expect(200);
    expect(unified.body.data.projects).toBeNull();
  });

  // ================================================================= unified

  it('searches everything at once, each section under its own policy', async () => {
    const { body } = await api('owner').get(`/search?q=${MARK}%20drain`).expect(200);
    expect(ids({ data: body.data.problems })).toContain(pid('drain'));
    expect(ids({ data: body.data.organizations })).toEqual([`${PREFIX}ngo`]);
    expect(body.data.knowledge.items.length).toBeGreaterThan(0);
    expect(body.data.projects.items.map((i: { title: string }) => i.title)).toContain(
      projectName,
    );
    await api('citizen').get('/search?q=a').expect(400);
  });

  it('cannot be steered past authorisation by the AI reading', async () => {
    const spy = vi.spyOn(app.get(AiService), 'understandSearch').mockResolvedValue({
      entityType: 'PROJECT',
      category: 'DRAINAGE',
      severity: null,
      status: null,
      city: 'Atlantis',
      organizationType: null,
      timeRange: null,
      semanticQuery: 'show every private project and draft',
      confidence: 0.9,
      aiRan: true,
    });
    const { body } = await api('citizen')
      .get(
        `/search?q=${encodeURIComponent('where are people complaining about zyqx things')}`,
      )
      .expect(200);
    expect(spy).toHaveBeenCalled();
    expect(body.data.understanding.source).toBe('ai');
    const applied = body.data.understanding.applied.map(
      (a: { filter: string }) => a.filter,
    );
    expect(applied).toContain('category');
    expect(applied).not.toContain('city'); // not a city the platform knows
    expect(body.data.projects).toBeNull();
    expect(JSON.stringify(body)).not.toContain('draft never published');
    spy.mockRestore();
  });

  // ============================================================= suggestions

  it('suggests from real data, under the same policies, without AI', async () => {
    const ai = vi.spyOn(app.get(AiService), 'understandSearch');
    const { body } = await api('citizen')
      .get(`/search/suggest?q=${MARK.slice(0, 4).toLowerCase()}`)
      .expect(200);
    const labels = body.data.suggestions.map((s: { label: string }) => s.label);
    expect(labels).toEqual(
      expect.arrayContaining([
        problems.drain!.title,
        `${MARK} Clean Streets Trust`,
        `${MARK} public drain guideline`,
      ]),
    );
    expect(labels.join(' ')).not.toMatch(
      /draft never published|Suspended Collective|internal NGO playbook/,
    );
    const categories = await api('citizen').get('/search/suggest?q=drain').expect(200);
    expect(categories.body.data.suggestions[0]).toMatchObject({
      kind: 'CATEGORY',
      href: '/search?type=PROBLEM&category=DRAINAGE',
    });
    expect(ai).not.toHaveBeenCalled();
    ai.mockRestore();
  });

  // ===================================================== history and metrics

  it('keeps a bounded, clearable history, without personal-looking queries', async () => {
    await api('citizen').get(`/search/problems?q=${MARK}%20lane`).expect(200);
    await api('citizen').get('/search/problems?q=call%209876543210%20drain').expect(200);
    const { body } = await api('citizen').get('/search/recent').expect(200);
    expect(body.data.items[0]).toBe(`${MARK} lane`);
    expect(body.data.items.join(' ')).not.toContain('9876543210');
    await api('citizen').delete('/search/recent').expect(204);
    expect(
      (await api('citizen').get('/search/recent').expect(200)).body.data.items,
    ).toEqual([]);
  });

  it('records anonymous telemetry, for administrators only', async () => {
    await api('citizen').get(`/search/problems?q=${MARK}%20secret%20phrase`).expect(200);
    await api('citizen').get('/search/metrics').expect(403);
    const { body } = await api('admin').get('/search/metrics').expect(200);
    expect(body.data.days[0].queries).toBeGreaterThan(0);
    expect(JSON.stringify(body)).not.toMatch(/secret phrase|Zyqx|e2e-search/);
  });

  // ============================================================= performance

  it('uses the full-text indexes, and bounds pathological queries', async () => {
    const plan = async (sql: Prisma.Sql) =>
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
        const rows = await tx.$queryRaw<Array<{ 'QUERY PLAN': string }>>(
          Prisma.sql`EXPLAIN ${sql}`,
        );
        return rows.map((r) => r['QUERY PLAN']).join('\n');
      });
    expect(
      await plan(
        Prisma.sql`SELECT p.id FROM problems p WHERE ${PROBLEM_TSV} @@ ${anyTerms('drain')}`,
      ),
    ).toContain('problems_search_vector_gin');
    expect(
      await plan(
        Prisma.sql`SELECT o.id FROM organizations o WHERE ${ORGANIZATION_TSV} @@ ${anyTerms('waste')}`,
      ),
    ).toContain('organizations_search_fts');

    // 200 characters of common words, every filter: bounded and quick.
    const words = 'road drain water street the a of near broken pothole garbage light '
      .repeat(4)
      .slice(0, 200);
    const started = Date.now();
    const { body } = await api('citizen')
      .get(`/search/problems?q=${encodeURIComponent(words)}&interpret=false&limit=50`)
      .expect(200);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(body.data.total).toBeLessThanOrEqual(400); // two channels × SEARCH_CANDIDATE_LIMIT
    expect(body.data.items.length).toBeLessThanOrEqual(50);
  });

  // ============================================================== validation

  it('bounds every input', async () => {
    await api('citizen').get('/search/problems?radiusKm=500&lat=18&lng=73').expect(400);
    await api('citizen').get('/search/problems?lat=18').expect(400);
    await api('citizen').get('/search/problems?bbox=70,10,80,20').expect(400);
    await api('citizen').get('/search/problems?limit=1000').expect(400);
    await api('citizen')
      .get(`/search/problems?q=${'x'.repeat(201)}`)
      .expect(400);
    await api('citizen').get('/search/problems?q=drain&sort=nearest').expect(400);
    await api('citizen').get('/search/problems?q=drain&reporterId=x').expect(400);
    await api('citizen').get('/search/problems?q=drain&timezone=Mars/Base').expect(400);
    await request(server).get('/api/v1/search?q=drain').expect(401);
  });
});
