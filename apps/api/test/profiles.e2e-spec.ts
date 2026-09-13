import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp, registerNotFoundHandler } from '../src/bootstrap.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { RedisService } from '../src/redis/redis.service.js';

/**
 * Profiles and organisations, end to end against the real application.
 *
 * The assertions here are the authorisation and privacy guarantees of the
 * profile system, so a failure is a vulnerability rather than a broken test.
 *
 * Requires a migrated, seeded database.
 */
describe('Profiles (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let server: Parameters<typeof request>[0];

  const SEEDED_PASSWORD = 'DevPassword123!';
  const created = { orgIds: [] as string[], userIds: [] as string[] };

  /** Clean City Foundation — verified, owned by the NGO account. */
  let cleanCityId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    registerNotFoundHandler(app);

    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    server = app.getHttpServer();

    await clearRateLimits();

    const org = await prisma.organization.findUniqueOrThrow({
      where: { slug: 'clean-city-foundation' },
    });
    cleanCityId = org.id;
  });

  afterAll(async () => {
    // These tests mutate the seeded citizen's profile. Restore it, so the
    // development database is left exactly as the seed produced it and a
    // later run (or a developer browsing the app) sees the expected fixture.
    await prisma.user
      .updateMany({
        where: { email: 'citizen@samadhaan.dev' },
        data: {
          fullName: 'Priya Sharma',
          bio: 'Resident of Sector 12. Interested in drainage and pedestrian safety.',
          city: 'Gurugram',
          state: 'Haryana',
          country: 'India',
        },
      })
      .catch(() => undefined);

    await prisma.organizationMember
      .deleteMany({ where: { organizationId: { in: created.orgIds } } })
      .catch(() => undefined);
    await prisma.organizationExpertise
      .deleteMany({ where: { organizationId: { in: created.orgIds } } })
      .catch(() => undefined);
    await prisma.organization
      .deleteMany({ where: { id: { in: created.orgIds } } })
      .catch(() => undefined);
    await prisma.user
      .deleteMany({ where: { id: { in: created.userIds } } })
      .catch(() => undefined);

    // Leave the seeded fixtures as they were found.
    await prisma.organizationExpertise
      .deleteMany({ where: { organizationId: cleanCityId, category: 'POLLUTION' } })
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

  // ====================================================== user profile

  describe('GET /users/me', () => {
    it('returns the signed-in user their own profile', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');

      const response = await request(server)
        .get('/api/v1/users/me')
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body.data.email).toBe('citizen@samadhaan.dev');
      expect(response.body.data.location).toHaveProperty('city');
    });

    it('requires authentication', async () => {
      await request(server).get('/api/v1/users/me').expect(401);
    });

    it('never returns the password hash', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');

      const response = await request(server)
        .get('/api/v1/users/me')
        .set('Cookie', cookies);

      expect(JSON.stringify(response.body)).not.toContain('argon2');
      expect(response.body.data).not.toHaveProperty('passwordHash');
    });
  });

  describe('GET /users/me/activity', () => {
    it('returns counts computed from the database', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');

      const response = await request(server)
        .get('/api/v1/users/me/activity')
        .set('Cookie', cookies)
        .expect(200);

      const activity = response.body.data;
      expect(activity.problemsReported).toBeTypeOf('number');
      expect(activity.problemsSupported).toBeTypeOf('number');
      // Null, not zero: the ledger does not exist, and zero would read as a
      // measured score rather than an unbuilt feature.
      expect(activity.impactPoints).toBeNull();
    });

    it('requires authentication', async () => {
      await request(server).get('/api/v1/users/me/activity').expect(401);
    });
  });

  describe('PATCH /users/me', () => {
    it('updates the permitted profile fields', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');

      const response = await request(server)
        .patch('/api/v1/users/me')
        .set('Cookie', cookies)
        .send({ bio: 'Updated bio', city: 'Gurugram', state: 'Haryana' })
        .expect(200);

      expect(response.body.data.bio).toBe('Updated bio');
      expect(response.body.data.location.city).toBe('Gurugram');
    });

    it('trims and collapses whitespace', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');

      const response = await request(server)
        .patch('/api/v1/users/me')
        .set('Cookie', cookies)
        .send({ city: '  New    Delhi  ' })
        .expect(200);

      expect(response.body.data.location.city).toBe('New Delhi');
    });

    it('clears an optional field when sent null', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');

      const response = await request(server)
        .patch('/api/v1/users/me')
        .set('Cookie', cookies)
        .send({ bio: null })
        .expect(200);

      expect(response.body.data.bio).toBeNull();

      // Restore, so the fixture stays as the seed left it.
      await request(server).patch('/api/v1/users/me').set('Cookie', cookies).send({
        bio: 'Resident of Sector 12. Interested in drainage and pedestrian safety.',
      });
    });

    // --- privilege escalation ---------------------------------------------

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

    it('rejects an attempt to change account status', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');

      await request(server)
        .patch('/api/v1/users/me')
        .set('Cookie', cookies)
        .send({ status: 'ACTIVE' })
        .expect(400);
    });

    it('rejects an attempt to change email or verification', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');

      await request(server)
        .patch('/api/v1/users/me')
        .set('Cookie', cookies)
        .send({ email: 'attacker@example.com' })
        .expect(400);

      await request(server)
        .patch('/api/v1/users/me')
        .set('Cookie', cookies)
        .send({ emailVerifiedAt: new Date().toISOString() })
        .expect(400);
    });

    it('rejects an attempt to set impact points', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');

      await request(server)
        .patch('/api/v1/users/me')
        .set('Cookie', cookies)
        .send({ impactPoints: 99_999 })
        .expect(400);
    });

    // --- validation --------------------------------------------------------

    it('rejects a bio beyond the maximum length', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');

      await request(server)
        .patch('/api/v1/users/me')
        .set('Cookie', cookies)
        .send({ bio: 'x'.repeat(501) })
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

    it('rejects a malformed postal code', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');

      await request(server)
        .patch('/api/v1/users/me')
        .set('Cookie', cookies)
        .send({ postalCode: '!!' })
        .expect(400);
    });

    it('requires authentication', async () => {
      await request(server).patch('/api/v1/users/me').send({ bio: 'x' }).expect(401);
    });
  });

  describe('GET /users/by-handle/:displayName', () => {
    it('is public and returns the profile', async () => {
      const response = await request(server)
        .get('/api/v1/users/by-handle/priya')
        .expect(200);

      expect(response.body.data.profile.fullName).toBeTruthy();
    });

    // The whole point of a second serializer.
    it('withholds every private field', async () => {
      const response = await request(server).get('/api/v1/users/by-handle/priya');
      const profile = response.body.data.profile;

      for (const field of ['email', 'phone', 'postalCode', 'status', 'lastLoginAt']) {
        expect(profile).not.toHaveProperty(field);
      }
    });

    it('returns 404 for an unknown handle', async () => {
      await request(server).get('/api/v1/users/by-handle/nobody-here').expect(404);
    });
  });

  // ================================================== organisation profile

  describe('GET /organizations/:slug', () => {
    it('is readable without a session', async () => {
      const response = await request(server)
        .get('/api/v1/organizations/clean-city-foundation')
        .expect(200);

      expect(response.body.data.name).toBe('Clean City Foundation');
      expect(response.body.data.memberCount).toBeGreaterThan(0);
      expect(response.body.data.expertise.length).toBeGreaterThan(0);
    });

    it('omits viewer permissions for a signed-out visitor', async () => {
      const response = await request(server).get(
        '/api/v1/organizations/clean-city-foundation',
      );

      expect(response.body.data.viewerPermissions).toBeUndefined();
    });

    it('grants management permissions to an owner', async () => {
      const cookies = await loginAs('ngo@samadhaan.dev');

      const response = await request(server)
        .get('/api/v1/organizations/clean-city-foundation')
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body.data.viewerPermissions).toMatchObject({
        canEdit: true,
        canManageMembers: true,
        canManageExpertise: true,
        // Verification stays an administrative capability.
        canVerify: false,
      });
    });

    it('grants nothing to a signed-in non-member', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');

      const response = await request(server)
        .get('/api/v1/organizations/clean-city-foundation')
        .set('Cookie', cookies);

      expect(response.body.data.viewerPermissions.canEdit).toBe(false);
    });

    it('publishes contact details only for a verified organisation', async () => {
      const verified = await request(server).get(
        '/api/v1/organizations/clean-city-foundation',
      );
      const unverified = await request(server).get(
        '/api/v1/organizations/meridian-infrastructure',
      );

      expect(verified.body.data.verificationStatus).toBe('VERIFIED');
      expect(verified.body.data.email).toBeTruthy();

      expect(unverified.body.data.verificationStatus).toBe('PENDING');
      expect(unverified.body.data.email).toBeNull();
      expect(unverified.body.data.phone).toBeNull();
    });

    it('returns 404 for an unknown slug', async () => {
      await request(server).get('/api/v1/organizations/no-such-organisation').expect(404);
    });
  });

  describe('PATCH /organizations/:id', () => {
    it('refuses an unauthenticated request', async () => {
      await request(server)
        .patch(`/api/v1/organizations/${cleanCityId}`)
        .send({ description: 'x' })
        .expect(401);
    });

    it('refuses a signed-in non-member', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');

      const response = await request(server)
        .patch(`/api/v1/organizations/${cleanCityId}`)
        .set('Cookie', cookies)
        .send({ description: 'hijacked' })
        .expect(403);

      expect(response.body.error.code).toBe('FORBIDDEN');
    });

    it('allows an owner', async () => {
      const cookies = await loginAs('ngo@samadhaan.dev');

      const response = await request(server)
        .patch(`/api/v1/organizations/${cleanCityId}`)
        .set('Cookie', cookies)
        .send({ description: 'Sanitation and drainage work across the northern wards.' })
        .expect(200);

      expect(response.body.data.description).toContain('Sanitation');
    });

    it('allows a platform admin on any organisation', async () => {
      const cookies = await loginAs('admin@samadhaan.dev');

      await request(server)
        .patch(`/api/v1/organizations/${cleanCityId}`)
        .set('Cookie', cookies)
        .send({ city: 'Gurugram' })
        .expect(200);
    });

    it('refuses a MEMBER — read access is not edit access', async () => {
      // The university account is a MEMBER of Clean City Foundation.
      const cookies = await loginAs('university@samadhaan.dev');

      await request(server)
        .patch(`/api/v1/organizations/${cleanCityId}`)
        .set('Cookie', cookies)
        .send({ description: 'member edit attempt' })
        .expect(403);
    });

    it('rejects self-verification and slug or type changes', async () => {
      const cookies = await loginAs('ngo@samadhaan.dev');

      const response = await request(server)
        .patch(`/api/v1/organizations/${cleanCityId}`)
        .set('Cookie', cookies)
        .send({ verificationStatus: 'VERIFIED', slug: 'premium', type: 'GOVERNMENT' })
        .expect(400);

      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('keeps the slug stable across a rename', async () => {
      const cookies = await loginAs('ngo@samadhaan.dev');

      const response = await request(server)
        .patch(`/api/v1/organizations/${cleanCityId}`)
        .set('Cookie', cookies)
        .send({ name: 'Clean City Foundation Trust' })
        .expect(200);

      // A public URL that already exists elsewhere must keep resolving.
      expect(response.body.data.slug).toBe('clean-city-foundation');

      await request(server)
        .patch(`/api/v1/organizations/${cleanCityId}`)
        .set('Cookie', cookies)
        .send({ name: 'Clean City Foundation' });
    });

    it('rejects a javascript: logo URL', async () => {
      const cookies = await loginAs('ngo@samadhaan.dev');

      await request(server)
        .patch(`/api/v1/organizations/${cleanCityId}`)
        .set('Cookie', cookies)
        .send({ logoUrl: 'javascript:alert(1)' })
        .expect(400);
    });
  });

  // ============================================================== members

  describe('GET /organizations/:id/members', () => {
    it('lists members without exposing private account data', async () => {
      const response = await request(server)
        .get(`/api/v1/organizations/${cleanCityId}/members`)
        .expect(200);

      expect(response.body.data.length).toBeGreaterThan(0);

      for (const member of response.body.data) {
        expect(member.user).not.toHaveProperty('email');
        expect(member.user).not.toHaveProperty('phone');
        expect(member.user).not.toHaveProperty('passwordHash');
      }
    });
  });

  describe('Member management', () => {
    it('refuses a non-manager', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');

      const members = await request(server).get(
        `/api/v1/organizations/${cleanCityId}/members`,
      );
      const target = members.body.data[0];

      await request(server)
        .patch(`/api/v1/organizations/${cleanCityId}/members/${target.id}`)
        .set('Cookie', cookies)
        .send({ membershipRole: 'OWNER' })
        .expect(403);
    });

    // The invariant that keeps an organisation manageable.
    it('refuses to demote the last owner', async () => {
      const cookies = await loginAs('ngo@samadhaan.dev');

      const members = await request(server).get(
        `/api/v1/organizations/${cleanCityId}/members`,
      );
      const owner = members.body.data.find(
        (m: { membershipRole: string }) => m.membershipRole === 'OWNER',
      );

      const response = await request(server)
        .patch(`/api/v1/organizations/${cleanCityId}/members/${owner.id}`)
        .set('Cookie', cookies)
        .send({ membershipRole: 'MEMBER' })
        .expect(409);

      expect(response.body.error.message).toContain('only owner');
    });

    it('refuses to remove the last owner', async () => {
      const cookies = await loginAs('ngo@samadhaan.dev');

      const members = await request(server).get(
        `/api/v1/organizations/${cleanCityId}/members`,
      );
      const owner = members.body.data.find(
        (m: { membershipRole: string }) => m.membershipRole === 'OWNER',
      );

      await request(server)
        .delete(`/api/v1/organizations/${cleanCityId}/members/${owner.id}`)
        .set('Cookie', cookies)
        .expect(409);
    });

    it('allows demoting an owner once a second owner exists', async () => {
      const cookies = await loginAs('ngo@samadhaan.dev');

      const members = await request(server).get(
        `/api/v1/organizations/${cleanCityId}/members`,
      );
      const other = members.body.data.find(
        (m: { membershipRole: string }) => m.membershipRole !== 'OWNER',
      );

      // Promote, then the original owner can be demoted.
      await request(server)
        .patch(`/api/v1/organizations/${cleanCityId}/members/${other.id}`)
        .set('Cookie', cookies)
        .send({ membershipRole: 'OWNER' })
        .expect(200);

      const owner = members.body.data.find(
        (m: { membershipRole: string }) => m.membershipRole === 'OWNER',
      );

      await request(server)
        .patch(`/api/v1/organizations/${cleanCityId}/members/${owner.id}`)
        .set('Cookie', cookies)
        .send({ membershipRole: 'ADMIN' })
        .expect(200);

      // Restore the seeded arrangement.
      await request(server)
        .patch(`/api/v1/organizations/${cleanCityId}/members/${owner.id}`)
        .set('Cookie', cookies)
        .send({ membershipRole: 'OWNER' });
      await request(server)
        .patch(`/api/v1/organizations/${cleanCityId}/members/${other.id}`)
        .set('Cookie', cookies)
        .send({ membershipRole: 'MEMBER' });
    });

    // IDOR: a manager of one organisation must not reach another's membership.
    it('refuses a membership id belonging to a different organisation', async () => {
      const cookies = await loginAs('ngo@samadhaan.dev');

      const other = await prisma.organization.findUniqueOrThrow({
        where: { slug: 'meridian-infrastructure' },
        include: { members: true },
      });
      const foreignMember = other.members[0];

      await request(server)
        .patch(`/api/v1/organizations/${cleanCityId}/members/${foreignMember!.id}`)
        .set('Cookie', cookies)
        .send({ membershipRole: 'MEMBER' })
        .expect(404);
    });
  });

  // ============================================================ expertise

  describe('Expertise', () => {
    it('is publicly readable', async () => {
      const response = await request(server)
        .get(`/api/v1/organizations/${cleanCityId}/expertise`)
        .expect(200);

      expect(response.body.data.length).toBeGreaterThan(0);
      expect(response.body.data[0]).toHaveProperty('category');
      expect(response.body.data[0]).toHaveProperty('level');
    });

    it('refuses to be added by an unauthorised user', async () => {
      const cookies = await loginAs('citizen@samadhaan.dev');

      await request(server)
        .post(`/api/v1/organizations/${cleanCityId}/expertise`)
        .set('Cookie', cookies)
        .send({ category: 'ROADS' })
        .expect(403);
    });

    it('refuses to be added by a MEMBER', async () => {
      const cookies = await loginAs('university@samadhaan.dev');

      await request(server)
        .post(`/api/v1/organizations/${cleanCityId}/expertise`)
        .set('Cookie', cookies)
        .send({ category: 'ROADS' })
        .expect(403);
    });

    it('can be added by an owner', async () => {
      const cookies = await loginAs('ngo@samadhaan.dev');

      const response = await request(server)
        .post(`/api/v1/organizations/${cleanCityId}/expertise`)
        .set('Cookie', cookies)
        .send({ category: 'POLLUTION', subcategory: 'Air quality', level: 'INTERESTED' })
        .expect(201);

      expect(response.body.data.category).toBe('POLLUTION');
      expect(response.body.data.level).toBe('INTERESTED');
    });

    // Re-declaring a category is an update, which is what pressing "add" means.
    it('updates rather than duplicates when a category is re-declared', async () => {
      const cookies = await loginAs('ngo@samadhaan.dev');

      await request(server)
        .post(`/api/v1/organizations/${cleanCityId}/expertise`)
        .set('Cookie', cookies)
        .send({ category: 'POLLUTION', level: 'SPECIALIST' })
        .expect(201);

      const entries = await prisma.organizationExpertise.count({
        where: { organizationId: cleanCityId, category: 'POLLUTION' },
      });
      expect(entries).toBe(1);
    });

    it('rejects a category outside the problem taxonomy', async () => {
      const cookies = await loginAs('ngo@samadhaan.dev');

      await request(server)
        .post(`/api/v1/organizations/${cleanCityId}/expertise`)
        .set('Cookie', cookies)
        .send({ category: 'INVENTED_CATEGORY' })
        .expect(400);
    });

    it('refuses deletion by an unauthorised user', async () => {
      const citizenCookies = await loginAs('citizen@samadhaan.dev');

      const entry = await prisma.organizationExpertise.findFirstOrThrow({
        where: { organizationId: cleanCityId },
      });

      await request(server)
        .delete(`/api/v1/organizations/${cleanCityId}/expertise/${entry.id}`)
        .set('Cookie', citizenCookies)
        .expect(403);
    });

    it('allows deletion by an owner', async () => {
      const cookies = await loginAs('ngo@samadhaan.dev');

      const entry = await prisma.organizationExpertise.findFirstOrThrow({
        where: { organizationId: cleanCityId, category: 'POLLUTION' },
      });

      await request(server)
        .delete(`/api/v1/organizations/${cleanCityId}/expertise/${entry.id}`)
        .set('Cookie', cookies)
        .expect(204);
    });

    it('refuses an expertise id belonging to a different organisation', async () => {
      const cookies = await loginAs('ngo@samadhaan.dev');

      const other = await prisma.organizationExpertise.findFirstOrThrow({
        where: { organization: { slug: 'meridian-infrastructure' } },
      });

      await request(server)
        .delete(`/api/v1/organizations/${cleanCityId}/expertise/${other.id}`)
        .set('Cookie', cookies)
        .expect(404);
    });
  });
});
