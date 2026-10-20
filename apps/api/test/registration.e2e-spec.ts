import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp, registerNotFoundHandler } from '../src/bootstrap.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { DomainEventBus } from '../src/events/domain-event-bus.js';
import { ImpactEventHandler } from '../src/impact/impact-event.handler.js';
import { RedisService } from '../src/redis/redis.service.js';
import { deleteAuditLogs } from './audit-maintenance.js';

/**
 * Self-registration end to end (release blocker B1, 2026-10-19).
 *
 * The defect: registration created accounts as PENDING_VERIFICATION, while
 * the access guard admits only ACTIVE accounts and nothing could activate
 * one. A new citizen got 201 and then 401 on every authenticated request.
 * Until email verification exists, a public registration is an ACTIVE
 * CITIZEN whose email stays unverified (`emailVerifiedAt` null).
 *
 * The rest of this file pins the restrictions that must not loosen with that
 * change: forged roles, suspended, deleted and still-pending accounts,
 * session expiry and refresh-token replay.
 */
describe('Self-registration (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let server: Parameters<typeof request>[0];

  const RUN = `e2e-reg-${Date.now().toString(36)}`;
  const PASSWORD = 'Ward-12 drains are blocked again';
  const email = (key: string) => `${RUN}-${key}@samadhaan.test`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    registerNotFoundHandler(app);
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    server = app.getHttpServer();
  });

  // Registration and login are rate limited per client; this suite registers
  // more accounts than one real person would.
  beforeEach(async () => {
    const keys = await redis.connection.keys('ratelimit:*');
    if (keys.length > 0) await redis.connection.del(...keys);
  });

  afterAll(async () => {
    try {
      if (prisma) {
        const bus = app.get(DomainEventBus);
        await bus.drain().catch(() => undefined);
        await app
          .get(ImpactEventHandler)
          .idle()
          .catch(() => undefined);
        await bus.drain().catch(() => undefined);
        const ids = (
          await prisma.user.findMany({
            where: { email: { startsWith: `${RUN}-` } },
            select: { id: true },
          })
        ).map((u) => u.id);
        const problemIds = (
          await prisma.problem.findMany({
            where: { reporterId: { in: ids } },
            select: { id: true },
          })
        ).map((p) => p.id);
        await prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT set_config('samadhaan.audit_maintenance', 'on', true)`;
          await tx.impactPointTransaction.deleteMany({
            where: { OR: [{ userId: { in: ids } }, { problemId: { in: problemIds } }] },
          });
          await tx.userBadge.deleteMany({ where: { userId: { in: ids } } });
        });
        await prisma.userImpactStats.deleteMany({ where: { userId: { in: ids } } });
        await prisma.notification.deleteMany({
          where: {
            OR: [{ recipientId: { in: ids } }, { entityId: { in: problemIds } }],
          },
        });
        await deleteAuditLogs(prisma, {
          OR: [
            { actorUserId: { in: ids } },
            { entityId: { in: [...ids, ...problemIds] } },
          ],
        });
        await prisma.problemFollow.deleteMany({
          where: { problemId: { in: problemIds } },
        });
        await prisma.problemAiAnalysis.deleteMany({
          where: { problemId: { in: problemIds } },
        });
        await prisma.problem.deleteMany({ where: { id: { in: problemIds } } });
        await prisma.session.deleteMany({ where: { userId: { in: ids } } });
        await prisma.user.deleteMany({ where: { id: { in: ids } } });
      }
    } finally {
      await app?.close();
    }
  }, 60_000);

  const cookiesFrom = (response: request.Response): string[] => {
    const header = response.headers['set-cookie'];
    return Array.isArray(header) ? header : header ? [header] : [];
  };

  const register = (key: string, extra: Record<string, unknown> = {}) =>
    request(server)
      .post('/api/v1/auth/register')
      .send({
        fullName: 'Asha Registration',
        email: email(key),
        password: PASSWORD,
        ...extra,
      });

  const login = (key: string) =>
    request(server)
      .post('/api/v1/auth/login')
      .send({ email: email(key), password: PASSWORD });

  const me = (cookies: string[]) =>
    request(server).get('/api/v1/auth/me').set('Cookie', cookies);

  /** Registers a fresh citizen and returns its session cookies. */
  async function citizen(key: string): Promise<string[]> {
    return cookiesFrom(await register(key).expect(201));
  }

  describe('a new citizen', () => {
    let cookies: string[];

    it('registers as an active citizen whose email is not verified', async () => {
      const response = await register('asha').expect(201);
      cookies = cookiesFrom(response);
      expect(response.body.data.user).toMatchObject({
        email: email('asha'),
        role: 'CITIZEN',
        status: 'ACTIVE',
        emailVerifiedAt: null,
      });

      const stored = await prisma.user.findUniqueOrThrow({
        where: { email: email('asha') },
      });
      expect(stored.status).toBe('ACTIVE');
      expect(stored.role).toBe('CITIZEN');
      expect(stored.emailVerifiedAt).toBeNull();
    });

    it('can use the session registration started', async () => {
      const response = await me(cookies).expect(200);
      expect(response.body.data).toMatchObject({ email: email('asha'), role: 'CITIZEN' });
      await request(server).get('/api/v1/users/me').set('Cookie', cookies).expect(200);
    });

    it('can sign in again and use that session', async () => {
      const fresh = cookiesFrom(await login('asha').expect(200));
      await me(fresh).expect(200);
      await request(server).get('/api/v1/users/me').set('Cookie', fresh).expect(200);
    });

    it('can report a civic problem and read it back', async () => {
      const created = await request(server)
        .post('/api/v1/problems')
        .set('Cookie', cookies)
        .send({
          title: 'Open manhole beside the Sector 9 bus stop',
          description:
            'The cover has been missing for a week. Synthetic report created by the registration e2e suite.',
          category: 'DRAINAGE',
          location: { latitude: 28.4595, longitude: 77.0266, city: 'Gurugram' },
        })
        .expect(201);
      const { publicId } = created.body.data as { publicId: string };

      const read = await request(server)
        .get(`/api/v1/problems/${publicId}`)
        .set('Cookie', cookies)
        .expect(200);
      expect(read.body.data.publicId).toBe(publicId);
    });

    it('gains no privileged capability', async () => {
      // Government, organisation and admin surfaces stay closed to a citizen.
      const admin = await request(server)
        .get('/api/v1/admin/ml/models')
        .set('Cookie', cookies);
      expect(admin.status).toBe(403);
      // The seeded office's analytics: government-role only, whatever the office.
      const analytics = await request(server)
        .get('/api/v1/government/ward-12-municipal-office/analytics/overview')
        .set('Cookie', cookies);
      expect(analytics.status).toBe(403);
    });
  });

  describe('forged privileges', () => {
    it.each([
      ['ADMIN', { role: 'ADMIN' }],
      ['GOVERNMENT', { role: 'GOVERNMENT' }],
      ['NGO', { role: 'NGO' }],
      ['a status', { status: 'ACTIVE' }],
      ['a verified email', { emailVerifiedAt: '2026-01-01T00:00:00.000Z' }],
    ])('refuses a registration that supplies %s', async (_label, extra) => {
      const key = `forged-${Object.keys(extra)[0]}-${String(Object.values(extra)[0]).toLowerCase()}`;
      await register(key, extra).expect(400);
      expect(await prisma.user.count({ where: { email: email(key) } })).toBe(0);
    });
  });

  describe('restricted accounts stay restricted', () => {
    it('a suspended account loses its session and cannot sign in', async () => {
      const cookies = await citizen('suspended');
      await prisma.user.update({
        where: { email: email('suspended') },
        data: { status: 'SUSPENDED' },
      });
      await me(cookies).expect(401);
      const denied = await login('suspended').expect(403);
      expect(denied.body.error.code).toBe('ACCOUNT_INACTIVE');
    });

    it('an account still pending verification cannot use a session', async () => {
      // Accounts created before this change, or by future flows, stay gated.
      const cookies = await citizen('pending');
      await prisma.user.update({
        where: { email: email('pending') },
        data: { status: 'PENDING_VERIFICATION' },
      });
      await me(cookies).expect(401);
    });

    it('a deleted account loses its session', async () => {
      const cookies = await citizen('deleted');
      await prisma.user.update({
        where: { email: email('deleted') },
        data: { deletedAt: new Date() },
      });
      await me(cookies).expect(401);
    });
  });

  describe('session security is unchanged', () => {
    it('an expired session is refused, and so is its refresh token', async () => {
      const cookies = await citizen('expired');
      const user = await prisma.user.findUniqueOrThrow({
        where: { email: email('expired') },
      });
      await prisma.session.updateMany({
        where: { userId: user.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await me(cookies).expect(401);
      await request(server)
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookies)
        .expect(401);
    });

    it('replaying a used refresh token revokes every session of the user', async () => {
      const original = await citizen('replay');
      const rotated = cookiesFrom(
        await request(server)
          .post('/api/v1/auth/refresh')
          .set('Cookie', original)
          .expect(200),
      );
      await me(rotated).expect(200);

      // The old token again: treated as theft.
      await request(server)
        .post('/api/v1/auth/refresh')
        .set('Cookie', original)
        .expect(401);
      await me(rotated).expect(401);
      const user = await prisma.user.findUniqueOrThrow({
        where: { email: email('replay') },
      });
      expect(
        await prisma.session.count({ where: { userId: user.id, revokedAt: null } }),
      ).toBe(0);
    });
  });
});
