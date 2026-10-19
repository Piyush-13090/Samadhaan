import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp, registerNotFoundHandler } from '../src/bootstrap.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { DomainEventBus } from '../src/events/domain-event-bus.js';
import { RedisService } from '../src/redis/redis.service.js';
import { deleteAuditLogs } from './audit-maintenance.js';

/**
 * Resolution-room lifecycle and recovery (Prompt 30 follow-up).
 *
 * The defect: closing a resolution room while its problem was IN_PROGRESS
 * made the project read-only, so no evidence or verification was possible,
 * while the ACCEPTED allocation blocked reallocation — the problem was stuck.
 * An organisation cancelling its project produced the same dead end.
 *
 * The rule now: a room closes only when its work is over (the problem is in a
 * final status, or the allocation was withdrawn). Ending accepted work early is
 * an explicit government withdrawal that cancels the allocation, cancels an
 * unfinished project, closes the room and returns the problem to VERIFIED for
 * reallocation — never RESOLVED. The same withdrawal recovers problems already
 * stuck. Every state change below goes through the API; Prisma only creates
 * identities and the legacy stuck states that the old rules allowed.
 */
describe('Resolution room lifecycle and recovery (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let bus: DomainEventBus;
  let server: Parameters<typeof request>[0];

  const PASSWORD = 'DevPassword123!';
  const run = Date.now().toString(36);
  const P = `e2e-life-${run}-`;
  const users: Record<string, string> = {};
  const cookies: Record<string, string[]> = {};
  const orgs: Record<string, string> = {};
  const problemIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    registerNotFoundHandler(app);
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    bus = app.get(DomainEventBus);
    const redis = app.get(RedisService);

    const template = await prisma.user.findUniqueOrThrow({
      where: { email: 'government@samadhaan.dev' },
    });
    for (const [key, role] of [
      ['reporter', 'CITIZEN'],
      ['official', 'GOVERNMENT'],
      ['otherOfficial', 'GOVERNMENT'],
      ['ownerA', 'NGO'],
      ['ownerB', 'NGO'],
    ] as const) {
      users[key] = (
        await prisma.user.create({
          data: {
            email: `${P}${key.toLowerCase()}@samadhaan.test`,
            passwordHash: template.passwordHash,
            fullName: `Lifecycle ${key}`,
            role,
            status: 'ACTIVE',
          },
        })
      ).id;
    }
    for (const [key, type, city] of [
      ['office', 'GOVERNMENT', 'Pune'],
      ['elsewhere', 'GOVERNMENT', 'Nagpur'],
      ['ngoa', 'NGO', 'Pune'],
      ['ngob', 'NGO', 'Pune'],
    ] as const) {
      orgs[key] = (
        await prisma.organization.create({
          data: {
            name: `E2E Lifecycle ${key} ${run}`,
            slug: `${P}${key}`,
            type,
            verificationStatus: 'VERIFIED',
            city,
            ...(type === 'GOVERNMENT'
              ? {
                  jurisdictionType: 'MUNICIPAL_CORPORATION',
                  jurisdictionName: `${key} ${run}`,
                  jurisdictionCities: [city],
                }
              : {}),
          },
        })
      ).id;
    }
    await prisma.organizationMember.createMany({
      data: [
        ['office', 'official'],
        ['elsewhere', 'otherOfficial'],
        ['ngoa', 'ownerA'],
        ['ngob', 'ownerB'],
      ].map(([org, user]) => ({
        organizationId: orgs[org!]!,
        userId: users[user!]!,
        membershipRole: 'OWNER' as const,
        status: 'ACTIVE' as const,
      })),
    });

    const limits = await redis.connection.keys('ratelimit:*');
    if (limits.length) await redis.connection.del(...limits);
    for (const key of Object.keys(users)) {
      const login = await request(server)
        .post('/api/v1/auth/login')
        .send({ email: `${P}${key.toLowerCase()}@samadhaan.test`, password: PASSWORD })
        .expect(200);
      const header = login.headers['set-cookie'];
      cookies[key] = Array.isArray(header) ? header : header ? [header] : [];
    }
  });

  afterAll(async () => {
    if (prisma) {
      const rooms = await prisma.resolutionRoom.findMany({
        where: { problemId: { in: problemIds } },
        select: { id: true },
      });
      const roomIds = rooms.map((r) => r.id);
      await prisma.resolutionVerificationRequest.deleteMany({
        where: { problemId: { in: problemIds } },
      });
      await prisma.resolutionProject.deleteMany({ where: { roomId: { in: roomIds } } });
      await prisma.resolutionRoomEvent.deleteMany({ where: { roomId: { in: roomIds } } });
      await prisma.resolutionMessage.deleteMany({ where: { roomId: { in: roomIds } } });
      await prisma.resolutionRoomRead.deleteMany({ where: { roomId: { in: roomIds } } });
      await prisma.resolutionRoom.deleteMany({ where: { id: { in: roomIds } } });
      await prisma.problemAllocation.deleteMany({
        where: { problemId: { in: problemIds } },
      });
      const ids = Object.values(users);
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('samadhaan.audit_maintenance', 'on', true)`;
        await tx.impactPointTransaction.deleteMany({ where: { userId: { in: ids } } });
      });
      await prisma.userImpactStats.deleteMany({ where: { userId: { in: ids } } });
      await prisma.userBadge.deleteMany({ where: { userId: { in: ids } } });
      await prisma.problemFollow.deleteMany({ where: { problemId: { in: problemIds } } });
      await prisma.problem.deleteMany({ where: { id: { in: problemIds } } });
      await deleteAuditLogs(prisma, {
        OR: [
          { actorUserId: { in: ids } },
          { entityId: { in: [...problemIds, ...roomIds, ...Object.values(orgs)] } },
        ],
      });
      await prisma.notification.deleteMany({ where: { recipientId: { in: ids } } });
      await prisma.organizationMember.deleteMany({
        where: { organizationId: { in: Object.values(orgs) } },
      });
      await prisma.organization.deleteMany({
        where: { id: { in: Object.values(orgs) } },
      });
      await prisma.session.deleteMany({ where: { userId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
    await app?.close();
  });

  const api = (who: string) => ({
    get: (path: string) =>
      request(server).get(`/api/v1${path}`).set('Cookie', cookies[who]!),
    post: (path: string, body: object = {}) =>
      request(server).post(`/api/v1${path}`).set('Cookie', cookies[who]!).send(body),
  });
  const gov = (path: string, office = 'office') => `/government/${P}${office}${path}`;
  const REASON = 'Organisation stopped responding; reassigning.';

  async function verifiedProblem(label: string) {
    const row = await prisma.problem.create({
      data: {
        reporterId: users.reporter!,
        title: `Lifecycle ${label} ${run}`,
        description:
          'Drain blocked outside the market; created by the lifecycle e2e suite.',
        category: 'DRAINAGE',
        status: 'VERIFIED',
        latitude: 18.52,
        longitude: 73.85,
        city: 'Pune',
        state: 'Maharashtra',
      },
    });
    problemIds.push(row.id);
    return row;
  }

  /** Allocate through the API and accept through the API; returns ids. */
  async function allocateAndAccept(publicId: string, org: 'ngoa' | 'ngob') {
    const created = await api('official')
      .post(gov(`/problems/${publicId}/allocations`), {
        organizationId: orgs[org],
        instructions: 'Clear the drain within the week.',
      })
      .expect(201);
    const owner = org === 'ngoa' ? 'ownerA' : 'ownerB';
    const accepted = await api(owner)
      .post(`/organizations/${P}${org}/allocations/${created.body.data.id}/accept`)
      .expect(200);
    return {
      allocationId: created.body.data.id as string,
      roomId: accepted.body.data.roomId as string,
    };
  }

  const withdraw = (
    allocationId: string,
    reason?: string,
    as = 'official',
    office = 'office',
  ) =>
    api(as).post(
      gov(`/allocations/${allocationId}/cancel`, office),
      reason ? { reason } : {},
    );

  describe('the defect is no longer reachable', () => {
    it('refuses premature closure while the problem is in progress', async () => {
      const problem = await verifiedProblem('premature');
      const { roomId } = await allocateAndAccept(problem.publicId, 'ngoa');
      const view = await api('official').get(`/resolution-rooms/${roomId}`).expect(200);
      expect(view.body.data.viewer.canClose).toBe(false);
      await api('official')
        .post(`/resolution-rooms/${roomId}/close`, {
          reason: 'Handing over to the ward.',
        })
        .expect(409);
      expect(
        (await prisma.resolutionRoom.findUniqueOrThrow({ where: { id: roomId } })).status,
      ).toBe('OPEN');
      expect(
        (await prisma.problem.findUniqueOrThrow({ where: { id: problem.id } })).status,
      ).toBe('IN_PROGRESS');
    });
  });

  describe('withdrawing accepted work', () => {
    let problem: { id: string; publicId: string };
    let first: { allocationId: string; roomId: string };

    beforeAll(async () => {
      problem = await verifiedProblem('withdraw');
      first = await allocateAndAccept(problem.publicId, 'ngoa');
    });

    it('needs a reason, and only the allocating office may do it', async () => {
      await withdraw(first.allocationId).expect(400);
      await withdraw(first.allocationId, 'too short').expect(400);
      await withdraw(first.allocationId, REASON, 'ownerA').expect(403);
      const other = await withdraw(
        first.allocationId,
        REASON,
        'otherOfficial',
        'elsewhere',
      );
      expect([403, 404]).toContain(other.status);
      const allocation = await prisma.problemAllocation.findUniqueOrThrow({
        where: { id: first.allocationId },
      });
      expect(allocation.status).toBe('ACCEPTED');
    });

    it('waits for a pending verification decision', async () => {
      const project = await prisma.resolutionProject.findUniqueOrThrow({
        where: { roomId: first.roomId },
      });
      const pending = await prisma.resolutionVerificationRequest.create({
        data: {
          projectId: project.id,
          problemId: problem.id,
          requestedById: users.ownerA!,
          governmentOrganizationId: orgs.office!,
        },
      });
      const blocked = await withdraw(first.allocationId, REASON).expect(409);
      expect(blocked.body.error.message).toMatch(/verification/i);
      expect(
        (
          await prisma.problemAllocation.findUniqueOrThrow({
            where: { id: first.allocationId },
          })
        ).status,
      ).toBe('ACCEPTED');
      // The office decides it (the decision workflow itself is covered by
      // verification.e2e); then the withdrawal may proceed.
      await prisma.resolutionVerificationRequest.update({
        where: { id: pending.id },
        data: {
          status: 'REJECTED',
          decidedAt: new Date(),
          decidedById: users.official!,
          decisionReason: 'Evidence did not show the drain cleared.',
        },
      });
    });

    it('ends the work in one step: allocation, project, room and problem', async () => {
      const response = await withdraw(first.allocationId, REASON).expect(200);
      expect(response.body.data.status).toBe('CANCELLED');

      const allocation = await prisma.problemAllocation.findUniqueOrThrow({
        where: { id: first.allocationId },
      });
      expect(allocation).toMatchObject({
        status: 'CANCELLED',
        cancelledById: users.official,
        cancellationReason: REASON,
      });
      const row = await prisma.problem.findUniqueOrThrow({ where: { id: problem.id } });
      expect(row.status).toBe('VERIFIED'); // never RESOLVED
      expect(row.resolvedAt).toBeNull();
      const room = await prisma.resolutionRoom.findUniqueOrThrow({
        where: { id: first.roomId },
      });
      expect(room.status).toBe('CLOSED');
      expect(room.closeReason).toContain(REASON);
      const project = await prisma.resolutionProject.findUniqueOrThrow({
        where: { roomId: first.roomId },
      });
      expect(project.status).toBe('CANCELLED');

      // History is preserved and attributed.
      const actions = (
        await prisma.auditLog.findMany({
          where: {
            actorUserId: users.official!,
            createdAt: { gte: allocation.cancelledAt! },
          },
          select: { action: true, metadata: true },
        })
      ).map((a) => a.action);
      expect(actions).toEqual(
        expect.arrayContaining([
          'ALLOCATION_CANCELLED',
          'PROBLEM_STATUS_CHANGED',
          'RESOLUTION_PROJECT_STATUS_CHANGED',
          'RESOLUTION_ROOM_CLOSED',
        ]),
      );
      // Messages remain readable to participants; nothing new can be posted.
      await api('ownerA').get(`/resolution-rooms/${first.roomId}/messages`).expect(200);
      await api('ownerA')
        .post(`/resolution-rooms/${first.roomId}/messages`, { body: 'Still here?' })
        .expect(409);
    });

    it('tells the organisation and the reporter', async () => {
      await bus.drain();
      const forOwner = await prisma.notification.findMany({
        where: { recipientId: users.ownerA! },
        select: { type: true },
      });
      expect(forOwner.map((n) => n.type)).toEqual(
        expect.arrayContaining(['ALLOCATION_CANCELLED', 'RESOLUTION_ROOM_CLOSED']),
      );
      const forReporter = await prisma.notification.count({
        where: { recipientId: users.reporter!, type: 'PROBLEM_STATUS_CHANGED' },
      });
      expect(forReporter).toBeGreaterThan(0);
    });

    it('is not applied twice on retry', async () => {
      await withdraw(first.allocationId, REASON).expect(409);
      expect(
        await prisma.auditLog.count({
          where: { action: 'ALLOCATION_CANCELLED', entityId: problem.id },
        }),
      ).toBe(1);
    });

    it('lets the office reallocate through the normal workflow', async () => {
      const second = await allocateAndAccept(problem.publicId, 'ngob');
      expect(second.roomId).not.toBe(first.roomId);
      expect(
        (await prisma.problem.findUniqueOrThrow({ where: { id: problem.id } })).status,
      ).toBe('IN_PROGRESS');
      const room = await api('ownerB')
        .get(`/resolution-rooms/${second.roomId}`)
        .expect(200);
      expect(room.body.data.status).toBe('OPEN');
      // The first organisation lost access with its allocation.
      const old = await api('ownerA').get(`/resolution-rooms/${second.roomId}`);
      expect([403, 404]).toContain(old.status);
    });
  });

  describe('concurrency', () => {
    it('two simultaneous withdrawals: exactly one succeeds', async () => {
      const problem = await verifiedProblem('race');
      const { allocationId } = await allocateAndAccept(problem.publicId, 'ngoa');
      const [a, b] = await Promise.all([
        withdraw(allocationId, REASON),
        withdraw(allocationId, REASON),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      expect(
        await prisma.auditLog.count({
          where: {
            action: 'PROBLEM_STATUS_CHANGED',
            entityId: problem.id,
            metadata: { path: ['viaAllocationWithdrawal'], equals: true },
          },
        }),
      ).toBe(1);
      expect(
        (await prisma.problem.findUniqueOrThrow({ where: { id: problem.id } })).status,
      ).toBe('VERIFIED');
    });

    it('a withdrawal racing a room closure leaves a consistent state', async () => {
      const problem = await verifiedProblem('close-race');
      const { allocationId, roomId } = await allocateAndAccept(problem.publicId, 'ngoa');
      const [w, c] = await Promise.all([
        withdraw(allocationId, REASON),
        api('official').post(`/resolution-rooms/${roomId}/close`, {
          reason: 'Closing at once.',
        }),
      ]);
      expect(w.status).toBe(200);
      // Either refused (work still active when it ran) or a no-op 409 (room
      // already closed by the withdrawal) — never a second closure.
      expect(c.status).toBe(409);
      expect(
        await prisma.auditLog.count({
          where: { action: 'RESOLUTION_ROOM_CLOSED', entityId: roomId },
        }),
      ).toBe(1);
    });
  });

  describe('recovering problems stuck under the old rules', () => {
    it('a room closed mid-work: withdraw recovers it', async () => {
      const problem = await verifiedProblem('legacy-closed');
      const { allocationId, roomId } = await allocateAndAccept(problem.publicId, 'ngoa');
      // The state the old rule allowed: room CLOSED, allocation ACCEPTED,
      // problem IN_PROGRESS.
      await prisma.resolutionRoom.update({
        where: { id: roomId },
        data: {
          status: 'CLOSED',
          closedAt: new Date(),
          closedById: users.official!,
          closeReason: 'Legacy premature closure',
        },
      });
      const project = await prisma.resolutionProject.findUniqueOrThrow({
        where: { roomId },
      });
      // Stuck: the project is read-only.
      await api('ownerA')
        .post(`/resolution-projects/${project.id}/tasks`, { title: 'Try to continue' })
        .expect(409);

      await withdraw(allocationId, REASON).expect(200);
      expect(
        (await prisma.problem.findUniqueOrThrow({ where: { id: problem.id } })).status,
      ).toBe('VERIFIED');
      const room = await prisma.resolutionRoom.findUniqueOrThrow({
        where: { id: roomId },
      });
      expect(room.closeReason).toBe('Legacy premature closure'); // not overwritten
      expect(
        (await prisma.resolutionProject.findUniqueOrThrow({ where: { roomId } })).status,
      ).toBe('CANCELLED');
      await allocateAndAccept(problem.publicId, 'ngob');
    });

    it('a project cancelled by the organisation: withdraw recovers it', async () => {
      const problem = await verifiedProblem('legacy-cancelled');
      const { allocationId, roomId } = await allocateAndAccept(problem.publicId, 'ngoa');
      const project = await prisma.resolutionProject.findUniqueOrThrow({
        where: { roomId },
      });
      await api('ownerA')
        .post(`/resolution-projects/${project.id}/status`, {
          status: 'CANCELLED',
          reason: 'We no longer have a crew for this.',
        })
        .expect(200);
      const before = await prisma.auditLog.count({
        where: { action: 'RESOLUTION_PROJECT_STATUS_CHANGED', entityId: project.id },
      });

      await withdraw(allocationId, REASON).expect(200);
      expect(
        (await prisma.problem.findUniqueOrThrow({ where: { id: problem.id } })).status,
      ).toBe('VERIFIED');
      // The already-cancelled project is not cancelled again.
      expect(
        await prisma.auditLog.count({
          where: { action: 'RESOLUTION_PROJECT_STATUS_CHANGED', entityId: project.id },
        }),
      ).toBe(before);
      expect(
        (await prisma.resolutionRoom.findUniqueOrThrow({ where: { id: roomId } })).status,
      ).toBe('CLOSED');
    });
  });

  describe('resolved work', () => {
    it('cannot be withdrawn, and its room closes normally', async () => {
      const problem = await verifiedProblem('resolved');
      const { allocationId, roomId } = await allocateAndAccept(problem.publicId, 'ngoa');
      // Outcome of an approved verification (workflow covered elsewhere).
      await prisma.problem.update({
        where: { id: problem.id },
        data: { status: 'RESOLVED', resolvedAt: new Date() },
      });
      await withdraw(allocationId, REASON).expect(409);
      const row = await prisma.problem.findUniqueOrThrow({ where: { id: problem.id } });
      expect(row.status).toBe('RESOLVED');
      expect(
        (
          await prisma.problemAllocation.findUniqueOrThrow({
            where: { id: allocationId },
          })
        ).status,
      ).toBe('ACCEPTED');
      await api('official')
        .post(`/resolution-rooms/${roomId}/close`, { reason: 'Resolution approved.' })
        .expect(200);
    });
  });
});
