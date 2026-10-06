import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AiService } from '../src/ai/ai.service.js';
import { configureApp, registerNotFoundHandler } from '../src/bootstrap.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { DomainEventBus } from '../src/events/domain-event-bus.js';
import { RedisService } from '../src/redis/redis.service.js';
import { StorageService } from '../src/storage/storage.types.js';
import { deleteAuditLogs } from './audit-maintenance.js';

/**
 * Resolution rooms (Prompt 17) end to end, against real PostgreSQL and Redis.
 *
 *   e2e-room-pune     government office (Pune)   government@ OWNER, official2 MEMBER,
 *                                                 clerk (role CITIZEN) MEMBER — not a participant
 *   e2e-room-nagpur   government office (Nagpur) gov2 OWNER — another office
 *   e2e-room-ngo      NGO, VERIFIED              owner / admin / member
 *   e2e-room-other    NGO, VERIFIED              other OWNER — unrelated organisation
 */
describe('Resolution rooms (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let bus: DomainEventBus;
  let storage: StorageService;
  let server: http.Server;
  let port: number;

  const PASSWORD = 'DevPassword123!';
  const PREFIX = 'e2e-room-';
  const TITLE = 'Room probe ';
  const EMAIL = (key: string) => `${PREFIX}${key}@samadhaan.test`;

  const PUNE: [number, number, number, number] = [73.7, 18.4, 74.0, 18.65];
  const NAGPUR: [number, number, number, number] = [78.95, 21.05, 79.2, 21.25];

  const orgs: Record<string, string> = {};
  const users: Record<string, string> = {};
  const problems: Record<string, { id: string; publicId: string }> = {};
  const cookies: Record<string, string[]> = {};
  let officialId: string;
  let roomId: string;
  let allocationId: string;

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
    server = app.getHttpServer();
    await new Promise<void>((resolve) => server.listen(0, resolve));
    port = (server.address() as AddressInfo).port;

    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    bus = app.get(DomainEventBus);
    storage = app.get(StorageService);

    await cleanUp();

    const government = await prisma.user.findUniqueOrThrow({
      where: { email: 'government@samadhaan.dev' },
    });
    officialId = government.id;
    const reporterId = (
      await prisma.user.findUniqueOrThrow({ where: { email: 'citizen@samadhaan.dev' } })
    ).id;

    const user = async (key: string, role: 'NGO' | 'GOVERNMENT' | 'CITIZEN') => {
      users[key] = (
        await prisma.user.create({
          data: {
            email: EMAIL(key),
            passwordHash: government.passwordHash,
            fullName: `Room ${key}`,
            role,
            status: 'ACTIVE',
          },
        })
      ).id;
    };
    await user('official2', 'GOVERNMENT');
    await user('clerk', 'CITIZEN');
    await user('gov2', 'GOVERNMENT');
    await user('owner', 'NGO');
    await user('admin', 'NGO');
    await user('member', 'NGO');
    await user('other', 'NGO');

    const org = async (
      key: string,
      type: 'GOVERNMENT' | 'NGO',
      members: Array<[string, 'OWNER' | 'ADMIN' | 'MEMBER']>,
      bbox?: [number, number, number, number],
    ) => {
      const created = await prisma.organization.create({
        data: {
          name: `E2E Room ${key}`,
          slug: `${PREFIX}${key}`,
          type,
          verificationStatus: 'VERIFIED',
          city: 'Pune',
          ...(type === 'GOVERNMENT'
            ? { jurisdictionType: 'MUNICIPAL_CORPORATION', jurisdictionName: key }
            : {}),
        },
      });
      orgs[key] = created.id;
      if (bbox) await setBoundary(created.id, bbox);
      for (const [userId, role] of members) {
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
    await org(
      'pune',
      'GOVERNMENT',
      [
        [government.id, 'OWNER'],
        [users.official2!, 'MEMBER'],
        [users.clerk!, 'MEMBER'],
      ],
      PUNE,
    );
    await org('nagpur', 'GOVERNMENT', [[users.gov2!, 'OWNER']], NAGPUR);
    await org('ngo', 'NGO', [
      [users.owner!, 'OWNER'],
      [users.admin!, 'ADMIN'],
      [users.member!, 'MEMBER'],
    ]);
    await org('other', 'NGO', [[users.other!, 'OWNER']]);

    for (const key of ['room', 'rollback']) {
      const created = await prisma.problem.create({
        data: {
          reporterId,
          title: `${TITLE}${key}`,
          description: `${key} — created by the resolution e2e suite.`,
          category: 'POTHOLES',
          severity: 'HIGH',
          status: 'VERIFIED',
          latitude: 18.53,
          longitude: 73.85,
          address: `${key} Lane, Shivaji Nagar`,
          city: 'Pune',
          state: 'Maharashtra',
        },
      });
      problems[key] = { id: created.id, publicId: created.publicId };
    }

    await clearRateLimits();
    cookies.official = await loginAs('government@samadhaan.dev');
    cookies.citizen = await loginAs('citizen@samadhaan.dev');
    cookies.platformAdmin = await loginAs('admin@samadhaan.dev');
    for (const key of [
      'official2',
      'clerk',
      'gov2',
      'owner',
      'admin',
      'member',
      'other',
    ]) {
      cookies[key] = await loginAs(EMAIL(key));
    }
  });

  beforeEach(clearRateLimits);

  afterAll(async () => {
    if (prisma) await cleanUp();
    await app?.close();
  });

  async function setBoundary(id: string, [west, south, east, north]: number[]) {
    await prisma.$executeRaw`
      UPDATE organizations
      SET "jurisdictionBoundary" = ST_Multi(ST_MakeEnvelope(${west}, ${south}, ${east}, ${north}, 4326))::geography
      WHERE id = ${id}::uuid`;
  }

  async function cleanUp(): Promise<void> {
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS e2e_room_fail ON resolution_rooms',
    );
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS e2e_room_fail()');
    const stale = await prisma.problem.findMany({
      where: { title: { startsWith: TITLE } },
      select: { id: true },
    });
    const ids = stale.map((row) => row.id);
    const rooms = await prisma.resolutionRoom.findMany({
      where: { problemId: { in: ids } },
      select: { id: true },
    });
    const roomIds = rooms.map((room) => room.id);
    const allocations = await prisma.problemAllocation.findMany({
      where: { problemId: { in: ids } },
      select: { id: true },
    });
    await prisma.notification.deleteMany({
      where: { entityId: { in: [...ids, ...roomIds, ...allocations.map((a) => a.id)] } },
    });
    // Stored files too — the suite leaves nothing behind on disk.
    const files = await prisma.resolutionAttachment.findMany({
      where: { roomId: { in: roomIds } },
      select: { storageKey: true },
    });
    for (const file of files) await storage.delete(file.storageKey);
    await deleteAuditLogs(prisma, {
      entityType: 'ResolutionRoom',
      entityId: { in: roomIds },
    });
    await prisma.resolutionRoom.deleteMany({ where: { id: { in: roomIds } } });
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

  const api = (as: string) => ({
    get: (path: string) =>
      request(server).get(`/api/v1${path}`).set('Cookie', cookies[as]!),
    post: (path: string, body: object = {}) =>
      request(server).post(`/api/v1${path}`).set('Cookie', cookies[as]!).send(body),
    patch: (path: string, body: object) =>
      request(server).patch(`/api/v1${path}`).set('Cookie', cookies[as]!).send(body),
    delete: (path: string) =>
      request(server).delete(`/api/v1${path}`).set('Cookie', cookies[as]!),
  });
  const room = (path = '') => `/resolution-rooms/${roomId}${path}`;
  const upload = (as: string) =>
    request(server)
      .post(`/api/v1${room('/attachments')}`)
      .set('Cookie', cookies[as]!);

  async function allocateAndAccept(key: string): Promise<request.Response> {
    const created = await api('official')
      .post(`/government/${PREFIX}pune/problems/${problems[key]!.publicId}/allocations`, {
        organizationId: orgs.ngo,
        instructions: 'Inspect within 48 hours.',
      })
      .expect(201);
    allocationId = created.body.data.id;
    return api('owner').post(
      `/organizations/${PREFIX}ngo/allocations/${allocationId}/accept`,
      {},
    );
  }

  async function png(): Promise<Buffer> {
    return sharp({
      create: {
        width: 64,
        height: 64,
        channels: 3,
        background: { r: 200, g: 80, b: 40 },
      },
    })
      .png()
      .toBuffer();
  }

  // ================================================================ creation

  describe('room creation', () => {
    it('rolls the acceptance back when the room cannot be opened', async () => {
      // A test-only trigger makes room creation fail for this problem.
      await prisma.$executeRawUnsafe(`
        CREATE FUNCTION e2e_room_fail() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW."problemId" = '${problems.rollback!.id}'::uuid THEN
            RAISE EXCEPTION 'simulated room failure';
          END IF;
          RETURN NEW;
        END $$;`);
      await prisma.$executeRawUnsafe(
        'CREATE TRIGGER e2e_room_fail BEFORE INSERT ON resolution_rooms FOR EACH ROW EXECUTE FUNCTION e2e_room_fail()',
      );

      const response = await allocateAndAccept('rollback');
      expect(response.status).toBe(500);

      const allocation = await prisma.problemAllocation.findUniqueOrThrow({
        where: { id: allocationId },
      });
      expect(allocation.status).toBe('PENDING');
      const problem = await prisma.problem.findUniqueOrThrow({
        where: { id: problems.rollback!.id },
      });
      expect(problem.status).toBe('VERIFIED');
      expect(await prisma.resolutionRoom.count({ where: { allocationId } })).toBe(0);
      expect(
        await prisma.auditLog.count({
          where: { entityId: problems.rollback!.id, action: 'ALLOCATION_ACCEPTED' },
        }),
      ).toBe(0);

      await prisma.$executeRawUnsafe('DROP TRIGGER e2e_room_fail ON resolution_rooms');
      await prisma.$executeRawUnsafe('DROP FUNCTION e2e_room_fail()');
    });

    it('opens a room in the same transaction as the acceptance', async () => {
      const response = await allocateAndAccept('room');
      expect(response.status).toBe(200);
      roomId = response.body.data.roomId;
      expect(roomId).toMatch(/^[0-9a-f-]{36}$/);

      const row = await prisma.resolutionRoom.findUniqueOrThrow({
        where: { id: roomId },
      });
      expect(row).toMatchObject({
        status: 'OPEN',
        allocationId,
        problemId: problems.room!.id,
        governmentOrganizationId: orgs.pune,
        assignedOrganizationId: orgs.ngo,
      });
      expect(
        await prisma.resolutionRoomEvent.count({
          where: { roomId, type: 'ROOM_CREATED' },
        }),
      ).toBe(1);
      expect(
        await prisma.auditLog.count({
          where: { entityId: roomId, action: 'RESOLUTION_ROOM_CREATED' },
        }),
      ).toBe(1);
    });

    it('shows the room to the allocating office from the problem page', async () => {
      const panel = await api('official')
        .get(`/government/${PREFIX}pune/problems/${problems.room!.publicId}/allocations`)
        .expect(200);
      expect(panel.body.data.active).toMatchObject({ status: 'ACCEPTED', roomId });
    });

    it('allows one room per allocation, and only for an accepted one', async () => {
      await expect(
        prisma.resolutionRoom.create({
          data: {
            problemId: problems.room!.id,
            allocationId,
            governmentOrganizationId: orgs.pune!,
            assignedOrganizationId: orgs.ngo!,
          },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });

      const pending = await prisma.problemAllocation.findFirstOrThrow({
        where: { problemId: problems.rollback!.id, status: 'PENDING' },
      });
      await expect(
        prisma.resolutionRoom.create({
          data: {
            problemId: problems.rollback!.id,
            allocationId: pending.id,
            governmentOrganizationId: orgs.pune!,
            assignedOrganizationId: orgs.ngo!,
          },
        }),
      ).rejects.toThrow(/accepted allocation/);
    });
  });

  // =========================================================== authorisation

  describe('who may enter', () => {
    it.each([
      ['an official of the allocating office', 'official', 'GOVERNMENT'],
      ['another official of that office', 'official2', 'GOVERNMENT'],
      ['the organisation owner', 'owner', 'ORGANIZATION'],
      ['an organisation member', 'member', 'ORGANIZATION'],
    ])('lets in %s', async (_label, who, side) => {
      const response = await api(who).get(room()).expect(200);
      expect(response.body.data.viewer.side).toBe(side);
      expect(response.body.data.problem.publicId).toBe(problems.room!.publicId);
    });

    it.each([
      ['an unrelated organisation', 'other'],
      ['another government office', 'gov2'],
      ['a citizen — even the reporter', 'citizen'],
      ['a platform administrator', 'platformAdmin'],
      ['an office member without the government role', 'clerk'],
    ])('answers 404 to %s', async (_label, who) => {
      await api(who).get(room()).expect(404);
      await api(who).get(room('/messages')).expect(404);
      await api(who).post(room('/messages'), { body: 'hello' }).expect(404);
    });

    it('refuses anonymous and malformed requests', async () => {
      await request(server).get(`/api/v1${room()}`).expect(401);
      await api('owner').get('/resolution-rooms/not-a-uuid').expect(400);
      await api('owner')
        .get('/resolution-rooms/00000000-0000-4000-8000-000000000000')
        .expect(404);
    });

    it('closes to the office when the problem leaves its jurisdiction', async () => {
      await setBoundary(orgs.pune!, NAGPUR);
      try {
        await api('official').get(room()).expect(404);
      } finally {
        await setBoundary(orgs.pune!, PUNE);
      }
      await api('official').get(room()).expect(200);
    });

    it('lists rooms for participants only', async () => {
      const ids = (who: string) =>
        api(who)
          .get('/resolution-rooms')
          .then((r) => r.body.data.map((entry: { id: string }) => entry.id));
      expect(await ids('official')).toContain(roomId);
      expect(await ids('member')).toContain(roomId);
      expect(await ids('other')).not.toContain(roomId);
      expect(await ids('gov2')).not.toContain(roomId);
    });

    it('derives participants from active memberships, without private details', async () => {
      const response = await api('member').get(room('/participants')).expect(200);
      const government = response.body.data.government.members.map(
        (m: { userId: string }) => m.userId,
      );
      const organization = response.body.data.organization.members.map(
        (m: { userId: string }) => m.userId,
      );
      expect(government.sort()).toEqual([officialId, users.official2!].sort());
      expect(government).not.toContain(users.clerk);
      expect(organization.sort()).toEqual(
        [users.owner!, users.admin!, users.member!].sort(),
      );
      expect(JSON.stringify(response.body)).not.toContain('@');
    });
  });

  // ================================================================ messages

  describe('messages', () => {
    let ownerMessage: string;

    it('lets a participant post, with mentions of participants only', async () => {
      const response = await api('owner')
        .post(room('/messages'), {
          body: '  @Room official2 our team will inspect tomorrow. <script>alert(1)</script>  ',
          mentionUserIds: [users.official2, users.other],
        })
        .expect(201);
      ownerMessage = response.body.data.id;
      expect(response.body.data).toMatchObject({
        body: '@Room official2 our team will inspect tomorrow. <script>alert(1)</script>',
        author: {
          userId: users.owner,
          side: 'ORGANIZATION',
          organizationName: 'E2E Room ngo',
        },
        mentions: [{ userId: users.official2 }],
        editedAt: null,
        deletedAt: null,
      });
    });

    it('refuses empty, oversized and over-specified messages', async () => {
      await api('owner').post(room('/messages'), {}).expect(400);
      await api('owner').post(room('/messages'), { body: '   ' }).expect(400);
      await api('owner')
        .post(room('/messages'), { body: 'x'.repeat(4001) })
        .expect(400);
      for (const extra of [
        { authorId: users.admin },
        { roomId },
        { organizationId: orgs.pune },
      ]) {
        await api('owner')
          .post(room('/messages'), { body: 'hello', ...extra })
          .expect(400);
      }
    });

    it('does not let anyone change another participant’s message', async () => {
      await api('official')
        .patch(room(`/messages/${ownerMessage}`), { body: 'rewritten' })
        .expect(403);
      await api('admin')
        .patch(room(`/messages/${ownerMessage}`), { body: 'rewritten' })
        .expect(403);
      await api('official')
        .delete(room(`/messages/${ownerMessage}`))
        .expect(403);
      await api('other')
        .patch(room(`/messages/${ownerMessage}`), { body: 'rewritten' })
        .expect(404);
    });

    it('lets the author edit, marking it edited', async () => {
      const response = await api('owner')
        .patch(room(`/messages/${ownerMessage}`), { body: 'Inspection moved to Friday.' })
        .expect(200);
      expect(response.body.data.body).toBe('Inspection moved to Friday.');
      expect(response.body.data.editedAt).not.toBeNull();
    });

    it('soft-deletes for the author: hidden, but kept', async () => {
      const own = await api('admin')
        .post(room('/messages'), { body: 'Wrong room.' })
        .expect(201);
      await api('admin')
        .delete(room(`/messages/${own.body.data.id}`))
        .expect(204);

      const page = await api('official').get(room('/messages')).expect(200);
      const deleted = page.body.data.items.find(
        (m: { id: string }) => m.id === own.body.data.id,
      );
      expect(deleted).toMatchObject({ body: null, mentions: [], attachments: [] });
      expect(deleted.deletedAt).not.toBeNull();
      expect(JSON.stringify(page.body)).not.toContain('Wrong room.');

      const row = await prisma.resolutionMessage.findUniqueOrThrow({
        where: { id: own.body.data.id },
      });
      expect(row.body).toBe('Wrong room.');
      await api('admin')
        .patch(room(`/messages/${own.body.data.id}`), { body: 'again' })
        .expect(409);
    });

    it('paginates by cursor, deterministically, oldest first within a page', async () => {
      for (let i = 1; i <= 7; i += 1) {
        await api(i % 2 ? 'official' : 'member')
          .post(room('/messages'), { body: `Page message ${i}` })
          .expect(201);
      }
      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const response: request.Response = await api('member')
          .get(room(`/messages?limit=3${cursor ? `&cursor=${cursor}` : ''}`))
          .expect(200);
        const items = response.body.data.items as Array<{
          id: string;
          createdAt: string;
        }>;
        const times = items.map((m) => m.createdAt);
        expect([...times].sort()).toEqual(times);
        seen.unshift(...items.map((m) => m.id));
        cursor = response.body.data.nextCursor;
        pages += 1;
      } while (cursor && pages < 10);

      const all = await prisma.resolutionMessage.findMany({
        where: { roomId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true },
      });
      expect(seen).toEqual(all.map((m) => m.id));
      await api('member').get(room('/messages?cursor=bogus')).expect(400);
    });

    it('tracks unread per participant from their read marker', async () => {
      await api('official2').post(room('/read')).expect(200);
      expect((await api('official2').get(room()).expect(200)).body.data.unreadCount).toBe(
        0,
      );

      await api('member').post(room('/messages'), { body: 'One' }).expect(201);
      await api('member').post(room('/messages'), { body: 'Two' }).expect(201);
      expect((await api('official2').get(room()).expect(200)).body.data.unreadCount).toBe(
        2,
      );
      // Your own messages are never unread to you.
      expect((await api('member').get(room()).expect(200)).body.data.unreadCount).toBe(0);

      const read = await api('official2').post(room('/read')).expect(200);
      expect(read.body.data.unreadCount).toBe(0);
    });

    it('rate-limits posting', async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 21; i += 1) {
        statuses.push(
          (await api('admin').post(room('/messages'), { body: `Burst ${i}` })).status,
        );
      }
      expect(statuses.slice(0, 20).every((s) => s === 201)).toBe(true);
      expect(statuses[20]).toBe(429);
    });
  });

  // ============================================================ attachments

  describe('attachments', () => {
    let attachmentId: string;

    it('accepts an image from a participant, by its bytes', async () => {
      const response = await upload('owner')
        .attach('file', await png(), {
          filename: '../../site photo.png',
          contentType: 'image/png',
        })
        .expect(201);
      attachmentId = response.body.data.id;
      expect(response.body.data).toMatchObject({
        fileName: 'site photo.png',
        mimeType: 'image/png',
        messageId: null,
      });
      const row = await prisma.resolutionAttachment.findUniqueOrThrow({
        where: { id: attachmentId },
      });
      expect(row.storageKey).toMatch(
        /^resolution\/[0-9a-f-]{36}\/\d{4}\/\d{2}\/[0-9a-f]{32}\.png$/,
      );
    });

    it('accepts a PDF and refuses disguised or unsupported files', async () => {
      await upload('owner')
        .attach('file', Buffer.from('%PDF-1.4\n%%EOF\n'), 'report.pdf')
        .expect(201);
      // Executable bytes named as a PDF.
      await upload('owner')
        .attach('file', Buffer.from('MZ\x90\x00 not a pdf'), {
          filename: 'report.pdf',
          contentType: 'application/pdf',
        })
        .expect(400);
      // A real image with an executable name.
      await upload('owner')
        .attach('file', await png(), 'tool.exe')
        .expect(400);
      // HTML is never accepted.
      await upload('owner')
        .attach(
          'file',
          Buffer.from('<html><script>alert(1)</script></html>'),
          'page.html',
        )
        .expect(400);
      await upload('owner').expect(400);
    });

    it('refuses uploads from non-participants', async () => {
      await upload('other')
        .attach('file', await png(), 'x.png')
        .expect(404);
    });

    it('attaches only the sender’s own unsent uploads', async () => {
      await api('member')
        .post(room('/messages'), {
          body: 'Using your photo',
          attachmentIds: [attachmentId],
        })
        .expect(400);
      const response = await api('owner')
        .post(room('/messages'), {
          body: 'Site photo attached.',
          attachmentIds: [attachmentId],
        })
        .expect(201);
      expect(response.body.data.attachments).toHaveLength(1);
    });

    it('serves files to participants only, never through the public media route', async () => {
      const file = await api('official')
        .get(room(`/attachments/${attachmentId}/file`))
        .expect(200);
      expect(file.headers['content-type']).toBe('image/png');
      expect(file.headers['x-content-type-options']).toBe('nosniff');
      expect(file.headers['content-security-policy']).toContain('sandbox');

      await api('other')
        .get(room(`/attachments/${attachmentId}/file`))
        .expect(404);
      await request(server)
        .get(`/api/v1${room(`/attachments/${attachmentId}/file`)}`)
        .expect(401);

      const row = await prisma.resolutionAttachment.findUniqueOrThrow({
        where: { id: attachmentId },
      });
      await request(server).get(`/api/v1/media/${row.storageKey}`).expect(404);

      const list = await api('member').get(room('/attachments')).expect(200);
      expect(list.body.data.map((a: { id: string }) => a.id)).toContain(attachmentId);
    });
  });

  // ========================================================= notifications

  describe('notifications', () => {
    it('tells mentioned participants, once per message', async () => {
      await bus.drain();
      const mentions = await prisma.notification.findMany({
        where: { entityId: roomId, type: 'RESOLUTION_MENTION' },
        select: { recipientId: true },
      });
      expect(mentions.map((n) => n.recipientId)).toEqual([users.official2]);
    });

    it('notifies participants of new messages, quietly, and nobody else', async () => {
      await bus.drain();
      const recipients = new Set(
        (
          await prisma.notification.findMany({
            where: { entityId: roomId, type: 'RESOLUTION_MESSAGE' },
            select: { recipientId: true },
          })
        ).map((n) => n.recipientId),
      );
      for (const outsider of [users.other, users.gov2, users.clerk]) {
        expect(recipients.has(outsider!)).toBe(false);
      }
      expect(recipients.has(officialId)).toBe(true);

      // One per unread streak: official has not read since joining, so
      // further messages add nothing for them…
      const before = await prisma.notification.count({
        where: { recipientId: officialId, entityId: roomId, type: 'RESOLUTION_MESSAGE' },
      });
      await api('member').post(room('/messages'), { body: 'Another update' }).expect(201);
      await bus.drain();
      expect(
        await prisma.notification.count({
          where: {
            recipientId: officialId,
            entityId: roomId,
            type: 'RESOLUTION_MESSAGE',
          },
        }),
      ).toBe(before);

      // …until they read the room; the next message notifies again.
      await api('official').post(room('/read')).expect(200);
      await api('member').post(room('/messages'), { body: 'After you read' }).expect(201);
      await bus.drain();
      expect(
        await prisma.notification.count({
          where: {
            recipientId: officialId,
            entityId: roomId,
            type: 'RESOLUTION_MESSAGE',
          },
        }),
      ).toBe(before + 1);
    });

    it('never notifies the author, and never includes message text', async () => {
      await bus.drain();
      const own = await prisma.notification.findMany({
        where: { entityId: roomId },
        select: { recipientId: true, message: true, type: true },
      });
      for (const notification of own) {
        expect(notification.message).not.toContain('inspect tomorrow');
        expect(notification.message).not.toContain('After you read');
      }
      const inbox = await api('official').get('/notifications').expect(200);
      const item = inbox.body.data.items.find(
        (entry: { type: string }) => entry.type === 'RESOLUTION_MESSAGE',
      );
      expect(item.href).toBe(`/resolution/${roomId}`);
    });
  });

  // =============================================================== realtime

  describe('realtime stream', () => {
    function openStream(as: string) {
      return new Promise<{ status: number; events: string[]; close: () => void }>(
        (resolve) => {
          const events: string[] = [];
          const req = http.get(
            {
              host: '127.0.0.1',
              port,
              path: `/api/v1${room('/stream')}`,
              headers: { cookie: cookies[as]!.map((c) => c.split(';')[0]).join('; ') },
            },
            (res) => {
              res.setEncoding('utf8');
              res.on('data', (chunk: string) => events.push(chunk));
              resolve({
                status: res.statusCode ?? 0,
                events,
                close: () => req.destroy(),
              });
            },
          );
          req.on('error', () => undefined);
        },
      );
    }

    it('delivers new messages to connected participants', async () => {
      const stream = await openStream('official');
      expect(stream.status).toBe(200);
      try {
        await api('member').post(room('/messages'), { body: 'Live update' }).expect(201);
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline && !stream.events.join('').includes('Live update')) {
          await new Promise((r) => setTimeout(r, 50));
        }
        const text = stream.events.join('');
        expect(text).toContain('event: message.created');
        expect(text).toContain('Live update');
      } finally {
        stream.close();
      }
    });

    it('refuses streams to non-participants and anonymous callers', async () => {
      const other = await openStream('other');
      expect(other.status).toBe(404);
      other.close();
      const status = await new Promise<number>((resolve) => {
        http
          .get({ host: '127.0.0.1', port, path: `/api/v1${room('/stream')}` }, (res) => {
            resolve(res.statusCode ?? 0);
            res.destroy();
          })
          .on('error', () => resolve(0));
      });
      expect(status).toBe(401);
    });
  });

  // ================================================================ activity

  describe('activity and privacy', () => {
    it('records system activity separately from messages', async () => {
      const response = await api('member').get(room('/activity')).expect(200);
      const kinds = response.body.data.map((e: { kind: string }) => e.kind);
      expect(kinds.slice(0, 3)).toEqual(['ALLOCATED', 'ACCEPTED', 'ROOM_CREATED']);
      expect(kinds).toEqual(
        expect.arrayContaining([
          'PARTICIPANT_JOINED',
          'MESSAGE_SENT',
          'MESSAGE_EDITED',
          'MESSAGE_DELETED',
          'ATTACHMENT_ADDED',
        ]),
      );
      expect(JSON.stringify(response.body)).not.toContain('Inspection moved');
    });

    it('keeps the public problem page free of room content', async () => {
      const response = await request(server)
        .get(`/api/v1/problems/${problems.room!.publicId}`)
        .expect(200);
      expect(response.body.data.assignment.organization.name).toBe('E2E Room ngo');
      const body = JSON.stringify(response.body);
      for (const secret of [
        'Inspection moved',
        'Live update',
        roomId,
        'Inspect within 48',
      ]) {
        expect(body).not.toContain(secret);
      }
    });
  });

  // ================================================================== close

  describe('closing', () => {
    it('is for the allocating office, with a reason', async () => {
      await api('owner').post(room('/close'), { reason: 'Done' }).expect(403);
      await api('official').post(room('/close'), {}).expect(400);
      const response = await api('official')
        .post(room('/close'), { reason: 'Work handed over to the ward team.' })
        .expect(200);
      expect(response.body.data).toMatchObject({
        status: 'CLOSED',
        closeReason: 'Work handed over to the ward team.',
        viewer: { canPost: false, canClose: false },
      });
      expect(
        await prisma.auditLog.count({
          where: { entityId: roomId, action: 'RESOLUTION_ROOM_CLOSED' },
        }),
      ).toBe(1);
    });

    it('stops messaging but keeps history readable', async () => {
      await api('owner').post(room('/messages'), { body: 'Too late' }).expect(409);
      const page = await api('owner').get(room('/messages')).expect(200);
      expect(page.body.data.items.length).toBeGreaterThan(0);
      await api('official').post(room('/close'), { reason: 'Again' }).expect(409);
    });

    it('tells the other participants, and the problem stays in progress', async () => {
      await bus.drain();
      const recipients = (
        await prisma.notification.findMany({
          where: { entityId: roomId, type: 'RESOLUTION_ROOM_CLOSED' },
          select: { recipientId: true },
        })
      ).map((n) => n.recipientId);
      expect(recipients).toContain(users.owner);
      expect(recipients).not.toContain(officialId);
      const problem = await prisma.problem.findUniqueOrThrow({
        where: { id: problems.room!.id },
      });
      expect(problem.status).toBe('IN_PROGRESS');
    });
  });
});
