import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp, registerNotFoundHandler } from '../src/bootstrap.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { RedisService } from '../src/redis/redis.service.js';
import { StorageService } from '../src/storage/storage.types.js';
import { deleteAuditLogs } from './audit-maintenance.js';

/**
 * Security regression suite (Prompt 26), against the real application:
 * headers, CORS, CSRF, sessions, input limits, uploads, and the authorisation
 * fixes from the audit. Each test names the finding it guards.
 */
describe('Security hardening (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let storage: StorageService;
  let server: Parameters<typeof request>[0];

  const PASSWORD = 'DevPassword123!';
  const PREFIX = 'e2e-sec-';
  const CITY = 'Securipur';
  const TITLE = 'Security probe ';
  const EMAIL = (key: string) => `${PREFIX}${key}@samadhaan.test`;
  const ALLOWED_ORIGIN = 'http://localhost:3100';

  const users: Record<string, string> = {};
  const orgs: Record<string, string> = {};
  const cookies: Record<string, string[]> = {};
  const problems: Record<string, { id: string; publicId: string }> = {};
  const storedKeys: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    registerNotFoundHandler(app);
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    storage = app.get(StorageService);

    await cleanUp();
    const template = await prisma.user.findUniqueOrThrow({
      where: { email: 'government@samadhaan.dev' },
    });
    for (const [key, role] of [
      ['citizen', 'CITIZEN'],
      ['official', 'GOVERNMENT'],
      ['dual', 'GOVERNMENT'],
      ['suspendme', 'CITIZEN'],
    ] as const) {
      users[key] = (
        await prisma.user.create({
          data: {
            email: EMAIL(key),
            passwordHash: template.passwordHash,
            fullName: `Sec ${key}`,
            role,
            status: 'ACTIVE',
          },
        })
      ).id;
    }
    const org = async (key: string, type: 'GOVERNMENT' | 'NGO', members: string[]) => {
      const created = await prisma.organization.create({
        data: {
          name: `E2E Sec ${key}`,
          slug: `${PREFIX}${key}`,
          type,
          verificationStatus: 'VERIFIED',
          ...(type === 'GOVERNMENT'
            ? {
                jurisdictionType: 'MUNICIPAL_CORPORATION',
                jurisdictionName: CITY,
                jurisdictionCities: [CITY],
              }
            : {}),
        },
      });
      orgs[key] = created.id;
      for (const member of members) {
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
    await org('office', 'GOVERNMENT', ['official', 'dual']);
    await org('ngo', 'NGO', ['dual']);

    const problem = async (key: string, status: 'VERIFIED' | 'SUBMITTED') => {
      const created = await prisma.problem.create({
        data: {
          reporterId: users.citizen!,
          title: `${TITLE}${key}`,
          description: 'A test problem for security regression.',
          category: 'DRAINAGE',
          status,
          latitude: 19.1,
          longitude: 72.9,
          city: CITY,
          submittedAt: new Date(),
        },
      });
      problems[key] = { id: created.id, publicId: created.publicId };
    };
    await problem('verified', 'VERIFIED');
    await problem('older', 'SUBMITTED');
    await prisma.problemDuplicateCandidate.create({
      data: {
        problemId: problems.verified!.id,
        candidateProblemId: problems.older!.id,
        combinedScore: 0.9,
      },
    });

    await clearKeys();
    for (const key of ['citizen', 'official', 'dual', 'suspendme'])
      cookies[key] = await loginAs(EMAIL(key));
    cookies.admin = await loginAs('admin@samadhaan.dev');
  });

  beforeEach(clearKeys);

  afterAll(async () => {
    for (const key of storedKeys) await storage.delete(key).catch(() => undefined);
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
        where: { title: { startsWith: TITLE } },
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
    await prisma.knowledgeSource.deleteMany({ where: { title: { startsWith: TITLE } } });
    await prisma.problemDuplicateCandidate.deleteMany({
      where: { problemId: { in: problemIds } },
    });
    await prisma.problemAllocation.deleteMany({
      where: { problemId: { in: problemIds } },
    });
    await prisma.problem.deleteMany({ where: { id: { in: problemIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
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

  const api = (as: string) => ({
    get: (path: string) =>
      request(server).get(`/api/v1${path}`).set('Cookie', cookies[as]!),
    post: (path: string, body: object = {}) =>
      request(server).post(`/api/v1${path}`).set('Cookie', cookies[as]!).send(body),
    patch: (path: string, body: object) =>
      request(server).patch(`/api/v1${path}`).set('Cookie', cookies[as]!).send(body),
  });

  // ============================================================ HTTP layer

  it('sends security headers and no framework fingerprint', async () => {
    const res = await request(server).get('/api/v1/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-powered-by']).toBeUndefined();
    // HSTS is production-only.
    expect(res.headers['strict-transport-security']).toBeUndefined();
  });

  it('replaces forged request ids, and uses one id per request', async () => {
    const forged = await request(server)
      .get('/api/v1/nope')
      .set('x-request-id', 'a'.repeat(80));
    expect(forged.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(forged.body.meta.requestId).toBe(forged.headers['x-request-id']);
    const kept = await request(server)
      .get('/api/v1/nope')
      .set('x-request-id', 'trace-42');
    expect(kept.headers['x-request-id']).toBe('trace-42');
  });

  it('allows CORS only for configured origins', async () => {
    const ok = await request(server)
      .options('/api/v1/auth/login')
      .set('Origin', ALLOWED_ORIGIN)
      .set('Access-Control-Request-Method', 'POST');
    expect(ok.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    const evil = await request(server)
      .options('/api/v1/auth/login')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('blocks cross-site state changes (CSRF) but not the app itself', async () => {
    const body = { email: EMAIL('citizen'), password: PASSWORD };
    await request(server)
      .post('/api/v1/auth/login')
      .set('Origin', 'https://evil.example')
      .send(body)
      .expect(403);
    await request(server)
      .post('/api/v1/auth/login')
      .set('Sec-Fetch-Site', 'cross-site')
      .send(body)
      .expect(403);
    await request(server)
      .post('/api/v1/auth/login')
      .set('Origin', 'null')
      .send(body)
      .expect(403);
    await request(server)
      .post('/api/v1/auth/login')
      .set('Origin', ALLOWED_ORIGIN)
      .send(body)
      .expect(200);
  });

  it('bounds and validates request bodies', async () => {
    await request(server)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email":')
      .expect(400);
    await request(server)
      .post('/api/v1/auth/login')
      .send({ email: 'x@y.z', password: 'p'.repeat(200_000) })
      .expect(413);
    await api('citizen').get("/search/problems?category=' OR 1=1--").expect(400);
    await api('citizen').get('/search/problems?sort=1;DROP TABLE problems').expect(400);
  });

  // ============================================================ sessions

  it('does not reveal whether an account exists', async () => {
    const unknown = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: EMAIL('nobody'), password: 'Wrong-pass-123' });
    const wrong = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: EMAIL('citizen'), password: 'Wrong-pass-123' });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body.error).toEqual(wrong.body.error);
  });

  it('rejects a signed-out session immediately', async () => {
    const session = await loginAs(EMAIL('citizen'));
    await request(server).get('/api/v1/users/me').set('Cookie', session).expect(200);
    await request(server)
      .post('/api/v1/auth/logout')
      .set('Cookie', session)
      .expect((r) => expect(r.status).toBeLessThan(300));
    await request(server).get('/api/v1/users/me').set('Cookie', session).expect(401);
  });

  it('applies suspension and role changes on the next request, not at token expiry', async () => {
    await api('suspendme').get('/users/me').expect(200);
    await prisma.user.update({
      where: { id: users.suspendme! },
      data: { status: 'SUSPENDED' },
    });
    await api('suspendme').get('/users/me').expect(401);

    await api('official').get('/government/mine').expect(200);
    await prisma.user.update({
      where: { id: users.official! },
      data: { role: 'CITIZEN' },
    });
    await api('official').get('/government/mine').expect(403);
    await prisma.user.update({
      where: { id: users.official! },
      data: { role: 'GOVERNMENT' },
    });
    await api('official').get('/government/mine').expect(200);
  });

  it('limits sign-in attempts per address across many accounts', async () => {
    let last = 0;
    for (let i = 0; i < 52; i++) {
      const res = await request(server)
        .post('/api/v1/auth/login')
        .send({ email: `${PREFIX}spray${i}@samadhaan.test`, password: 'Wrong-pass-123' });
      last = res.status;
      if (last === 429) break;
    }
    expect(last).toBe(429);
  });

  // ============================================================ files

  it('serves only problem photos from the public media route', async () => {
    const hex = 'a'.repeat(32);
    for (const path of [
      `evidence/2026/10/${hex}.jpg`,
      `resolution/2026/10/${hex}.jpg`,
      `knowledge/2026/10/${hex}.pdf`,
      `Problems/2026/10/${hex}.jpg`,
      '..%2F..%2F.env',
      `problems/2026/10/${hex}.svg`,
    ]) {
      await request(server).get(`/api/v1/media/${path}`).expect(404);
    }
  });

  it('strips EXIF and GPS from uploaded photos, and spoofing characters from names', async () => {
    const photo = await sharp({
      create: { width: 200, height: 150, channels: 3, background: '#3366cc' },
    })
      .jpeg()
      .withExif({ IFD0: { Copyright: 'secret-exif-marker', Artist: 'home-gps-proxy' } })
      .toBuffer();
    expect((await sharp(photo).metadata()).exif).toBeDefined();

    const res = await request(server)
      .post('/api/v1/problems/images')
      .set('Cookie', cookies.citizen!)
      .attach('file', photo, { filename: 'photo‮gpj.png', contentType: 'image/jpeg' })
      .expect(201);
    const { storageKey, originalFileName } = res.body.data;
    storedKeys.push(storageKey);
    expect(originalFileName).toBe('photogpj.png');

    const stored = await storage.get(storageKey);
    expect(stored).not.toBeNull();
    expect((await sharp(stored!).metadata()).exif).toBeUndefined();
    expect(stored!.includes(Buffer.from('secret-exif-marker'))).toBe(false);

    const served = await request(server).get(`/api/v1/media/${storageKey}`).expect(200);
    expect(served.headers['content-security-policy']).toContain('sandbox');
  });

  // ============================================================ authorisation fixes

  it('does not let a reporter take a reviewed report out of the government workflow', async () => {
    const candidate = await prisma.problemDuplicateCandidate.findFirstOrThrow({
      where: { problemId: problems.verified!.id },
    });
    await api('citizen')
      .post(`/problems/${problems.verified!.publicId}/duplicates/${candidate.id}/confirm`)
      .expect(409);
    const row = await prisma.problem.findUniqueOrThrow({
      where: { id: problems.verified!.id },
    });
    expect(row.status).toBe('VERIFIED');
  });

  it('separates duties: an official cannot allocate to their own organisation', async () => {
    await api('dual')
      .post(
        `/government/${PREFIX}office/problems/${problems.verified!.publicId}/allocations`,
        { organizationId: orgs.ngo },
      )
      .expect(403);
    expect(
      await prisma.problemAllocation.count({
        where: { problemId: problems.verified!.id },
      }),
    ).toBe(0);
  });

  it('removes knowledge editing rights from an official who left the office', async () => {
    const created = await api('official')
      .post('/knowledge/sources', {
        title: `${TITLE}guidance`,
        sourceType: 'CIVIC_GUIDELINE',
        visibility: 'PUBLIC',
        organizationId: orgs.office,
        content: 'Clear drains before the monsoon.',
      })
      .expect(201);
    const id = created.body.data.id;
    await api('official')
      .patch(`/knowledge/sources/${id}`, { title: `${TITLE}guidance v2` })
      .expect(200);
    await prisma.organizationMember.updateMany({
      where: { organizationId: orgs.office!, userId: users.official! },
      data: { status: 'LEFT' },
    });
    const after = await api('official').patch(`/knowledge/sources/${id}`, {
      title: `${TITLE}rewritten`,
    });
    expect([403, 404]).toContain(after.status);
    await prisma.organizationMember.updateMany({
      where: { organizationId: orgs.office!, userId: users.official! },
      data: { status: 'ACTIVE' },
    });
  });

  it('does not let anyone, an administrator included, invite themselves', async () => {
    await api('admin')
      .post(`/organizations/${orgs.ngo}/invitations`, {
        email: 'admin@samadhaan.dev',
        membershipRole: 'MEMBER',
      })
      .expect(403);
  });

  it('offers no way to forge notifications or points', async () => {
    await api('citizen')
      .post('/notifications', { recipientId: users.official, type: 'BADGE_EARNED' })
      .expect(404);
    await api('citizen').post('/users/me/impact', { amount: 1000 }).expect(404);
    await api('citizen').patch('/users/me', { role: 'ADMIN' }).expect(400);
  });

  it('treats injection payloads as data', async () => {
    for (const q of [
      "' OR 1=1 --",
      '" UNION SELECT password FROM users --',
      '<script>alert(1)</script>',
    ]) {
      const res = await api('citizen').get(
        `/search/problems?q=${encodeURIComponent(q)}&interpret=false`,
      );
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|\$argon2/);
    }
  });
});
