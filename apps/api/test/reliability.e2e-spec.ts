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
import { deleteAuditLogs } from './audit-maintenance.js';

/**
 * Regression tests for the defects fixed in Prompt 29 (docs/PRODUCTION_READINESS.md):
 * each test reproduces the failure scenario found by the audit and asserts the
 * fixed behaviour — and, where a fix restricts something, that the permitted
 * path still works.
 */
describe('Reliability regressions (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let storage: StorageService;
  let server: Parameters<typeof request>[0];

  const PASSWORD = 'DevPassword123!';
  const run = Date.now().toString(36);
  const PREFIX = `e2e-rel-${run}-`;
  const users: Record<string, string> = {};
  const cookies: Record<string, string[]> = {};
  const orgs: Record<string, string> = {};
  const problemIds: string[] = [];
  const keys: string[] = [];

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

    const template = await prisma.user.findUniqueOrThrow({
      where: { email: 'government@samadhaan.dev' },
    });
    for (const [key, role] of [
      ['citizen', 'CITIZEN'],
      ['official', 'GOVERNMENT'],
      ['owner', 'NGO'],
      ['admin', 'ADMIN'],
      ['official2', 'GOVERNMENT'],
    ] as const) {
      users[key] = (
        await prisma.user.create({
          data: {
            email: `${PREFIX}${key}@samadhaan.test`,
            displayName: `${PREFIX}${key}`,
            passwordHash: template.passwordHash,
            fullName: `Reliability ${key}`,
            role,
            status: 'ACTIVE',
          },
        })
      ).id;
    }
    for (const [key, type] of [
      ['office', 'GOVERNMENT'],
      ['ngo', 'NGO'],
    ] as const) {
      orgs[key] = (
        await prisma.organization.create({
          data: {
            name: `E2E Reliability ${key} ${run}`,
            slug: `${PREFIX}${key}`,
            type,
            verificationStatus: 'VERIFIED',
            city: 'Pune',
            ...(type === 'GOVERNMENT'
              ? {
                  jurisdictionType: 'MUNICIPAL_CORPORATION',
                  jurisdictionName: `Reliability ${run}`,
                  jurisdictionCities: ['Pune'],
                }
              : {}),
          },
        })
      ).id;
    }
    await prisma.organizationMember.createMany({
      data: [
        {
          organizationId: orgs.office!,
          userId: users.official!,
          membershipRole: 'OWNER',
          status: 'ACTIVE',
        },
        {
          organizationId: orgs.ngo!,
          userId: users.owner!,
          membershipRole: 'OWNER',
          status: 'ACTIVE',
        },
      ],
    });

    const ratelimits = await redis.connection.keys('ratelimit:*');
    if (ratelimits.length) await redis.connection.del(...ratelimits);
    for (const key of Object.keys(users)) {
      const login = await request(server)
        .post('/api/v1/auth/login')
        .send({ email: `${PREFIX}${key}@samadhaan.test`, password: PASSWORD })
        .expect(200);
      const header = login.headers['set-cookie'];
      cookies[key] = Array.isArray(header) ? header : header ? [header] : [];
    }
  });

  afterAll(async () => {
    if (prisma) {
      const ids = Object.values(users);
      const created = await prisma.problem.findMany({
        where: { reporterId: { in: ids } },
        select: { id: true },
      });
      const allProblems = [...new Set([...problemIds, ...created.map((p) => p.id)])];
      await prisma.problemAllocation.deleteMany({
        where: { problemId: { in: allProblems } },
      });
      await prisma.problemDuplicateCandidate.deleteMany({
        where: { problemId: { in: allProblems } },
      });
      await prisma.problem.updateMany({
        where: { id: { in: allProblems } },
        data: { duplicateOfId: null },
      });
      await prisma.problem.deleteMany({ where: { id: { in: allProblems } } });
      await prisma.organizationMember.deleteMany({
        where: { organizationId: { in: Object.values(orgs) } },
      });
      await deleteAuditLogs(prisma, {
        OR: [
          { actorUserId: { in: ids } },
          { entityId: { in: [...allProblems, ...Object.values(orgs)] } },
        ],
      });
      await prisma.organization.deleteMany({
        where: { id: { in: Object.values(orgs) } },
      });
      await prisma.notification.deleteMany({ where: { recipientId: { in: ids } } });
      await prisma.session.deleteMany({ where: { userId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
      await Promise.all(keys.map((k) => storage.delete(k).catch(() => undefined)));
    }
    await app?.close();
  });

  const as = (who: string) => ({
    get: (path: string) =>
      request(server).get(`/api/v1${path}`).set('Cookie', cookies[who]!),
    post: (path: string, body: object = {}) =>
      request(server).post(`/api/v1${path}`).set('Cookie', cookies[who]!).send(body),
  });

  async function problem(data: Record<string, unknown>) {
    const row = await prisma.problem.create({
      data: {
        reporterId: users.citizen!,
        title: `Reliability fixture ${run}`,
        description: 'Fixture created by the reliability e2e suite.',
        category: 'DRAINAGE',
        latitude: 18.52,
        longitude: 73.85,
        city: 'Pune',
        state: 'Maharashtra',
        status: 'SUBMITTED',
        ...data,
      },
    });
    problemIds.push(row.id);
    return row;
  }

  it('a double-submitted report saves once and keeps its photo (no 500, no deleted file)', async () => {
    const jpeg = await sharp({
      create: {
        width: 640,
        height: 480,
        channels: 3,
        background: { r: 60, g: 90, b: 140 },
      },
    })
      .jpeg()
      .toBuffer();
    const upload = await request(server)
      .post('/api/v1/problems/images')
      .set('Cookie', cookies.citizen!)
      .attach('file', jpeg, 'pothole.jpg')
      .expect(201);
    const storageKey = upload.body.data.storageKey as string;
    keys.push(storageKey);

    const body = {
      title: 'Blocked storm drain outside the ward office',
      description:
        'The drain has been blocked for a week and water pools across the road.',
      category: 'DRAINAGE',
      location: { latitude: 18.52, longitude: 73.85, city: 'Pune' },
      images: [{ storageKey, sortOrder: 0, isPrimary: true }],
    };
    const [a, b] = await Promise.all([
      as('citizen').post('/problems', body),
      as('citizen').post('/problems', body),
    ]);
    const statuses = [a.status, b.status].sort();
    // Before Prompt 29: [201, 500], and the 500's cleanup deleted the photo
    // the 201's report now pointed at.
    expect(statuses[0]).toBe(201);
    expect(statuses[1]).toBeGreaterThanOrEqual(400);
    expect(statuses[1]).toBeLessThan(500);

    const saved = await prisma.problemImage.findMany({ where: { storageKey } });
    expect(saved).toHaveLength(1);
    expect(await storage.get(storageKey)).not.toBeNull();
  });

  it('a platform admin cannot staff a government office, but still manages other organisations', async () => {
    await as('admin')
      .post(`/organizations/${orgs.office}/invitations`, {
        email: `${PREFIX}official2@samadhaan.test`,
        membershipRole: 'ADMIN',
      })
      .expect(403);
    await as('admin')
      .post(`/organizations/${orgs.ngo}/invitations`, {
        email: `${PREFIX}citizen@samadhaan.test`,
        membershipRole: 'MEMBER',
      })
      .expect(201);
    // The office's own owner still can.
    await as('official')
      .post(`/organizations/${orgs.office}/invitations`, {
        email: `${PREFIX}official2@samadhaan.test`,
        membershipRole: 'MEMBER',
      })
      .expect(201);
  });

  it('an organisation no longer eligible cannot accept a pending allocation', async () => {
    const verified = await problem({ status: 'VERIFIED' });
    const allocation = await prisma.problemAllocation.create({
      data: {
        problemId: verified.id,
        organizationId: orgs.ngo!,
        governmentOrganizationId: orgs.office!,
        allocatedById: users.official!,
      },
    });
    await prisma.organization.update({
      where: { id: orgs.ngo! },
      data: { verificationStatus: 'REJECTED' },
    });
    try {
      await as('owner')
        .post(`/organizations/${PREFIX}ngo/allocations/${allocation.id}/accept`, {})
        .expect(403);
      const after = await prisma.problemAllocation.findUniqueOrThrow({
        where: { id: allocation.id },
      });
      expect(after.status).toBe('PENDING');
      expect(
        (await prisma.problem.findUniqueOrThrow({ where: { id: verified.id } })).status,
      ).toBe('VERIFIED');
    } finally {
      await prisma.organization.update({
        where: { id: orgs.ngo! },
        data: { verificationStatus: 'VERIFIED' },
      });
    }
  });

  it('concurrent duplicate verdicts: the first stands and the records agree', async () => {
    const original = await problem({});
    const newer = await problem({});
    const candidate = await prisma.problemDuplicateCandidate.create({
      data: {
        problemId: newer.id,
        candidateProblemId: original.id,
        combinedScore: 0.9,
        status: 'LIKELY_DUPLICATE',
      },
    });
    const path = `/problems/${newer.publicId}/duplicates/${candidate.id}`;
    const [confirm, reject] = await Promise.all([
      as('citizen').post(`${path}/confirm`),
      as('citizen').post(`${path}/reject`),
    ]);
    const statuses = [confirm.status, reject.status];
    expect(statuses.filter((s) => s === 409)).toHaveLength(1);

    const pair = await prisma.problemDuplicateCandidate.findUniqueOrThrow({
      where: { id: candidate.id },
    });
    const merged = await prisma.problem.findUniqueOrThrow({ where: { id: newer.id } });
    if (pair.status === 'CONFIRMED_DUPLICATE') {
      expect(merged).toMatchObject({ status: 'DUPLICATE', duplicateOfId: original.id });
    } else {
      expect(pair.status).toBe('NOT_DUPLICATE');
      expect(merged.duplicateOfId).toBeNull();
    }
  });

  it('a public profile does not count unpublished drafts', async () => {
    const before = await request(server)
      .get(`/api/v1/users/by-handle/${PREFIX}citizen`)
      .expect(200);
    await problem({ status: 'DRAFT', submittedAt: null });
    const after = await request(server)
      .get(`/api/v1/users/by-handle/${PREFIX}citizen`)
      .expect(200);
    expect(after.body.data.activity.problemsReported).toBe(
      before.body.data.activity.problemsReported,
    );
  });

  it('a refresh token used twice at once mints at most one session, then revokes all (Prompt 30)', async () => {
    const login = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: `${PREFIX}official2@samadhaan.test`, password: PASSWORD })
      .expect(200);
    const header = login.headers['set-cookie'];
    const jar = Array.isArray(header) ? header : header ? [header] : [];
    const [a, b] = await Promise.all([
      request(server).post('/api/v1/auth/refresh').set('Cookie', jar),
      request(server).post('/api/v1/auth/refresh').set('Cookie', jar),
    ]);
    expect([a.status, b.status].filter((s) => s === 200).length).toBeLessThanOrEqual(1);
    // Overlapping or back to back, a second use of one token is reuse: every
    // session of the user is revoked, including any the winner created.
    expect(
      await prisma.session.count({
        where: { userId: users.official2!, revokedAt: null },
      }),
    ).toBe(0);
  });

  it('refuses TRUNCATE on the append-only tables (Prompt 30)', async () => {
    for (const table of ['audit_logs', 'impact_point_transactions']) {
      // Inside a transaction that is always rolled back, so even a failing
      // guard could never empty the table.
      const outcome = await prisma
        .$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`TRUNCATE ${table}`);
          throw new Error('ROLLBACK_SENTINEL');
        })
        .catch((error: Error) => error.message);
      expect(outcome).toContain('append-only');
      expect(outcome).not.toContain('ROLLBACK_SENTINEL');
    }
  });
});
