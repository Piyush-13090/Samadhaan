import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { projectToday } from '@samadhaan/shared';
import { AppModule } from '../src/app.module.js';
import { AiService } from '../src/ai/ai.service.js';
import { configureApp, registerNotFoundHandler } from '../src/bootstrap.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { DomainEventBus } from '../src/events/domain-event-bus.js';
import { RedisService } from '../src/redis/redis.service.js';
import { ProjectRemindersService } from '../src/resolution/project-reminders.service.js';
import { StorageService } from '../src/storage/storage.types.js';
import { deleteAuditLogs } from './audit-maintenance.js';

/**
 * Resolution projects (Prompt 18) end to end.
 *
 *   e2e-proj-pune    government office (Pune)   government@ OWNER
 *   e2e-proj-nagpur  another office             gov2 OWNER
 *   e2e-proj-ngo     assigned NGO               owner / admin / member / member2
 *   e2e-proj-other   unrelated NGO              other OWNER
 */
describe('Resolution projects (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let bus: DomainEventBus;
  let storage: StorageService;
  let server: Parameters<typeof request>[0];

  const PASSWORD = 'DevPassword123!';
  const PREFIX = 'e2e-proj-';
  const TITLE = 'Project probe ';
  const EMAIL = (key: string) => `${PREFIX}${key}@samadhaan.test`;
  const PUNE: [number, number, number, number] = [73.7, 18.4, 74.0, 18.65];
  const NAGPUR: [number, number, number, number] = [78.95, 21.05, 79.2, 21.25];

  const orgs: Record<string, string> = {};
  const users: Record<string, string> = {};
  const problems: Record<string, { id: string; publicId: string }> = {};
  const cookies: Record<string, string[]> = {};
  let officialId: string;
  let roomId: string;
  let projectId: string;

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

    for (const [key, role] of [
      ['gov2', 'GOVERNMENT'],
      ['owner', 'NGO'],
      ['admin', 'NGO'],
      ['member', 'NGO'],
      ['member2', 'NGO'],
      ['other', 'NGO'],
    ] as const) {
      users[key] = (
        await prisma.user.create({
          data: {
            email: EMAIL(key),
            passwordHash: government.passwordHash,
            fullName: `Proj ${key}`,
            role,
            status: 'ACTIVE',
          },
        })
      ).id;
    }

    const org = async (
      key: string,
      type: 'GOVERNMENT' | 'NGO',
      members: Array<[string, 'OWNER' | 'ADMIN' | 'MEMBER']>,
      bbox?: number[],
    ) => {
      const created = await prisma.organization.create({
        data: {
          name: `E2E Proj ${key}`,
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
      if (bbox) {
        const [w, s, e, n] = bbox;
        await prisma.$executeRaw`
          UPDATE organizations
          SET "jurisdictionBoundary" = ST_Multi(ST_MakeEnvelope(${w}, ${s}, ${e}, ${n}, 4326))::geography
          WHERE id = ${created.id}::uuid`;
      }
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
    await org('pune', 'GOVERNMENT', [[government.id, 'OWNER']], PUNE);
    await org('nagpur', 'GOVERNMENT', [[users.gov2!, 'OWNER']], NAGPUR);
    await org('ngo', 'NGO', [
      [users.owner!, 'OWNER'],
      [users.admin!, 'ADMIN'],
      [users.member!, 'MEMBER'],
      [users.member2!, 'MEMBER'],
    ]);
    await org('other', 'NGO', [[users.other!, 'OWNER']]);

    for (const key of ['proj', 'rollback']) {
      const created = await prisma.problem.create({
        data: {
          reporterId,
          title: `${TITLE}${key} broken culvert`,
          description: `${key} — created by the projects e2e suite.`,
          category: 'DRAINAGE',
          severity: 'HIGH',
          status: 'VERIFIED',
          latitude: 18.53,
          longitude: 73.85,
          address: 'Culvert Road',
          city: 'Pune',
          state: 'Maharashtra',
        },
      });
      problems[key] = { id: created.id, publicId: created.publicId };
    }

    await clearRateLimits();
    cookies.official = await loginAs('government@samadhaan.dev');
    cookies.citizen = await loginAs('citizen@samadhaan.dev');
    for (const key of ['gov2', 'owner', 'admin', 'member', 'member2', 'other']) {
      cookies[key] = await loginAs(EMAIL(key));
    }
  });

  beforeEach(clearRateLimits);

  afterAll(async () => {
    if (prisma) await cleanUp();
    await app?.close();
  });

  async function cleanUp(): Promise<void> {
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS e2e_project_fail ON resolution_projects',
    );
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS e2e_project_fail()');
    const ids = (
      await prisma.problem.findMany({
        where: { title: { startsWith: TITLE } },
        select: { id: true },
      })
    ).map((row) => row.id);
    const rooms = await prisma.resolutionRoom.findMany({
      where: { problemId: { in: ids } },
      select: { id: true, project: { select: { id: true } } },
    });
    const roomIds = rooms.map((room) => room.id);
    const projectIds = rooms.flatMap((room) => (room.project ? [room.project.id] : []));
    const allocations = await prisma.problemAllocation.findMany({
      where: { problemId: { in: ids } },
      select: { id: true },
    });
    const files = await prisma.resolutionAttachment.findMany({
      where: { roomId: { in: roomIds } },
      select: { storageKey: true },
    });
    for (const file of files) await storage.delete(file.storageKey);
    await prisma.notification.deleteMany({
      where: {
        entityId: {
          in: [...ids, ...roomIds, ...projectIds, ...allocations.map((a) => a.id)],
        },
      },
    });
    await deleteAuditLogs(prisma, {
      entityId: { in: [...ids, ...roomIds, ...projectIds] },
    });
    await prisma.resolutionRoom.deleteMany({ where: { id: { in: roomIds } } });
    await prisma.problemAllocation.deleteMany({ where: { problemId: { in: ids } } });
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
  });
  const p = (path = '') => `/resolution-projects/${projectId}${path}`;

  async function accept(key: string): Promise<request.Response> {
    const created = await api('official')
      .post(`/government/${PREFIX}pune/problems/${problems[key]!.publicId}/allocations`, {
        organizationId: orgs.ngo,
      })
      .expect(201);
    return api('owner').post(
      `/organizations/${PREFIX}ngo/allocations/${created.body.data.id}/accept`,
    );
  }

  function createTask(body: Record<string, unknown>, as = 'admin') {
    return api(as).post(p('/tasks'), { title: 'Task', ...body });
  }

  async function project(as = 'owner') {
    return (await api(as).get(p()).expect(200)).body.data;
  }

  const today = projectToday();
  const tomorrow = projectToday(new Date(Date.now() + 86_400_000));

  // ================================================================ creation

  describe('project creation', () => {
    it('rolls the whole acceptance back when the project cannot be created', async () => {
      await prisma.$executeRawUnsafe(`
        CREATE FUNCTION e2e_project_fail() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW."problemId" = '${problems.rollback!.id}'::uuid THEN
            RAISE EXCEPTION 'simulated project failure';
          END IF;
          RETURN NEW;
        END $$;`);
      await prisma.$executeRawUnsafe(
        'CREATE TRIGGER e2e_project_fail BEFORE INSERT ON resolution_projects FOR EACH ROW EXECUTE FUNCTION e2e_project_fail()',
      );
      try {
        expect((await accept('rollback')).status).toBe(500);
      } finally {
        await prisma.$executeRawUnsafe(
          'DROP TRIGGER e2e_project_fail ON resolution_projects',
        );
        await prisma.$executeRawUnsafe('DROP FUNCTION e2e_project_fail()');
      }
      const allocation = await prisma.problemAllocation.findFirstOrThrow({
        where: { problemId: problems.rollback!.id },
      });
      expect(allocation.status).toBe('PENDING');
      expect(
        (await prisma.problem.findUniqueOrThrow({ where: { id: problems.rollback!.id } }))
          .status,
      ).toBe('VERIFIED');
      expect(
        await prisma.resolutionRoom.count({
          where: { problemId: problems.rollback!.id },
        }),
      ).toBe(0);
    });

    it('creates a planned project with the room, named from the problem', async () => {
      const response = await accept('proj');
      expect(response.status).toBe(200);
      roomId = response.body.data.roomId;

      const view = (
        await api('owner').get(`/resolution-rooms/${roomId}/project`).expect(200)
      ).body.data;
      projectId = view.id;
      expect(view).toMatchObject({
        roomId,
        status: 'PLANNED',
        name: `Resolve: ${TITLE}proj broken culvert`,
        description: `Resolution project for "${TITLE}proj broken culvert", reported at Culvert Road, Pune.`,
        startDate: today,
        targetDate: null,
        problem: { publicId: problems.proj!.publicId },
        overview: { taskProgress: 0, tasks: { total: 0 }, milestoneProgress: 0 },
        permissions: { canManage: true, allowedTransitions: ['ACTIVE', 'CANCELLED'] },
      });
      expect(
        await prisma.resolutionRoomEvent.count({
          where: { roomId, type: 'PROJECT_CREATED' },
        }),
      ).toBe(1);
    });

    it('allows one project per room, matching it', async () => {
      const existing = await prisma.resolutionProject.findUniqueOrThrow({
        where: { id: projectId },
      });
      const { id: _id, createdAt: _c, updatedAt: _u, ...data } = existing;
      await expect(prisma.resolutionProject.create({ data })).rejects.toMatchObject({
        code: 'P2002',
      });
    });
  });

  // =========================================================== authorisation

  describe('who may see and manage', () => {
    it.each([
      ['owner', true],
      ['admin', true],
      ['member', false],
      ['official', false],
    ])('%s sees it (manage: %s)', async (who, canManage) => {
      expect((await project(who)).permissions.canManage).toBe(canManage);
    });

    it.each(['other', 'gov2', 'citizen'])('answers 404 to %s', async (who) => {
      await api(who).get(p()).expect(404);
      await api(who).get(p('/tasks')).expect(404);
      await api(who).get(`/resolution-rooms/${roomId}/project`).expect(404);
      await createTask({ title: 'x' }, who).expect(404);
    });

    it('lets government read and rename, but not plan', async () => {
      await createTask({ title: 'Government task' }, 'official').expect(403);
      const version = (await project()).version;
      await api('official').patch(p(), { version, startDate: '2026-01-01' }).expect(403);
      const renamed = await api('official')
        .patch(p(), { version, name: 'Resolve: culvert collapse on Culvert Road' })
        .expect(200);
      expect(renamed.body.data.name).toBe('Resolve: culvert collapse on Culvert Road');
      await api('official').post(p('/status'), { status: 'ACTIVE' }).expect(403);
    });

    it('does not let a member plan', async () => {
      await createTask({ title: 'Member task' }, 'member').expect(403);
      await api('member').post(p('/milestones'), { title: 'M' }).expect(403);
    });

    it('refuses client-supplied ownership fields', async () => {
      for (const extra of [
        { projectId: '00000000-0000-4000-8000-000000000000' },
        { createdById: users.member },
        { organizationId: orgs.other },
        { status: 'COMPLETED' },
      ]) {
        await createTask({ title: 'Sneaky', ...extra }).expect(400);
      }
    });
  });

  // ================================================================== tasks

  describe('tasks', () => {
    let inspect: { id: string; version: number };

    it('assigns only to active members of the assigned organisation', async () => {
      await createTask({ title: 'x', assignedToId: users.other }).expect(400);
      await createTask({ title: 'x', assignedToId: officialId }).expect(400);
      await createTask({ title: 'x', dueDate: '2020-01-01' }).expect(400);
      await createTask({ title: 'x', dueDate: '2026-13-40' }).expect(400);
      await createTask({ title: '   ' }).expect(400);
    });

    it('creates a task and tells the assignee', async () => {
      const response = await createTask({
        title: 'Inspect affected culvert',
        description: 'Measure the collapse.',
        assignedToId: users.member,
        dueDate: tomorrow,
        priority: 'HIGH',
      }).expect(201);
      inspect = { id: response.body.data.id, version: response.body.data.version };
      expect(response.body.data).toMatchObject({
        status: 'TODO',
        priority: 'HIGH',
        assignee: { userId: users.member },
        dueDate: tomorrow,
        overdue: false,
      });
      await bus.drain();
      const note = await prisma.notification.findFirstOrThrow({
        where: {
          recipientId: users.member,
          type: 'PROJECT_TASK_ASSIGNED',
          entityId: projectId,
        },
      });
      expect(note.message).toContain('Inspect affected culvert');
    });

    it('enforces the task state machine', async () => {
      await api('admin')
        .post(p(`/tasks/${inspect.id}/status`), { status: 'COMPLETED' })
        .expect(409);
      await api('admin')
        .post(p(`/tasks/${inspect.id}/status`), { status: 'DONE' })
        .expect(400);
    });

    it('lets the assignee move their own task — and starting work starts the project', async () => {
      await api('member2')
        .post(p(`/tasks/${inspect.id}/status`), { status: 'IN_PROGRESS' })
        .expect(403);
      const started = await api('member')
        .post(p(`/tasks/${inspect.id}/status`), { status: 'IN_PROGRESS' })
        .expect(200);
      expect(started.body.data.allowedTransitions).toEqual(['BLOCKED', 'COMPLETED']);
      expect((await project()).status).toBe('ACTIVE');
      await api('member')
        .post(p(`/tasks/${inspect.id}/status`), { status: 'CANCELLED' })
        .expect(403);
      await api('official')
        .post(p(`/tasks/${inspect.id}/status`), { status: 'BLOCKED' })
        .expect(403);
    });

    it('refuses a stale edit', async () => {
      const fresh = (
        await api('admin')
          .get(p(`/tasks/${inspect.id}`))
          .expect(200)
      ).body.data;
      await api('admin')
        .patch(p(`/tasks/${inspect.id}`), {
          version: fresh.version,
          priority: 'CRITICAL',
        })
        .expect(200);
      await api('admin')
        .patch(p(`/tasks/${inspect.id}`), { version: fresh.version, priority: 'LOW' })
        .expect(409);
    });

    it('lets only one of two simultaneous completions through', async () => {
      const [a, b] = await Promise.all([
        api('member').post(p(`/tasks/${inspect.id}/status`), { status: 'COMPLETED' }),
        api('admin').post(p(`/tasks/${inspect.id}/status`), { status: 'COMPLETED' }),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      const row = await prisma.resolutionTask.findUniqueOrThrow({
        where: { id: inspect.id },
      });
      expect(row.status).toBe('COMPLETED');
      expect(row.completedAt).not.toBeNull();
    });

    it('lets only one of two simultaneous edits through', async () => {
      const task = (await createTask({ title: 'Order materials' }).expect(201)).body.data;
      const [a, b] = await Promise.all([
        api('admin').patch(p(`/tasks/${task.id}`), {
          version: task.version,
          title: 'Order cement',
        }),
        api('owner').patch(p(`/tasks/${task.id}`), {
          version: task.version,
          title: 'Order pipes',
        }),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
    });

    it('never reopens a completed task', async () => {
      await api('admin')
        .post(p(`/tasks/${inspect.id}/status`), { status: 'IN_PROGRESS' })
        .expect(409);
      await api('admin')
        .patch(p(`/tasks/${inspect.id}`), { version: 99, title: 'x' })
        .expect(409);
    });

    it('tells the creator when someone else completes their task', async () => {
      await bus.drain();
      const completedNotes = await prisma.notification.findMany({
        where: { type: 'PROJECT_TASK_COMPLETED', entityId: projectId },
        select: { recipientId: true },
      });
      // The admin created it; only a completion by someone else notifies.
      const winner = await prisma.resolutionTask.findUniqueOrThrow({
        where: { id: inspect.id },
      });
      expect(completedNotes.map((n) => n.recipientId)).toEqual(
        winner.completedById === users.admin ? [] : [users.admin],
      );
    });

    it('filters tasks on the server', async () => {
      const all = (await api('member').get(p('/tasks')).expect(200)).body.data;
      expect(all.totalCount).toBeGreaterThanOrEqual(2);
      const done = (await api('member').get(p('/tasks?status=COMPLETED')).expect(200))
        .body.data;
      expect(done.items.map((t: { id: string }) => t.id)).toEqual([inspect.id]);
      const mine = (await api('member').get(p('/tasks?assignee=me')).expect(200)).body
        .data;
      expect(
        mine.items.every(
          (t: { assignee: { userId: string } }) => t.assignee.userId === users.member,
        ),
      ).toBe(true);
      const critical = (
        await api('member').get(p('/tasks?priority=CRITICAL,HIGH')).expect(200)
      ).body.data;
      expect(critical.items.map((t: { id: string }) => t.id)).toContain(inspect.id);
      await api('member').get(p('/tasks?status=NOPE')).expect(400);
    });
  });

  // ================================================================ progress

  describe('progress', () => {
    it('is completed ÷ non-cancelled tasks, from real data', async () => {
      const extra = (await createTask({ title: 'Clear debris' }).expect(201)).body.data;
      await api('admin')
        .post(p(`/tasks/${extra.id}/status`), { status: 'CANCELLED' })
        .expect(200);

      const counts = await prisma.resolutionTask.groupBy({
        by: ['status'],
        where: { projectId },
        _count: { _all: true },
      });
      const n = (s: string) => counts.find((c) => c.status === s)?._count._all ?? 0;
      const total = counts.reduce((sum, c) => sum + c._count._all, 0);
      const expected = Math.floor((n('COMPLETED') / (total - n('CANCELLED'))) * 100);

      const view = await project();
      expect(view.overview.tasks).toMatchObject({
        total,
        completed: n('COMPLETED'),
        cancelled: n('CANCELLED'),
      });
      expect(view.overview.taskProgress).toBe(expected);
    });

    it('computes overdue from dates', async () => {
      const version = (await project()).version;
      await api('owner').patch(p(), { version, startDate: '2026-01-01' }).expect(200);
      const late = (
        await createTask({ title: 'Permit application', dueDate: '2026-01-05' }).expect(
          201,
        )
      ).body.data;
      expect(late.overdue).toBe(true);
      const view = await project();
      expect(view.overview.tasks.overdue).toBeGreaterThanOrEqual(1);
      const overdue = (await api('owner').get(p('/tasks?overdue=true')).expect(200)).body
        .data;
      expect(overdue.items.map((t: { id: string }) => t.id)).toContain(late.id);
      // A target before the start is refused.
      await api('owner')
        .patch(p(), { version: view.version, targetDate: '2025-12-01' })
        .expect(400);
    });
  });

  // ============================================================== milestones

  describe('milestones', () => {
    let milestoneId: string;

    it('creates milestones and derives their status', async () => {
      const list = (
        await api('admin')
          .post(p('/milestones'), { title: 'Site inspection', dueDate: tomorrow })
          .expect(201)
      ).body.data;
      milestoneId = list.find((m: { title: string }) => m.title === 'Site inspection').id;
      const overdue = (
        await api('admin')
          .post(p('/milestones'), { title: 'Survey', dueDate: '2026-01-10' })
          .expect(201)
      ).body.data.find((m: { title: string }) => m.title === 'Survey');
      expect(overdue.status).toBe('OVERDUE');
      expect(list.find((m: { id: string }) => m.id === milestoneId).status).toBe(
        'UPCOMING',
      );
    });

    it('groups tasks, and completes only when none is open', async () => {
      const task = (
        await createTask({
          title: 'Schedule site visit',
          milestoneId,
          assignedToId: users.member,
        })
      ).body.data;
      await api('admin')
        .post(p(`/milestones/${milestoneId}/complete`))
        .expect(409);

      await api('member')
        .post(p(`/tasks/${task.id}/status`), { status: 'IN_PROGRESS' })
        .expect(200);
      let list = (await api('member').get(p('/milestones')).expect(200)).body.data;
      expect(list.find((m: { id: string }) => m.id === milestoneId)).toMatchObject({
        status: 'IN_PROGRESS',
        tasks: { total: 1, open: 1 },
      });
      await api('member')
        .post(p(`/tasks/${task.id}/status`), { status: 'COMPLETED' })
        .expect(200);

      list = (
        await api('admin')
          .post(p(`/milestones/${milestoneId}/complete`))
          .expect(200)
      ).body.data;
      expect(list.find((m: { id: string }) => m.id === milestoneId)).toMatchObject({
        status: 'COMPLETED',
        progress: 100,
      });
      await api('admin')
        .post(p(`/milestones/${milestoneId}/complete`))
        .expect(409);
      await createTask({ title: 'Late addition', milestoneId }).expect(400);
    });

    it('tells the other participants, not the actor', async () => {
      await bus.drain();
      const recipients = (
        await prisma.notification.findMany({
          where: { type: 'PROJECT_MILESTONE_COMPLETED', entityId: projectId },
          select: { recipientId: true },
        })
      ).map((n) => n.recipientId);
      expect(recipients).toContain(officialId);
      expect(recipients).toContain(users.member);
      expect(recipients).not.toContain(users.admin);
      expect(recipients).not.toContain(users.other);
    });

    it('can be reopened by a manager only', async () => {
      await api('member')
        .post(p(`/milestones/${milestoneId}/reopen`))
        .expect(403);
      await api('admin')
        .post(p(`/milestones/${milestoneId}/reopen`))
        .expect(200);
      const view = await project();
      expect(view.overview.milestones.total).toBe(2);
    });
  });

  // =========================================================== attachments

  describe('task attachments', () => {
    it('references a room file the assignee can see', async () => {
      const png = await sharp({
        create: { width: 32, height: 32, channels: 3, background: { r: 1, g: 2, b: 3 } },
      })
        .png()
        .toBuffer();
      const upload = await request(server)
        .post(`/api/v1/resolution-rooms/${roomId}/attachments`)
        .set('Cookie', cookies.member!)
        .attach('file', png, 'culvert.png')
        .expect(201);
      const task = (
        await createTask({ title: 'Photo the culvert', assignedToId: users.member })
      ).body.data;
      const linked = await api('member')
        .post(p(`/tasks/${task.id}/attachments`), { attachmentId: upload.body.data.id })
        .expect(200);
      expect(
        linked.body.data.attachments.map((a: { fileName: string }) => a.fileName),
      ).toEqual(['culvert.png']);
      await api('member2')
        .post(p(`/tasks/${task.id}/attachments`), { attachmentId: upload.body.data.id })
        .expect(403);
      await api('member')
        .post(p(`/tasks/${task.id}/attachments`), {
          attachmentId: '00000000-0000-4000-8000-000000000000',
        })
        .expect(400);
    });
  });

  // ============================================================== lifecycle

  describe('project lifecycle', () => {
    it('requires open tasks to be finished before completion', async () => {
      await api('owner').post(p('/status'), { status: 'COMPLETED' }).expect(409);
    });

    it('pauses work: no progress until resumed', async () => {
      const task = (await createTask({ title: 'Lay pipes', assignedToId: users.member }))
        .body.data;
      await api('owner').post(p('/status'), { status: 'PAUSED' }).expect(200);
      await api('member')
        .post(p(`/tasks/${task.id}/status`), { status: 'IN_PROGRESS' })
        .expect(409);
      await api('owner').post(p('/status'), { status: 'COMPLETED' }).expect(409);
      await api('owner').post(p('/status'), { status: 'ACTIVE' }).expect(200);
    });

    it('lets only one of two simultaneous status changes through', async () => {
      const [a, b] = await Promise.all([
        api('owner').post(p('/status'), { status: 'PAUSED' }),
        api('admin').post(p('/status'), { status: 'PAUSED' }),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      await api('owner').post(p('/status'), { status: 'ACTIVE' }).expect(200);
    });

    it('needs a reason to cancel, and a cancelled project is final', async () => {
      await api('owner').post(p('/status'), { status: 'CANCELLED' }).expect(400);
      await api('owner')
        .post(p('/status'), {
          status: 'CANCELLED',
          reason: 'Work taken over by the city.',
        })
        .expect(200);
      await api('owner').post(p('/status'), { status: 'ACTIVE' }).expect(409);
      await createTask({ title: 'After cancel' }).expect(409);
      expect(
        await prisma.auditLog.count({
          where: { entityId: projectId, action: 'RESOLUTION_PROJECT_STATUS_CHANGED' },
        }),
      ).toBeGreaterThanOrEqual(4);
      // The problem's own status is untouched: verification is a later step.
      expect(
        (await prisma.problem.findUniqueOrThrow({ where: { id: problems.proj!.id } }))
          .status,
      ).toBe('IN_PROGRESS');
    });

    it('notified participants of status changes, never the actor', async () => {
      await bus.drain();
      const notes = await prisma.notification.findMany({
        where: { type: 'PROJECT_STATUS_CHANGED', entityId: projectId },
        select: { recipientId: true, message: true },
      });
      expect(notes.some((n) => n.recipientId === officialId)).toBe(true);
      expect(notes.some((n) => n.recipientId === users.other)).toBe(false);
    });
  });

  // ======================================================= activity, misc

  describe('activity, dashboards and reminders', () => {
    it('records structured project activity, kept out of the room timeline', async () => {
      const page = (await api('official').get(p('/activity')).expect(200)).body.data;
      const kinds = page.items.map((e: { kind: string }) => e.kind);
      expect(kinds).toEqual(
        expect.arrayContaining([
          'PROJECT_STATUS_CHANGED',
          'TASK_CREATED',
          'TASK_ASSIGNED',
          'TASK_STATUS_CHANGED',
          'MILESTONE_COMPLETED',
        ]),
      );
      expect(page.nextCursor).not.toBeNull();
      const older = (
        await api('official')
          .get(p(`/activity?cursor=${page.nextCursor}`))
          .expect(200)
      ).body.data;
      expect(older.items[0].id).not.toBe(page.items.at(-1).id);

      const room = (
        await api('official').get(`/resolution-rooms/${roomId}/activity`).expect(200)
      ).body.data;
      expect(room.some((e: { kind: string }) => e.kind.startsWith('TASK_'))).toBe(false);
    });

    it('shows live projects on both dashboards', async () => {
      const second = await prisma.problem.create({
        data: {
          reporterId: (
            await prisma.user.findUniqueOrThrow({
              where: { email: 'citizen@samadhaan.dev' },
            })
          ).id,
          title: `${TITLE}dash drain`,
          description: 'Dashboard probe.',
          category: 'DRAINAGE',
          severity: 'LOW',
          status: 'VERIFIED',
          latitude: 18.52,
          longitude: 73.84,
          city: 'Pune',
        },
      });
      problems.dash = { id: second.id, publicId: second.publicId };
      const accepted = await accept('dash');
      const live = (
        await api('owner').get(`/resolution-rooms/${accepted.body.data.roomId}/project`)
      ).body.data;

      const org = (
        await api('member').get(`/organizations/${PREFIX}ngo/dashboard`).expect(200)
      ).body.data;
      expect(org.projects.map((x: { id: string }) => x.id)).toContain(live.id);
      expect(org.projects.map((x: { id: string }) => x.id)).not.toContain(projectId);

      const gov = (
        await api('official')
          .get(`/government/${PREFIX}pune/dashboard?range=7`)
          .expect(200)
      ).body.data;
      expect(gov.metrics.activeProjects).toBe(1);
      expect(gov.projects[0]).toMatchObject({
        id: live.id,
        overview: { taskProgress: 0 },
      });

      const other = (
        await api('other').get(`/organizations/${PREFIX}other/dashboard`).expect(200)
      ).body.data;
      expect(other.projects).toEqual([]);
    });

    it('reminds assignees once of tasks due soon', async () => {
      const dash = await prisma.resolutionProject.findFirstOrThrow({
        where: { problemId: problems.dash!.id },
      });
      projectId = dash.id;
      const task = (
        await createTask({
          title: 'Clean the drain',
          assignedToId: users.member2,
          dueDate: tomorrow,
        })
      ).body.data;
      const reminders = app.get(ProjectRemindersService);
      expect(await reminders.sweep()).toBeGreaterThanOrEqual(1);
      await reminders.sweep();
      await bus.drain();
      const notes = await prisma.notification.findMany({
        where: { recipientId: users.member2, type: 'PROJECT_TASK_DUE_SOON' },
      });
      expect(notes).toHaveLength(1);
      expect(notes[0]!.message).toContain(task.title);
    });
  });
});
