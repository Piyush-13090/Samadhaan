import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp, registerNotFoundHandler } from '../src/bootstrap.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { RedisService } from '../src/redis/redis.service.js';

/**
 * Authentication and RBAC, exercised end to end against the real application:
 * real Argon2 hashing, real PostgreSQL, real guards.
 *
 * These assertions are the security properties of the system, so a failure here
 * is a vulnerability rather than a broken test. Requires infrastructure to be
 * running (`docker compose up -d`) and the development seed to have been run.
 */
describe('Authentication (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let server: Parameters<typeof request>[0];

  /** Unique per run so repeated runs never collide on the email index. */
  const suffix = Date.now();
  const newUser = {
    fullName: 'Test Citizen',
    email: `e2e-${suffix}@samadhaan.test`,
    password: 'Monsoon-Drain-2026',
  };

  const SEEDED_PASSWORD = 'DevPassword123!';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    registerNotFoundHandler(app);

    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    server = app.getHttpServer();

    // Rate-limit counters live in Redis on a five-minute window, so a suite run
    // shortly after a previous one would inherit its tally and start failing
    // with 429s. Clearing the buckets makes the suite independent of when it
    // last ran, rather than of how many times it signs in.
    await clearRateLimits();
  });

  /** Drops every rate-limit bucket, so the suite starts from a clean tally. */
  async function clearRateLimits(): Promise<void> {
    const keys = await redis.connection.keys('ratelimit:*');
    if (keys.length > 0) await redis.connection.del(...keys);
  }

  afterAll(async () => {
    // Remove only what this run created; seeded accounts are left in place.
    await prisma.user
      .deleteMany({ where: { email: { contains: `e2e-${suffix}` } } })
      .catch(() => undefined);
    await app?.close();
  });

  /** Extracts cookies from a response for reuse on the next request. */
  function cookiesFrom(response: request.Response): string[] {
    const header = response.headers['set-cookie'];
    return Array.isArray(header) ? header : header ? [header] : [];
  }

  async function loginAs(email: string): Promise<string[]> {
    // Each helper call is a fresh sign-in; the limiter exists to slow real
    // credential stuffing, not to cap a test suite's legitimate logins.
    await clearRateLimits();

    const response = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: SEEDED_PASSWORD })
      .expect(200);

    return cookiesFrom(response);
  }

  // ---------------------------------------------------------------- register

  describe('POST /auth/register', () => {
    it('creates an account and starts a session', async () => {
      const response = await request(server)
        .post('/api/v1/auth/register')
        .send(newUser)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.user.email).toBe(newUser.email);
      expect(response.body.data.expiresIn).toBeGreaterThan(0);
    });

    it('stores the password as an argon2 hash, never as plaintext', async () => {
      const stored = await prisma.user.findUnique({ where: { email: newUser.email } });

      expect(stored?.passwordHash).toMatch(/^\$argon2id\$/);
      expect(stored?.passwordHash).not.toContain(newUser.password);
    });

    it('never returns the password hash', async () => {
      const response = await request(server)
        .post('/api/v1/auth/register')
        .send({ ...newUser, email: `e2e-${suffix}-b@samadhaan.test` })
        .expect(201);

      expect(JSON.stringify(response.body)).not.toContain('argon2');
      expect(response.body.data.user).not.toHaveProperty('passwordHash');
    });

    it('rejects a duplicate email', async () => {
      const response = await request(server)
        .post('/api/v1/auth/register')
        .send(newUser)
        .expect(409);

      expect(response.body.error.code).toBe('CONFLICT');
    });

    it('rejects a weak password', async () => {
      const response = await request(server)
        .post('/api/v1/auth/register')
        .send({
          ...newUser,
          email: `e2e-${suffix}-weak@samadhaan.test`,
          password: 'password123',
        })
        .expect(400);

      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    // The core privilege-escalation defence.
    it('rejects an attempt to self-assign a privileged role', async () => {
      const response = await request(server)
        .post('/api/v1/auth/register')
        .send({
          fullName: 'Mallory',
          email: `e2e-${suffix}-admin@samadhaan.test`,
          password: 'Monsoon-Drain-2026',
          role: 'ADMIN',
        })
        .expect(400);

      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(
        await prisma.user.count({ where: { email: { contains: `${suffix}-admin` } } }),
      ).toBe(0);
    });

    it('always assigns CITIZEN to a public registration', async () => {
      const stored = await prisma.user.findUnique({ where: { email: newUser.email } });

      expect(stored?.role).toBe('CITIZEN');
    });
  });

  // ------------------------------------------------------------------- login

  describe('POST /auth/login', () => {
    it('signs in with correct credentials', async () => {
      const response = await request(server)
        .post('/api/v1/auth/login')
        .send({ email: newUser.email, password: newUser.password })
        .expect(200);

      expect(response.body.data.user.email).toBe(newUser.email);
    });

    it('sets both auth cookies as httpOnly', async () => {
      const response = await request(server)
        .post('/api/v1/auth/login')
        .send({ email: newUser.email, password: newUser.password });

      const cookies = cookiesFrom(response);

      expect(
        cookies.some((c) => c.startsWith('sam_access=') && /HttpOnly/i.test(c)),
      ).toBe(true);
      expect(
        cookies.some((c) => c.startsWith('sam_refresh=') && /HttpOnly/i.test(c)),
      ).toBe(true);
    });

    it('scopes the refresh cookie to the auth path only', async () => {
      const response = await request(server)
        .post('/api/v1/auth/login')
        .send({ email: newUser.email, password: newUser.password });

      const refresh = cookiesFrom(response).find((c) => c.startsWith('sam_refresh='));

      expect(refresh).toMatch(/Path=\/api\/v1\/auth/i);
    });

    it('rejects an incorrect password', async () => {
      const response = await request(server)
        .post('/api/v1/auth/login')
        .send({ email: newUser.email, password: 'WrongPassword2026' })
        .expect(401);

      expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    // Account enumeration: the two failures must be indistinguishable.
    it('returns an identical error for an unknown email', async () => {
      const unknown = await request(server)
        .post('/api/v1/auth/login')
        .send({ email: `absent-${suffix}@samadhaan.test`, password: 'WrongPassword2026' })
        .expect(401);

      const wrongPassword = await request(server)
        .post('/api/v1/auth/login')
        .send({ email: newUser.email, password: 'WrongPassword2026' })
        .expect(401);

      expect(unknown.body.error).toEqual(wrongPassword.body.error);
    });
  });

  // ---------------------------------------------------------------------- me

  describe('GET /auth/me', () => {
    it('requires authentication', async () => {
      const response = await request(server).get('/api/v1/auth/me').expect(401);

      expect(response.body.error.code).toBe('SESSION_EXPIRED');
    });

    it('rejects a forged token', async () => {
      await request(server)
        .get('/api/v1/auth/me')
        .set('Cookie', ['sam_access=not.a.real.token'])
        .expect(401);
    });

    it('returns the authenticated user', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');

      const response = await request(server)
        .get('/api/v1/auth/me')
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body.data.email).toBe('citizen@samadhaan.dev');
      expect(response.body.data.role).toBe('CITIZEN');
      expect(response.body.data).not.toHaveProperty('passwordHash');
    });
  });

  // -------------------------------------------------------------------- RBAC

  describe('Role-based access control', () => {
    it('denies a citizen access to an admin-only endpoint', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');

      const response = await request(server)
        .get('/api/v1/users/count')
        .set('Cookie', cookies)
        .expect(403);

      expect(response.body.error.code).toBe('FORBIDDEN');
    });

    it('denies a government user the same endpoint', async () => {
      const cookies = await loginAs('government@samadhaan.dev');

      await request(server).get('/api/v1/users/count').set('Cookie', cookies).expect(403);
    });

    it('allows an admin', async () => {
      const cookies = await loginAs('admin@samadhaan.dev');

      const response = await request(server)
        .get('/api/v1/users/count')
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body.data.total).toBeGreaterThan(0);
    });

    it('does not name the required role in the denial', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');

      const response = await request(server)
        .get('/api/v1/users/count')
        .set('Cookie', cookies)
        .expect(403);

      expect(response.body.error.message).not.toContain('ADMIN');
    });
  });

  // ----------------------------------------------------------------- profile

  describe('PATCH /users/me', () => {
    it('updates permitted fields', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');

      const response = await request(server)
        .patch('/api/v1/users/me')
        .set('Cookie', cookies)
        .send({ fullName: 'Priya Sharma' })
        .expect(200);

      expect(response.body.data.fullName).toBe('Priya Sharma');
    });

    // Mass assignment: the DTO has no `role`, so the request is rejected whole.
    it('rejects an attempt to change role', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');

      const response = await request(server)
        .patch('/api/v1/users/me')
        .set('Cookie', cookies)
        .send({ role: 'ADMIN' })
        .expect(400);

      expect(response.body.error.code).toBe('VALIDATION_FAILED');

      const after = await prisma.user.findUnique({
        where: { email: 'citizen@samadhaan.dev' },
      });
      expect(after?.role).toBe('CITIZEN');
    });

    it('rejects an attempt to change status', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');

      await request(server)
        .patch('/api/v1/users/me')
        .set('Cookie', cookies)
        .send({ status: 'ACTIVE', role: 'ADMIN' })
        .expect(400);
    });

    it('rejects a javascript: avatar URL, which would be stored XSS', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');

      await request(server)
        .patch('/api/v1/users/me')
        .set('Cookie', cookies)
        .send({ avatarUrl: 'javascript:alert(1)' })
        .expect(400);
    });

    it('requires authentication', async () => {
      await request(server).patch('/api/v1/users/me').send({ fullName: 'X' }).expect(401);
    });
  });

  // ------------------------------------------------------------ session life

  describe('Session lifecycle', () => {
    it('refreshes and rotates the refresh token', async () => {
      const cookies = await loginAs('ngo@samadhaan.dev');
      const before = cookies.find((c) => c.startsWith('sam_refresh='));

      const response = await request(server)
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookies)
        .expect(200);

      const after = cookiesFrom(response).find((c) => c.startsWith('sam_refresh='));

      expect(after).toBeDefined();
      expect(after).not.toBe(before);
    });

    // Revocation must be real: a cookie captured before logout must stop working.
    it('invalidates the session on logout, server-side', async () => {
      const cookies = await loginAs('university@samadhaan.dev');

      await request(server).get('/api/v1/auth/me').set('Cookie', cookies).expect(200);
      await request(server)
        .post('/api/v1/auth/logout')
        .set('Cookie', cookies)
        .expect(204);
      await request(server).get('/api/v1/auth/me').set('Cookie', cookies).expect(401);
    });

    it('clears both cookies on logout', async () => {
      const cookies = await loginAs('industry@samadhaan.dev');

      const response = await request(server)
        .post('/api/v1/auth/logout')
        .set('Cookie', cookies)
        .expect(204);

      const cleared = cookiesFrom(response).join(';');
      expect(cleared).toContain('sam_access=;');
      expect(cleared).toContain('sam_refresh=;');
    });

    it('rejects a refresh token that has already been used', async () => {
      const cookies = await loginAs('ngo@samadhaan.dev');

      await request(server)
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookies)
        .expect(200);
      await request(server)
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookies)
        .expect(401);
    });

    it('allows logout without a valid access token', async () => {
      await request(server).post('/api/v1/auth/logout').expect(204);
    });
  });
});
