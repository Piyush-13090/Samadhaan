import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { err, ok } from '@samadhaan/shared';
import { AppModule } from '../src/app.module.js';
import { AiClient, AiRequestError } from '../src/ai/ai.client.js';
import type { CoordinatorContext } from '../src/ai/dto/coordinator.dto.js';
import { configureApp, registerNotFoundHandler } from '../src/bootstrap.js';
import { CoordinatorSchedulerService } from '../src/coordinator/coordinator-scheduler.service.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { DomainEventBus } from '../src/events/domain-event-bus.js';
import { RedisService } from '../src/redis/redis.service.js';
import { deleteAuditLogs } from './audit-maintenance.js';

/**
 * AI Project Coordinator (Prompt 19) end to end.
 *
 * Only the transport is faked (`AiClient`): the real `AiService` parses and
 * grounds every response, so validation is exercised for real. The fake
 * records each context it was sent, for the privacy assertions.
 */
type Responder = (path: string, body: unknown) => ReturnType<AiClient['post']>;

describe('AI Project Coordinator (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let bus: DomainEventBus;
  let server: Parameters<typeof request>[0];

  const PASSWORD = 'DevPassword123!';
  const PREFIX = 'e2e-coord-';
  const TITLE = 'Coordinator probe ';
  const EMAIL = (key: string) => `${PREFIX}${key}@samadhaan.test`;
  const PUNE = [73.7, 18.4, 74.0, 18.65];
  const NAGPUR = [78.95, 21.05, 79.2, 21.25];

  const sent: Array<{ path: string; body: unknown }> = [];
  let respond: Responder;

  const orgs: Record<string, string> = {};
  const users: Record<string, string> = {};
  const cookies: Record<string, string[]> = {};
  let officialId: string;
  let problemId: string;
  let roomId: string;
  let projectId: string;
  const tasks: Record<string, string> = {};

  /** A well-formed result built from whatever context arrived. */
  function goodResult(
    context: CoordinatorContext,
    overrides: Record<string, unknown> = {},
  ) {
    const overdue = context.tasks.find((t) => t.overdue) ?? context.tasks[0]!;
    return {
      summary: `The project is ${context.baseline.health.toLowerCase()}; “${overdue.title}” needs an update.`,
      health: context.baseline.health,
      health_reason: context.baseline.reasons.join('; ') || 'No warning signals.',
      risks: [
        {
          type: 'OVERDUE_TASK',
          severity: 'HIGH',
          title: `${overdue.title} needs attention`,
          description: 'Grounded in the task.',
          source_refs: [overdue.ref],
        },
        {
          type: 'OTHER',
          severity: 'HIGH',
          title: 'Government approval missing',
          description: 'Invented by the model.',
          source_refs: ['permit:42', 'task:00000000-0000-4000-8000-000000000000'],
        },
      ],
      potential_blockers: [],
      suggestions: [
        {
          text: `Ask for a status update on ${overdue.title}.`,
          source_refs: [overdue.ref],
        },
      ],
      questions: [
        {
          question: `Was “${overdue.title}” completed? If not, what is preventing completion?`,
          category: 'TASK_PROGRESS',
          target_ref: overdue.ref,
          source_refs: [overdue.ref],
        },
      ],
      provider: 'fake',
      model_name: 'fake-coordinator',
      model_version: '2026-10-01',
      prompt_version: 'coordinator-2026-10-v1',
      processing_ms: 42,
      dropped_items: 0,
      ...overrides,
    };
  }

  const fakeClient = {
    post: (path: string, body: unknown) => {
      sent.push({ path, body });
      return respond(path, body);
    },
    get: async () => err(new Error('not used')),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AiClient)
      .useValue(fakeClient)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    registerNotFoundHandler(app);
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    bus = app.get(DomainEventBus);

    await cleanUp();

    const government = await prisma.user.findUniqueOrThrow({
      where: { email: 'government@samadhaan.dev' },
    });
    officialId = government.id;
    const reporterId = (
      await prisma.user.findUniqueOrThrow({ where: { email: 'citizen@samadhaan.dev' } })
    ).id;
    for (const [key, role, name] of [
      ['gov2', 'GOVERNMENT', 'Second Official'],
      ['owner', 'NGO', 'Neha Kapoor'],
      ['member', 'NGO', 'Aarav Sharma'],
      ['other', 'NGO', 'Other Owner'],
    ] as const) {
      users[key] = (
        await prisma.user.create({
          data: {
            email: EMAIL(key),
            passwordHash: government.passwordHash,
            fullName: name,
            role,
            status: 'ACTIVE',
          },
        })
      ).id;
    }

    const org = async (
      key: string,
      type: 'GOVERNMENT' | 'NGO',
      members: Array<[string, 'OWNER' | 'MEMBER']>,
      bbox?: number[],
    ) => {
      const created = await prisma.organization.create({
        data: {
          name: `E2E Coord ${key}`,
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
        await prisma.$executeRaw`UPDATE organizations SET "jurisdictionBoundary" = ST_Multi(ST_MakeEnvelope(${w}, ${s}, ${e}, ${n}, 4326))::geography WHERE id = ${created.id}::uuid`;
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
      [users.member!, 'MEMBER'],
    ]);
    await org('other', 'NGO', [[users.other!, 'OWNER']]);

    const problem = await prisma.problem.create({
      data: {
        reporterId,
        title: `${TITLE}pothole near the depot`,
        description: 'A deep pothole near the bus depot.',
        category: 'POTHOLES',
        severity: 'HIGH',
        status: 'VERIFIED',
        latitude: 18.53,
        longitude: 73.85,
        address: 'Depot Road',
        city: 'Pune',
      },
    });
    problemId = problem.id;
    // Government-only facts that must never reach the model.
    await prisma.problemInternalNote.create({
      data: {
        problemId,
        organizationId: orgs.pune!,
        authorId: officialId,
        body: 'SECRET-INTERNAL-NOTE budget code 7731',
      },
    });

    await clearKeys();
    cookies.official = await loginAs('government@samadhaan.dev');
    cookies.citizen = await loginAs('citizen@samadhaan.dev');
    for (const key of ['gov2', 'owner', 'member', 'other'])
      cookies[key] = await loginAs(EMAIL(key));

    const allocation = await api('official')
      .post(`/government/${PREFIX}pune/problems/${problem.publicId}/allocations`, {
        organizationId: orgs.ngo,
        internalReason: 'SECRET-ALLOCATION-REASON',
      })
      .expect(201);
    const accepted = await api('owner')
      .post(`/organizations/${PREFIX}ngo/allocations/${allocation.body.data.id}/accept`)
      .expect(200);
    roomId = accepted.body.data.roomId;
    projectId = (
      await api('owner').get(`/resolution-rooms/${roomId}/project`).expect(200)
    ).body.data.id;
  });

  beforeEach(async () => {
    await clearKeys();
    respond = async (path, body) =>
      path === '/coordinator/analyze'
        ? ok(goodResult(body as CoordinatorContext))
        : ok({
            summary: 'Inspection done; materials being ordered.',
            completed: ['Site inspection'],
            current: ['Material procurement'],
            blockers: [],
            next_steps: ['Begin repair'],
            provider: 'fake',
            model_name: 'fake-extractor',
            model_version: '1',
            prompt_version: 'update-extract-2026-10-v1',
          });
  });

  afterAll(async () => {
    if (prisma) await cleanUp();
    await app?.close();
  });

  async function cleanUp(): Promise<void> {
    const ids = (
      await prisma.problem.findMany({
        where: { title: { startsWith: TITLE } },
        select: { id: true },
      })
    ).map((r) => r.id);
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
    const all = [...ids, ...roomIds, ...projectIds, ...allocations];
    await prisma.notification.deleteMany({ where: { entityId: { in: all } } });
    await deleteAuditLogs(prisma, { entityId: { in: all } });
    await prisma.resolutionRoom.deleteMany({ where: { id: { in: roomIds } } });
    await prisma.problemAllocation.deleteMany({ where: { problemId: { in: ids } } });
    await prisma.problemInternalNote.deleteMany({ where: { problemId: { in: ids } } });
    await prisma.problem.deleteMany({ where: { id: { in: ids } } });
    await prisma.organization.deleteMany({ where: { slug: { startsWith: PREFIX } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
  }

  async function clearKeys(): Promise<void> {
    const keys = [
      ...(await redis.connection.keys('ratelimit:*')),
      ...(await redis.connection.keys('coordinator:*')),
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

  function api(as: string) {
    return {
      get: (path: string) =>
        request(server).get(`/api/v1${path}`).set('Cookie', cookies[as]!),
      post: (path: string, body: object = {}) =>
        request(server).post(`/api/v1${path}`).set('Cookie', cookies[as]!).send(body),
    };
  }
  const c = (path = '') => `/resolution-projects/${projectId}/ai-coordinator${path}`;
  const lastContext = () =>
    sent.filter((s) => s.path === '/coordinator/analyze').at(-1)!
      .body as CoordinatorContext;

  // ================================================================ access

  describe('access', () => {
    it.each(['other', 'gov2', 'citizen'])('answers 404 to %s', async (who) => {
      await api(who).get(c()).expect(404);
      await api(who).post(c('/refresh')).expect(404);
      await api(who)
        .post(`/resolution-projects/${projectId}/updates`, { summary: 'x' })
        .expect(404);
    });

    it('shows live health before any AI has run, without calling it', async () => {
      const before = sent.length;
      const view = (await api('member').get(c()).expect(200)).body.data;
      expect(view).toMatchObject({
        health: { level: 'HEALTHY' },
        insight: null,
        questions: [],
      });
      expect(sent.length).toBe(before);
    });
  });

  // ======================================================== health engine

  describe('deterministic health', () => {
    it('is computed from real tasks, with grounded reasons', async () => {
      const version = (
        await api('owner').get(`/resolution-projects/${projectId}`).expect(200)
      ).body.data.version;
      await request(server)
        .patch(`/api/v1/resolution-projects/${projectId}`)
        .set('Cookie', cookies.owner!)
        .send({ version, startDate: '2026-01-01' })
        .expect(200);
      for (const [key, due, priority] of [
        ['inspect', '2026-01-05', 'HIGH'],
        ['survey', '2026-01-06', 'MEDIUM'],
        ['repair', null, 'LOW'],
      ] as const) {
        const created = await api('owner')
          .post(`/resolution-projects/${projectId}/tasks`, {
            title: `Site ${key}`,
            assignedToId: users.member,
            dueDate: due,
            priority,
          })
          .expect(201);
        tasks[key] = created.body.data.id;
      }
      const view = (await api('official').get(c()).expect(200)).body.data;
      expect(view.health.level).toBe('AT_RISK');
      expect(view.health.reasons).toEqual(['2 tasks are overdue']);
      expect(view.risks.map((r: { origin: string }) => r.origin)).toEqual([
        'RULE',
        'RULE',
      ]);
      expect(view.risks[0].sources[0]).toMatchObject({
        kind: 'task',
        id: tasks.inspect,
        href: `/resolution/${roomId}/project#task-${tasks.inspect}`,
      });
    });
  });

  // ============================================================== refresh

  describe('refresh', () => {
    it('persists a grounded insight with model metadata, and drops invented findings', async () => {
      const view = (await api('owner').post(c('/refresh')).expect(200)).body.data;
      expect(view.insight).toMatchObject({
        health: 'AT_RISK',
        stale: false,
        model: {
          provider: 'fake',
          name: 'fake-coordinator',
          version: '2026-10-01',
          promptVersion: 'coordinator-2026-10-v1',
        },
      });
      expect(view.insight.risks.map((r: { title: string }) => r.title)).not.toContain(
        'Government approval missing',
      );
      const stored = await prisma.projectAIInsight.findFirstOrThrow({
        where: { projectId, status: 'COMPLETED' },
        orderBy: { generatedAt: 'desc' },
      });
      expect(stored).toMatchObject({
        trigger: 'MANUAL',
        requestedById: users.owner,
        baselineHealth: 'AT_RISK',
        droppedItems: 1,
      });
      expect(view.questions).toHaveLength(1);
      expect(view.questions[0]).toMatchObject({
        status: 'OPEN',
        category: 'TASK_PROGRESS',
        target: { kind: 'task' },
      });
    });

    it('sends only necessary, bounded context', async () => {
      const context = lastContext();
      const raw = JSON.stringify(context);
      for (const secret of [
        'SECRET-INTERNAL-NOTE',
        'SECRET-ALLOCATION-REASON',
        '@samadhaan',
        'passwordHash',
      ]) {
        expect(raw).not.toContain(secret);
      }
      // First names only.
      expect(context.tasks.find((t) => t.ref === `task:${tasks.inspect}`)?.assignee).toBe(
        'Aarav',
      );
      expect(context.baseline.health).toBe('AT_RISK');
      expect(Object.keys(context).sort()).toEqual(
        [
          'answered_questions',
          'baseline',
          'events',
          'knowledge',
          'messages',
          'milestones',
          'open_questions',
          'problem',
          'project',
          'project_id',
          'signals',
          'tasks',
          'today',
          'updates',
        ].sort(),
      );
    });

    it('caps messages at the configured limit', async () => {
      for (let i = 0; i < 25; i += 1) {
        await prisma.resolutionMessage.create({
          data: {
            roomId,
            authorId: users.member!,
            authorOrganizationId: orgs.ngo!,
            authorSide: 'ORGANIZATION',
            body: `Bulk message ${i}`,
          },
        });
      }
      await api('owner').post(c('/refresh')).expect(200);
      expect(lastContext().messages).toHaveLength(20);
    });

    it('is rate-limited per project', async () => {
      await api('owner').post(c('/refresh')).expect(200);
      const second = await api('official').post(c('/refresh')).expect(429);
      expect(second.body.error.message).toMatch(/Try again in/);
      const view = (await api('official').get(c()).expect(200)).body.data;
      expect(view.refreshAvailableAt).not.toBeNull();
    });

    it('never changes project state', async () => {
      const before = await prisma.resolutionTask.findMany({
        where: { projectId },
        orderBy: { id: 'asc' },
      });
      const project = await prisma.resolutionProject.findUniqueOrThrow({
        where: { id: projectId },
      });
      await api('owner').post(c('/refresh')).expect(200);
      expect(
        await prisma.resolutionTask.findMany({
          where: { projectId },
          orderBy: { id: 'asc' },
        }),
      ).toEqual(before);
      expect(
        (await prisma.resolutionProject.findUniqueOrThrow({ where: { id: projectId } }))
          .version,
      ).toBe(project.version);
    });

    it('records a failure and keeps the previous insight when output is malformed', async () => {
      const previous = (await api('owner').get(c()).expect(200)).body.data.insight;
      respond = async () => ok({ summary: 'x', health: 'NOT_A_HEALTH' });
      await api('owner').post(c('/refresh')).expect(503);
      const view = (await api('owner').get(c()).expect(200)).body.data;
      expect(view.insight.generatedAt).toBe(previous.generatedAt);
      expect(view.lastFailure).not.toBeNull();
      expect(
        await prisma.projectAIInsight.count({
          where: { projectId, status: 'FAILED', failureCode: 'INVALID_MODEL_OUTPUT' },
        }),
      ).toBe(1);
    });

    it('rejects a model that lowers health below the baseline', async () => {
      respond = async (_path, body) =>
        ok(goodResult(body as CoordinatorContext, { health: 'HEALTHY' }));
      await api('owner').post(c('/refresh')).expect(503);
    });

    it('handles provider failure', async () => {
      respond = async () =>
        err(
          new AiRequestError('down', 503, {
            code: 'PROVIDER_UNAVAILABLE',
            message: 'AI analysis is not configured on this server.',
            retryable: false,
          }),
        );
      await api('owner').post(c('/refresh')).expect(503);
    });

    it('marks the insight stale when the project changes', async () => {
      await api('owner').post(c('/refresh')).expect(200);
      expect((await api('owner').get(c()).expect(200)).body.data.insight.stale).toBe(
        false,
      );
      await api('member')
        .post(`/resolution-projects/${projectId}/tasks/${tasks.repair}/status`, {
          status: 'IN_PROGRESS',
        })
        .expect(200);
      expect((await api('owner').get(c()).expect(200)).body.data.insight.stale).toBe(
        true,
      );
    });
  });

  // ============================================================ questions

  describe('questions', () => {
    let questionId: string;

    it('does not ask the same question twice', async () => {
      const open = await prisma.coordinatorQuestion.findMany({
        where: { projectId, status: 'OPEN' },
      });
      expect(open).toHaveLength(1);
      questionId = open[0]!.id;
    });

    it('records an answer from a participant, once', async () => {
      await api('official')
        .post(c(`/questions/${questionId}/answer`), {})
        .expect(400);
      const view = (
        await api('member')
          .post(c(`/questions/${questionId}/answer`), {
            quick: 'NOT_YET',
            answer: 'Waiting for the road permit.',
          })
          .expect(200)
      ).body.data;
      const answered = view.questions.find((q: { id: string }) => q.id === questionId);
      expect(answered).toMatchObject({
        status: 'ANSWERED',
        answer: 'Not yet. Waiting for the road permit.',
        answeredBy: { name: 'Aarav Sharma' },
      });
      await api('owner')
        .post(c(`/questions/${questionId}/answer`), { answer: 'again' })
        .expect(409);
    });

    it('feeds answers into the next analysis, and does not re-ask', async () => {
      await api('owner').post(c('/refresh')).expect(200);
      const context = lastContext();
      expect(context.answered_questions.map((q) => q.answer)).toContain(
        'Not yet. Waiting for the road permit.',
      );
      // Same fingerprint, answered within the cool-down: not asked again.
      expect(
        await prisma.coordinatorQuestion.count({ where: { projectId, status: 'OPEN' } }),
      ).toBe(0);
    });

    it('lets coordinators dismiss, not members', async () => {
      respond = async (_path, body) => {
        const context = body as CoordinatorContext;
        const target = context.tasks.find((t) => t.ref === `task:${tasks.survey}`)!;
        return ok(
          goodResult(context, {
            questions: [
              {
                question: 'Is the survey finished?',
                category: 'TASK_PROGRESS',
                target_ref: target.ref,
                source_refs: [target.ref],
              },
            ],
          }),
        );
      };
      await api('owner').post(c('/refresh')).expect(200);
      const q = await prisma.coordinatorQuestion.findFirstOrThrow({
        where: { projectId, status: 'OPEN' },
      });
      await api('member')
        .post(c(`/questions/${q.id}/dismiss`))
        .expect(403);
      await api('official')
        .post(c(`/questions/${q.id}/dismiss`))
        .expect(200);
      expect(
        (await prisma.coordinatorQuestion.findUniqueOrThrow({ where: { id: q.id } }))
          .status,
      ).toBe('DISMISSED');
    });

    it('expires a question once its task is finished', async () => {
      respond = async (_path, body) => {
        const context = body as CoordinatorContext;
        const target = context.tasks.find((t) => t.ref === `task:${tasks.repair}`)!;
        return ok(
          goodResult(context, {
            questions: [
              {
                question: 'Has the repair started?',
                category: 'TASK_PROGRESS',
                target_ref: target.ref,
                source_refs: [target.ref],
              },
            ],
          }),
        );
      };
      await api('owner').post(c('/refresh')).expect(200);
      const q = await prisma.coordinatorQuestion.findFirstOrThrow({
        where: { projectId, status: 'OPEN' },
      });
      await api('member')
        .post(`/resolution-projects/${projectId}/tasks/${tasks.repair}/status`, {
          status: 'COMPLETED',
        })
        .expect(200);
      await api('owner').get(c()).expect(200);
      expect(
        (await prisma.coordinatorQuestion.findUniqueOrThrow({ where: { id: q.id } }))
          .status,
      ).toBe('EXPIRED');
    });
  });

  // ======================================================== notifications

  describe('notifications', () => {
    it('alerted coordinators when health first reached AT_RISK — not members, not the actor', async () => {
      await bus.drain();
      const alerts = await prisma.notification.findMany({
        where: { entityId: projectId, type: 'PROJECT_COORDINATOR_ALERT' },
        select: { recipientId: true, message: true },
      });
      const recipients = [...new Set(alerts.map((a) => a.recipientId))];
      expect(recipients).toContain(officialId);
      expect(recipients).not.toContain(users.owner); // requested the refresh
      expect(recipients).not.toContain(users.other);
      // Only once, though the project was analysed many times at AT_RISK.
      expect(alerts.filter((a) => a.recipientId === officialId)).toHaveLength(1);
      expect(alerts[0]!.message).toContain('at risk');
    });

    it('told the question’s assignee about new questions', async () => {
      await bus.drain();
      const notes = await prisma.notification.findMany({
        where: {
          entityId: projectId,
          type: 'PROJECT_COORDINATOR_QUESTION',
          recipientId: users.member,
        },
      });
      expect(notes.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ============================================================== updates

  describe('structured updates', () => {
    it('drafts from text without saving anything', async () => {
      const draft = (
        await api('member')
          .post(c('/extract-update'), {
            text: 'Inspection is done. Materials are being ordered today.',
          })
          .expect(200)
      ).body.data;
      expect(draft).toMatchObject({
        completed: ['Site inspection'],
        nextSteps: ['Begin repair'],
        confidence: null,
        model: { name: 'fake-extractor' },
      });
      expect(await prisma.projectUpdate.count({ where: { projectId } })).toBe(0);
      await api('member').post(c('/extract-update'), {}).expect(400);
      await api('official').post(c('/extract-update'), { text: 'x' }).expect(403);
    });

    it('saves only when a person confirms it', async () => {
      const posted = await api('member')
        .post(`/resolution-projects/${projectId}/updates`, {
          summary: 'Inspection done; materials being ordered.',
          completed: ['Site inspection'],
          current: ['Material procurement'],
          nextSteps: ['Begin repair on Friday'],
          source: 'AI_ASSISTED',
          aiModel: 'fake-extractor',
        })
        .expect(201);
      expect(posted.body.data).toMatchObject({
        source: 'AI_ASSISTED',
        author: { name: 'Aarav Sharma', side: 'ORGANIZATION' },
      });
      await api('official')
        .post(`/resolution-projects/${projectId}/updates`, { summary: 'From the office' })
        .expect(403);
      await api('member')
        .post(`/resolution-projects/${projectId}/updates`, {
          summary: '',
          authorId: officialId,
        })
        .expect(400);
      const list = (
        await api('official').get(`/resolution-projects/${projectId}/updates`).expect(200)
      ).body.data;
      expect(list.items).toHaveLength(1);
      expect(
        await prisma.resolutionRoomEvent.count({
          where: { roomId, type: 'PROJECT_UPDATE_POSTED' },
        }),
      ).toBe(1);
    });

    it('feeds updates to the next analysis', async () => {
      await api('owner').post(c('/refresh')).expect(200);
      expect(lastContext().updates[0]).toMatchObject({
        summary: 'Inspection done; materials being ordered.',
      });
    });
  });

  // ============================================================ scheduler

  describe('background check', () => {
    it('re-analyses only projects whose insight is out of date', async () => {
      const scheduler = app.get(CoordinatorSchedulerService);
      // Analysed moments ago: inside the minimum interval, so skipped.
      const before = await prisma.projectAIInsight.count({ where: { projectId } });
      await scheduler.sweep();
      expect(await prisma.projectAIInsight.count({ where: { projectId } })).toBe(before);
      // Pretend the last analysis was long ago and the project changed since.
      await prisma.projectAIInsight.updateMany({
        where: { projectId },
        data: {
          generatedAt: new Date('2026-01-01T00:00:00Z'),
          basedOnChangeAt: new Date('2026-01-01T00:00:00Z'),
        },
      });
      expect(await scheduler.sweep()).toBeGreaterThanOrEqual(1);
      const latest = await prisma.projectAIInsight.findFirstOrThrow({
        where: { projectId },
        orderBy: { generatedAt: 'desc' },
      });
      expect(latest).toMatchObject({ trigger: 'SCHEDULED', requestedById: null });
    });
  });
});
