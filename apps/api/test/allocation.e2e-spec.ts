import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AiService } from '../src/ai/ai.service.js';
import { configureApp, registerNotFoundHandler } from '../src/bootstrap.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { DomainEventBus } from '../src/events/domain-event-bus.js';
import { RedisService } from '../src/redis/redis.service.js';
import { deleteAuditLogs } from './audit-maintenance.js';

/**
 * Government allocation (Prompt 16) end to end, against real PostgreSQL.
 *
 *   e2e-alloc-pune        government office, boundary around Pune   government@ (OWNER)
 *   e2e-alloc-nagpur      government office, boundary around Nagpur e2e-alloc-gov2@ (OWNER)
 *   e2e-alloc-ngo         NGO, VERIFIED        owner@ / admin@ / member@
 *   e2e-alloc-uni         UNIVERSITY, VERIFIED uni@ (OWNER)
 *   e2e-alloc-other       NGO, VERIFIED        other@ (OWNER) — unrelated organisation
 *   e2e-alloc-pending / -suspended / -rejected   ineligible targets
 */
describe('Government allocation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let bus: DomainEventBus;
  let server: Parameters<typeof request>[0];

  const PASSWORD = 'DevPassword123!';
  const PREFIX = 'e2e-alloc-';
  const TITLE = 'Alloc probe ';
  const EMAIL = (key: string) => `${PREFIX}${key}@samadhaan.test`;

  const PUNE: [number, number, number, number] = [73.7, 18.4, 74.0, 18.65];
  const NAGPUR: [number, number, number, number] = [78.95, 21.05, 79.2, 21.25];

  const orgs: Record<string, string> = {};
  const users: Record<string, string> = {};
  const problems: Record<string, { id: string; publicId: string }> = {};
  const cookies: Record<string, string[]> = {};
  let officialId: string;
  let reporterId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AiService)
      .useValue({
        analyzeProblem: async () => ({
          ok: false as const,
          failure: { code: 'PROVIDER_UNAVAILABLE', message: 'n/a', retryable: false },
        }),
        embedText: async () => ({
          ok: false as const,
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
    bus = app.get(DomainEventBus);
    server = app.getHttpServer();

    await cleanUp();

    const government = await prisma.user.findUniqueOrThrow({
      where: { email: 'government@samadhaan.dev' },
    });
    officialId = government.id;
    reporterId = (
      await prisma.user.findUniqueOrThrow({ where: { email: 'citizen@samadhaan.dev' } })
    ).id;

    const user = async (key: string, role: 'NGO' | 'UNIVERSITY' | 'GOVERNMENT') => {
      users[key] = (
        await prisma.user.create({
          data: {
            email: EMAIL(key),
            passwordHash: government.passwordHash,
            fullName: `Alloc ${key}`,
            role,
            status: 'ACTIVE',
          },
        })
      ).id;
    };
    await user('gov2', 'GOVERNMENT');
    await user('owner', 'NGO');
    await user('admin', 'NGO');
    await user('member', 'NGO');
    await user('uni', 'UNIVERSITY');
    await user('other', 'NGO');

    const org = async (
      key: string,
      data: {
        type: 'GOVERNMENT' | 'NGO' | 'UNIVERSITY';
        verificationStatus?: 'VERIFIED' | 'PENDING' | 'SUSPENDED' | 'REJECTED';
        bbox?: [number, number, number, number];
        members?: Array<[string, 'OWNER' | 'ADMIN' | 'MEMBER']>;
      },
    ) => {
      const created = await prisma.organization.create({
        data: {
          name: `E2E Alloc ${key}`,
          slug: `${PREFIX}${key}`,
          type: data.type,
          verificationStatus: data.verificationStatus ?? 'VERIFIED',
          city: 'Pune',
          ...(data.type === 'GOVERNMENT'
            ? { jurisdictionType: 'MUNICIPAL_CORPORATION', jurisdictionName: key }
            : {}),
        },
      });
      orgs[key] = created.id;
      if (data.bbox) {
        const [west, south, east, north] = data.bbox;
        await prisma.$executeRaw`
          UPDATE organizations
          SET "jurisdictionBoundary" = ST_Multi(ST_MakeEnvelope(${west}, ${south}, ${east}, ${north}, 4326))::geography
          WHERE id = ${created.id}::uuid`;
      }
      for (const [userId, role] of data.members ?? []) {
        await prisma.organizationMember.create({
          data: {
            organizationId: created.id,
            userId,
            membershipRole: role,
            status: 'ACTIVE',
            joinedAt: new Date(),
          },
        });
      }
    };

    await org('pune', {
      type: 'GOVERNMENT',
      bbox: PUNE,
      members: [[government.id, 'OWNER']],
    });
    await org('nagpur', {
      type: 'GOVERNMENT',
      bbox: NAGPUR,
      members: [[users.gov2!, 'OWNER']],
    });
    await org('ngo', {
      type: 'NGO',
      members: [
        [users.owner!, 'OWNER'],
        [users.admin!, 'ADMIN'],
        [users.member!, 'MEMBER'],
      ],
    });
    await org('uni', { type: 'UNIVERSITY', members: [[users.uni!, 'OWNER']] });
    await org('other', { type: 'NGO', members: [[users.other!, 'OWNER']] });
    await org('pending', { type: 'NGO', verificationStatus: 'PENDING' });
    await org('suspended', { type: 'NGO', verificationStatus: 'SUSPENDED' });
    await org('rejected', { type: 'NGO', verificationStatus: 'REJECTED' });

    const problem = async (
      key: string,
      status: string,
      at: [number, number] = [18.53, 73.85],
    ) => {
      const created = await prisma.problem.create({
        data: {
          reporterId,
          title: `${TITLE}${key}`,
          description: `${key} — created by the allocation e2e suite.`,
          category: 'POTHOLES',
          severity: 'HIGH',
          status: status as never,
          latitude: at[0],
          longitude: at[1],
          address: `${key} Lane, Shivaji Nagar`,
          city: at[0] > 20 ? 'Nagpur' : 'Pune',
          state: 'Maharashtra',
        },
      });
      problems[key] = { id: created.id, publicId: created.publicId };
    };
    for (const key of ['life', 'cancel', 'race1', 'race2', 'race3', 'db', 'metric']) {
      await problem(key, 'VERIFIED');
    }
    await problem('review', 'UNDER_REVIEW');
    await problem('nagpur', 'VERIFIED', [21.15, 79.09]);

    await clearRateLimits();
    cookies.official = await loginAs('government@samadhaan.dev');
    cookies.gov2 = await loginAs(EMAIL('gov2'));
    cookies.citizen = await loginAs('citizen@samadhaan.dev');
    cookies.admin = await loginAs('admin@samadhaan.dev');
    for (const key of ['owner', 'admin', 'member', 'uni', 'other']) {
      cookies[`org-${key}`] = await loginAs(EMAIL(key));
    }
  });

  beforeEach(clearRateLimits);

  afterAll(async () => {
    if (prisma) await cleanUp();
    await app?.close();
  });

  async function cleanUp(): Promise<void> {
    const stale = await prisma.problem.findMany({
      where: { title: { startsWith: TITLE } },
      select: { id: true },
    });
    const ids = stale.map((row) => row.id);
    const allocations = await prisma.problemAllocation.findMany({
      where: { problemId: { in: ids } },
      select: { id: true },
    });
    await prisma.notification.deleteMany({
      where: { entityId: { in: [...ids, ...allocations.map((row) => row.id)] } },
    });
    const rooms = await prisma.resolutionRoom.findMany({
      where: { problemId: { in: ids } },
      select: { id: true },
    });
    await deleteAuditLogs(prisma, {
      entityType: 'ResolutionRoom',
      entityId: { in: rooms.map((room) => room.id) },
    });
    await prisma.resolutionRoom.deleteMany({ where: { problemId: { in: ids } } });
    await prisma.problemAllocation.deleteMany({ where: { problemId: { in: ids } } });
    await deleteAuditLogs(prisma, { entityType: 'Problem', entityId: { in: ids } });
    await prisma.problem.deleteMany({ where: { id: { in: ids } } });
    await prisma.organization.deleteMany({ where: { slug: { startsWith: PREFIX } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
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

  const allocate = (
    key: string,
    body: Record<string, unknown>,
    as: string[] = cookies.official!,
    office = 'pune',
  ) =>
    request(server)
      .post(
        `/api/v1/government/${PREFIX}${office}/problems/${problems[key]!.publicId}/allocations`,
      )
      .set('Cookie', as)
      .send(body);

  const cancel = (
    id: string,
    body: Record<string, unknown> = {},
    as = cookies.official!,
    office = 'pune',
  ) =>
    request(server)
      .post(`/api/v1/government/${PREFIX}${office}/allocations/${id}/cancel`)
      .set('Cookie', as)
      .send(body);

  const panel = (key: string, as = cookies.official!) =>
    request(server)
      .get(
        `/api/v1/government/${PREFIX}pune/problems/${problems[key]!.publicId}/allocations`,
      )
      .set('Cookie', as);

  const respond = (
    id: string,
    action: 'accept' | 'decline',
    body: Record<string, unknown>,
    as: string,
    org = 'ngo',
  ) =>
    request(server)
      .post(`/api/v1/organizations/${PREFIX}${org}/allocations/${id}/${action}`)
      .set('Cookie', cookies[as]!)
      .send(body);

  const orgGet = (path: string, as: string, org = 'ngo') =>
    request(server)
      .get(`/api/v1/organizations/${PREFIX}${org}${path}`)
      .set('Cookie', cookies[as]!);

  const problemStatus = async (key: string) =>
    (await prisma.problem.findUniqueOrThrow({ where: { id: problems[key]!.id } })).status;

  // ------------------------------------------------------------ authorisation

  describe('who may allocate', () => {
    it.each([
      ['a citizen', 'citizen'],
      ['an organisation member', 'org-owner'],
      ['a platform administrator', 'admin'],
    ])('refuses %s', async (_label, who) => {
      await allocate('life', { organizationId: orgs.ngo }, cookies[who]!).expect(403);
    });

    it('answers 404 for a problem outside the office’s jurisdiction', async () => {
      await allocate('nagpur', { organizationId: orgs.ngo }).expect(404);
    });

    it('answers 404 to an official of another office using this office’s slug', async () => {
      await allocate('life', { organizationId: orgs.ngo }, cookies.gov2!).expect(404);
    });

    it('refuses client-supplied office, official or status fields', async () => {
      for (const extra of [
        { governmentOrganizationId: orgs.nagpur },
        { allocatedByUserId: users.gov2 },
        { status: 'ACCEPTED' },
      ]) {
        await allocate('life', { organizationId: orgs.ngo, ...extra }).expect(400);
      }
      expect(
        await prisma.problemAllocation.count({ where: { problemId: problems.life!.id } }),
      ).toBe(0);
    });
  });

  // ------------------------------------------------------------- eligibility

  describe('what may be allocated, to whom', () => {
    it('refuses a problem that is not verified', async () => {
      const response = await allocate('review', { organizationId: orgs.ngo }).expect(409);
      expect(response.body.error.message).toMatch(/Only a verified problem/);
    });

    it.each(['pending', 'suspended', 'rejected', 'nagpur'])(
      'refuses an ineligible organisation (%s)',
      async (key) => {
        await allocate('life', { organizationId: orgs[key] }).expect(400);
      },
    );

    it('refuses an unknown or malformed organisation id', async () => {
      await allocate('life', {
        organizationId: '00000000-0000-4000-8000-000000000000',
      }).expect(400);
      await allocate('life', { organizationId: 'not-a-uuid' }).expect(400);
    });
  });

  // ---------------------------------------------------------------- lifecycle

  describe('allocate → decline → reallocate → accept', () => {
    let firstId: string;
    let secondId: string;

    it('creates a pending allocation chosen by the official', async () => {
      const response = await allocate('life', {
        organizationId: orgs.ngo,
        instructions: 'Coordinate with the ward engineer.',
        internalReason: 'SECRET-INTERNAL closest capable team.',
      }).expect(201);

      firstId = response.body.data.id;
      expect(response.body.data).toMatchObject({
        status: 'PENDING',
        organization: { slug: `${PREFIX}ngo` },
        instructions: 'Coordinate with the ward engineer.',
        internalReason: 'SECRET-INTERNAL closest capable team.',
        ownedByThisOffice: true,
      });
      expect(await problemStatus('life')).toBe('VERIFIED');

      const row = await prisma.problemAllocation.findUniqueOrThrow({
        where: { id: firstId },
      });
      expect(row.governmentOrganizationId).toBe(orgs.pune);
      expect(row.allocatedById).toBe(officialId);
    });

    it('refuses a second active allocation for the same problem', async () => {
      await allocate('life', { organizationId: orgs.uni }).expect(409);
    });

    it('notifies the organisation’s owners and admins only', async () => {
      await bus.drain();
      const recipients = await prisma.notification.findMany({
        where: { entityId: firstId, type: 'ALLOCATION_REQUESTED' },
        select: { recipientId: true, title: true, metadata: true },
      });
      expect(recipients.map((row) => row.recipientId).sort()).toEqual(
        [users.owner!, users.admin!].sort(),
      );
      expect(recipients[0]!.title).toBe('New allocation request');
      expect(recipients[0]!.metadata).toMatchObject({
        allocationId: firstId,
        organizationSlug: `${PREFIX}ngo`,
      });

      // The link is derived on read, from validated metadata.
      const inbox = await request(server)
        .get('/api/v1/notifications')
        .set('Cookie', cookies['org-owner']!)
        .expect(200);
      const item = inbox.body.data.items.find(
        (entry: { type: string }) => entry.type === 'ALLOCATION_REQUESTED',
      );
      expect(item).toMatchObject({
        href: `/organization/${PREFIX}ngo/allocations/${firstId}`,
      });
    });

    it('writes an audit entry', async () => {
      const entry = await prisma.auditLog.findFirstOrThrow({
        where: { entityId: problems.life!.id, action: 'ALLOCATION_CREATED' },
      });
      expect(entry.actorUserId).toBe(officialId);
      expect(entry.metadata).toMatchObject({ allocationId: firstId, to: 'PENDING' });
    });

    it('shows members the request without the internal reason', async () => {
      const list = await orgGet('/allocations?view=pending', 'org-member').expect(200);
      expect(list.body.data.items.map((item: { id: string }) => item.id)).toContain(
        firstId,
      );

      const detail = await orgGet(`/allocations/${firstId}`, 'org-member').expect(200);
      expect(detail.body.data).toMatchObject({
        instructions: 'Coordinate with the ward engineer.',
        canRespond: false,
      });
      expect(detail.body.data).not.toHaveProperty('internalReason');
      expect(JSON.stringify(detail.body)).not.toContain('SECRET-INTERNAL');

      const admin = await orgGet(`/allocations/${firstId}`, 'org-admin').expect(200);
      expect(admin.body.data.canRespond).toBe(true);
    });

    it('lets only owners and admins respond', async () => {
      await respond(firstId, 'accept', {}, 'org-member').expect(403);
      await respond(firstId, 'decline', { reason: 'No.' }, 'org-member').expect(403);
    });

    it('hides the allocation from an unrelated organisation', async () => {
      await orgGet(`/allocations/${firstId}`, 'org-other', 'other').expect(404);
      await respond(firstId, 'accept', {}, 'org-other', 'other').expect(404);
    });

    it('requires a reason to decline', async () => {
      await respond(firstId, 'decline', {}, 'org-admin').expect(400);
      await respond(firstId, 'decline', { reason: '  ' }, 'org-admin').expect(400);
    });

    it('declines, leaving the problem verified', async () => {
      const response = await respond(
        firstId,
        'decline',
        { reason: 'DECLINE-REASON outside our capacity' },
        'org-admin',
      ).expect(200);
      expect(response.body.data.status).toBe('DECLINED');
      expect(await problemStatus('life')).toBe('VERIFIED');

      await bus.drain();
      const notified = await prisma.notification.findMany({
        where: { entityId: firstId, type: 'ALLOCATION_DECLINED' },
        select: { recipientId: true },
      });
      expect(notified.map((row) => row.recipientId)).toEqual([officialId]);
    });

    it('refuses a second response', async () => {
      const response = await respond(firstId, 'accept', {}, 'org-owner').expect(409);
      expect(response.body.error.message).toBe(
        'This allocation was already responded to by another authorized user.',
      );
    });

    it('shows the office the decline and allows reallocation', async () => {
      const response = await panel('life').expect(200);
      expect(response.body.data).toMatchObject({
        canAllocate: true,
        blockedReason: null,
        active: null,
      });
      expect(response.body.data.history[0]).toMatchObject({
        status: 'DECLINED',
        declineReason: 'DECLINE-REASON outside our capacity',
      });
    });

    it('does not show the decline reason to another office', async () => {
      // The Nagpur office cannot see a Pune problem at all.
      await request(server)
        .get(
          `/api/v1/government/${PREFIX}nagpur/problems/${problems.life!.publicId}/allocations`,
        )
        .set('Cookie', cookies.gov2!)
        .expect(404);
    });

    it('reallocates to another organisation, keeping the history', async () => {
      const response = await allocate('life', { organizationId: orgs.uni }).expect(201);
      secondId = response.body.data.id;
      const history = (await panel('life').expect(200)).body.data.history;
      expect(history.map((entry: { status: string }) => entry.status)).toEqual([
        'PENDING',
        'DECLINED',
      ]);
    });

    it('marks an organisation that declined before', async () => {
      const response = await request(server)
        .get(
          `/api/v1/government/${PREFIX}pune/problems/${problems.life!.publicId}/allocation-candidates?q=E2E Alloc`,
        )
        .set('Cookie', cookies.official!)
        .expect(200);
      const byName = Object.fromEntries(
        response.body.data.map((c: { organization: { slug: string } }) => [
          c.organization.slug,
          c,
        ]),
      );
      expect(byName[`${PREFIX}ngo`]).toMatchObject({
        eligible: true,
        previouslyDeclined: true,
      });
      expect(byName[`${PREFIX}suspended`]).toMatchObject({
        eligible: false,
        ineligibleReason: 'SUSPENDED',
      });
      // Government offices are never candidates.
      expect(byName[`${PREFIX}pune`]).toBeUndefined();
    });

    it('accepts, moving the problem to IN_PROGRESS in the same transaction', async () => {
      const response = await respond(
        secondId,
        'accept',
        { note: 'On it.' },
        'org-uni',
        'uni',
      ).expect(200);
      expect(response.body.data).toMatchObject({
        status: 'ACCEPTED',
        responseNote: 'On it.',
        problem: { status: 'IN_PROGRESS' },
      });
      expect(await problemStatus('life')).toBe('IN_PROGRESS');

      const actions = await prisma.auditLog.findMany({
        where: { entityId: problems.life!.id },
        orderBy: { createdAt: 'asc' },
        select: { action: true, metadata: true },
      });
      expect(actions.map((row) => row.action)).toEqual([
        'ALLOCATION_CREATED',
        'ALLOCATION_DECLINED',
        'ALLOCATION_CREATED',
        'ALLOCATION_ACCEPTED',
        'PROBLEM_STATUS_CHANGED',
      ]);
      expect(actions.at(-1)!.metadata).toMatchObject({
        from: 'VERIFIED',
        to: 'IN_PROGRESS',
        viaAllocation: true,
      });
    });

    it('notifies the office and the reporter, never the actor', async () => {
      await bus.drain();
      const accepted = await prisma.notification.findMany({
        where: { entityId: secondId, type: 'ALLOCATION_ACCEPTED' },
        select: { recipientId: true },
      });
      expect(accepted.map((row) => row.recipientId)).toEqual([officialId]);
      expect(
        await prisma.notification.count({
          where: {
            recipientId: reporterId,
            entityId: problems.life!.id,
            type: 'PROBLEM_STATUS_CHANGED',
          },
        }),
      ).toBe(1);
      expect(
        await prisma.notification.count({
          where: {
            recipientId: users.uni!,
            type: { in: ['ALLOCATION_ACCEPTED', 'PROBLEM_STATUS_CHANGED'] },
            entityId: { in: [secondId, problems.life!.id] },
          },
        }),
      ).toBe(0);
    });

    it('shows the public who is assigned, and nothing private', async () => {
      const response = await request(server)
        .get(`/api/v1/problems/${problems.life!.publicId}`)
        .expect(200);
      expect(response.body.data.status).toBe('IN_PROGRESS');
      expect(response.body.data.assignment).toMatchObject({
        organization: { slug: `${PREFIX}uni`, name: 'E2E Alloc uni', type: 'UNIVERSITY' },
      });
      const body = JSON.stringify(response.body);
      for (const secret of [
        'SECRET-INTERNAL',
        'DECLINE-REASON',
        'On it.',
        'ward engineer',
      ]) {
        expect(body).not.toContain(secret);
      }
    });

    it('cannot be cancelled once accepted', async () => {
      await cancel(secondId).expect(409);
    });

    it('lists the government activity with the organisation named', async () => {
      const audit = await request(server)
        .get(`/api/v1/government/${PREFIX}pune/problems/${problems.life!.publicId}`)
        .set('Cookie', cookies.official!)
        .expect(200);
      const kinds = audit.body.data.audit.map((entry: { kind: string }) => entry.kind);
      expect(kinds).toEqual(
        expect.arrayContaining(['ALLOCATION_CREATED', 'ALLOCATION_ACCEPTED']),
      );
      const accepted = audit.body.data.audit.find(
        (entry: { kind: string }) => entry.kind === 'ALLOCATION_ACCEPTED',
      );
      expect(accepted).toMatchObject({
        organizationName: 'E2E Alloc uni',
        actor: { kind: 'ORGANIZATION', name: 'E2E Alloc uni' },
      });
      expect(audit.body.data.allocation).toMatchObject({
        canAllocate: false,
        blockedReason: 'NOT_VERIFIED',
        active: { id: secondId, status: 'ACCEPTED' },
      });
    });
  });

  // ------------------------------------------------------------------ cancel

  describe('cancellation', () => {
    let id: string;

    it('lets the allocating office withdraw a pending allocation', async () => {
      id = (await allocate('cancel', { organizationId: orgs.ngo }).expect(201)).body.data
        .id;
      await cancel(id, {}, cookies.gov2!, 'nagpur').expect(404);

      const response = await cancel(id, {
        reason: 'Reassigning to the ward team.',
      }).expect(200);
      expect(response.body.data).toMatchObject({
        status: 'CANCELLED',
        cancellationReason: 'Reassigning to the ward team.',
      });
      expect(await problemStatus('cancel')).toBe('VERIFIED');
    });

    it('tells the organisation, and it can no longer respond', async () => {
      await bus.drain();
      expect(
        await prisma.notification.count({
          where: { entityId: id, type: 'ALLOCATION_CANCELLED' },
        }),
      ).toBe(2);
      const response = await respond(id, 'accept', {}, 'org-owner').expect(409);
      expect(response.body.error.message).toBe(
        'This allocation was withdrawn by the government office.',
      );
      await cancel(id).expect(409);
    });

    it('frees the problem for a new allocation', async () => {
      await allocate('cancel', { organizationId: orgs.uni }).expect(201);
    });
  });

  // ------------------------------------------------------------- concurrency

  describe('races', () => {
    it('lets only one of two simultaneous allocations through', async () => {
      const responses = await Promise.all([
        allocate('race1', { organizationId: orgs.ngo }),
        allocate('race1', { organizationId: orgs.uni }),
      ]);
      expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(
        await prisma.problemAllocation.count({
          where: {
            problemId: problems.race1!.id,
            status: { in: ['PENDING', 'ACCEPTED'] },
          },
        }),
      ).toBe(1);
    });

    it('resolves accept vs cancel to exactly one outcome', async () => {
      const id = (await allocate('race2', { organizationId: orgs.ngo }).expect(201)).body
        .data.id;
      const [accepted, cancelled] = await Promise.all([
        respond(id, 'accept', {}, 'org-owner'),
        cancel(id),
      ]);
      expect([accepted.status, cancelled.status].sort()).toEqual([200, 409]);

      const row = await prisma.problemAllocation.findUniqueOrThrow({ where: { id } });
      expect(await problemStatus('race2')).toBe(
        row.status === 'ACCEPTED' ? 'IN_PROGRESS' : 'VERIFIED',
      );
    });

    it('resolves accept vs decline to exactly one outcome', async () => {
      const id = (await allocate('race3', { organizationId: orgs.ngo }).expect(201)).body
        .data.id;
      const [accepted, declined] = await Promise.all([
        respond(id, 'accept', {}, 'org-owner'),
        respond(id, 'decline', { reason: 'Out of capacity.' }, 'org-admin'),
      ]);
      expect([accepted.status, declined.status].sort()).toEqual([200, 409]);
      const loser = accepted.status === 409 ? accepted : declined;
      expect(loser.body.error.message).toBe(
        'This allocation was already responded to by another authorized user.',
      );

      const row = await prisma.problemAllocation.findUniqueOrThrow({ where: { id } });
      expect(await problemStatus('race3')).toBe(
        row.status === 'ACCEPTED' ? 'IN_PROGRESS' : 'VERIFIED',
      );
    });
  });

  // ----------------------------------------------------------------- metrics

  describe('dashboards', () => {
    it('counts the organisation’s pending allocations and active assignments', async () => {
      const response = await orgGet('/dashboard', 'org-owner').expect(200);
      const pending = await prisma.problemAllocation.count({
        where: { organizationId: orgs.ngo, status: 'PENDING' },
      });
      const active = await prisma.problemAllocation.count({
        where: {
          organizationId: orgs.ngo,
          status: 'ACCEPTED',
          problem: { status: 'IN_PROGRESS' },
        },
      });
      expect(response.body.data.metrics).toMatchObject({
        pendingAllocations: pending,
        activeAssignments: active,
      });
    });

    it('counts the office’s allocations by status', async () => {
      const response = await request(server)
        .get(`/api/v1/government/${PREFIX}pune/dashboard?range=7`)
        .set('Cookie', cookies.official!)
        .expect(200);
      const count = (status: 'PENDING' | 'ACCEPTED' | 'DECLINED') =>
        prisma.problemAllocation.count({
          where: { governmentOrganizationId: orgs.pune, status },
        });
      expect(response.body.data.metrics).toMatchObject({
        pendingAllocations: await count('PENDING'),
        acceptedAllocations: await count('ACCEPTED'),
        declinedAllocations: await count('DECLINED'),
      });
      expect(response.body.data.metrics.declinedAllocations).toBeGreaterThanOrEqual(1);
    });
  });

  // -------------------------------------------------------------- database

  describe('database guarantees', () => {
    const base = () => ({
      problemId: problems.db!.id,
      organizationId: orgs.ngo!,
      governmentOrganizationId: orgs.pune!,
      allocatedById: officialId,
    });

    it('allows only one active allocation per problem, whatever the code does', async () => {
      await prisma.problemAllocation.create({ data: base() });
      await expect(
        prisma.problemAllocation.create({ data: base() }),
      ).rejects.toMatchObject({
        code: 'P2002',
      });
      // A closed allocation does not occupy the problem.
      await prisma.problemAllocation.updateMany({
        where: { problemId: problems.db!.id },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });
      await prisma.problemAllocation.create({ data: base() });
    });

    it('refuses timestamps that disagree with the status', async () => {
      await expect(
        prisma.problemAllocation.create({
          data: { ...base(), problemId: problems.metric!.id, status: 'ACCEPTED' },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.problemAllocation.create({
          data: {
            ...base(),
            problemId: problems.metric!.id,
            status: 'DECLINED',
            respondedAt: new Date(),
            declinedAt: new Date(),
          },
        }),
      ).rejects.toThrow();
    });

    it('will not delete a problem that has allocations', async () => {
      await expect(
        prisma.problem.delete({ where: { id: problems.db!.id } }),
      ).rejects.toThrow();
    });
  });
});
