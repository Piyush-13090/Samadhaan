import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp, registerNotFoundHandler } from '../src/bootstrap.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { DomainEventBus } from '../src/events/domain-event-bus.js';
import { ImpactEventHandler } from '../src/impact/impact-event.handler.js';
import { RedisService } from '../src/redis/redis.service.js';
import { StorageService } from '../src/storage/storage.types.js';
import { VerificationJobsService } from '../src/verification/verification-jobs.service.js';
import { deleteAuditLogs } from './audit-maintenance.js';

/**
 * One civic problem's whole life, end to end, through the HTTP API only.
 *
 * Nothing is faked: the real AI service (LLM_PROVIDER=development), real
 * PostgreSQL/PostGIS, Redis, storage and image processing. Prisma is used only
 * to create fixture identities (users, offices, NGOs, memberships), to read
 * state back, and to clean up. Every state transition goes through an endpoint.
 *
 *   <run>-office      government office, jurisdictionCities [CITY]       official OWNER
 *   <run>-elsewhere   government office, jurisdictionCities [OTHER_CITY] stranger OWNER
 *   <run>-ngo         NGO, VERIFIED                                       ngoOwner OWNER
 *   <run>-unrelated   NGO, VERIFIED                                       outsider OWNER
 *   reporter, neighbour: citizens
 */
describe('Civic problem journey (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let bus: DomainEventBus;
  let storage: StorageService;
  let jobs: VerificationJobsService;
  let impact: ImpactEventHandler;
  let server: Parameters<typeof request>[0];

  const PASSWORD = 'DevPassword123!';
  const SUFFIX = Date.now().toString(36);
  const RUN = `e2e-journey-${SUFFIX}`;
  const EMAIL = (key: string) => `${RUN}-${key.toLowerCase()}@samadhaan.test`;
  const SLUG = (key: string) => `${RUN}-${key}`;
  const CITY = `Journeypur${SUFFIX}`;
  const OTHER_CITY = `Elsewhereabad${SUFFIX}`;

  const users: Record<string, string> = {};
  const orgs: Record<string, string> = {};
  const cookies: Record<string, string[]> = {};
  const storedKeys: string[] = [];

  let jpeg: Buffer;
  let photoKey: string;
  let problem: { id: string; publicId: string };
  let allocationId: string;
  let roomId: string;
  let projectId: string;
  let taskId: string;
  let evidenceId: string;

  // ---------------------------------------------------------------- setup

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    registerNotFoundHandler(app);
    server = app.getHttpServer();

    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    bus = app.get(DomainEventBus);
    storage = app.get(StorageService);
    jobs = app.get(VerificationJobsService);
    impact = app.get(ImpactEventHandler);
    // Impact awarding is off under NODE_ENV=test (app.config.ts); the impact
    // suite turns it on for its own app the same way. Awards then flow from
    // the event bus exactly as in production — nothing is called directly.
    impact.activate();

    jpeg = await sharp({
      create: {
        width: 800,
        height: 600,
        channels: 3,
        background: { r: 90, g: 120, b: 200 },
      },
    })
      .jpeg()
      .toBuffer();

    const template = await prisma.user.findUniqueOrThrow({
      where: { email: 'government@samadhaan.dev' },
    });
    for (const [key, role] of [
      ['reporter', 'CITIZEN'],
      ['neighbour', 'CITIZEN'],
      ['official', 'GOVERNMENT'],
      ['stranger', 'GOVERNMENT'],
      ['ngoOwner', 'NGO'],
      ['outsider', 'NGO'],
    ] as const) {
      users[key] = (
        await prisma.user.create({
          data: {
            email: EMAIL(key),
            passwordHash: template.passwordHash,
            fullName: `Journey ${key}`,
            role,
            status: 'ACTIVE',
          },
        })
      ).id;
    }

    const org = async (
      key: string,
      type: 'GOVERNMENT' | 'NGO',
      owner: string,
      cities: string[] = [],
    ) => {
      const created = await prisma.organization.create({
        data: {
          name: `E2E Journey ${key}`,
          slug: SLUG(key),
          type,
          verificationStatus: 'VERIFIED',
          city: cities[0] ?? CITY,
          ...(type === 'GOVERNMENT'
            ? {
                jurisdictionType: 'MUNICIPAL_CORPORATION',
                jurisdictionName: `${key} area`,
                jurisdictionCities: cities,
              }
            : {}),
        },
      });
      orgs[key] = created.id;
      await prisma.organizationMember.create({
        data: {
          organizationId: created.id,
          userId: users[owner]!,
          membershipRole: 'OWNER',
          status: 'ACTIVE',
          joinedAt: new Date(),
        },
      });
    };
    await org('office', 'GOVERNMENT', 'official', [CITY]);
    await org('elsewhere', 'GOVERNMENT', 'stranger', [OTHER_CITY]);
    await org('ngo', 'NGO', 'ngoOwner');
    await org('unrelated', 'NGO', 'outsider');

    await clearRateLimits();
    for (const key of Object.keys(users)) cookies[key] = await loginAs(EMAIL(key));
  }, 60_000);

  beforeEach(clearRateLimits);

  afterAll(async () => {
    try {
      if (prisma) {
        await settle().catch(() => undefined);
        await cleanUp();
      }
    } finally {
      await app?.close();
    }
  }, 60_000);

  async function cleanUp(): Promise<void> {
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

    const evidenceRows = await prisma.resolutionEvidence.findMany({
      where: { problemId: { in: problemIds } },
      include: { files: true },
    });
    for (const f of evidenceRows.flatMap((e) => e.files))
      await storage.delete(f.storageKey).catch(() => undefined);
    const images = await prisma.problemImage.findMany({
      where: { problemId: { in: problemIds } },
    });
    for (const i of images) await storage.delete(i.storageKey).catch(() => undefined);
    for (const key of storedKeys) await storage.delete(key).catch(() => undefined);

    const rooms = await prisma.resolutionRoom.findMany({
      where: { problemId: { in: problemIds } },
      select: { id: true },
    });
    const roomIds = rooms.map((r) => r.id);
    const attachments = await prisma.resolutionAttachment.findMany({
      where: { roomId: { in: roomIds } },
      select: { storageKey: true },
    });
    for (const a of attachments)
      await storage.delete(a.storageKey).catch(() => undefined);
    const projects = await prisma.resolutionProject.findMany({
      where: { problemId: { in: problemIds } },
      select: { id: true },
    });
    const allocations = (
      await prisma.problemAllocation.findMany({
        where: { problemId: { in: problemIds } },
        select: { id: true },
      })
    ).map((a) => a.id);
    const evidenceIds = evidenceRows.map((e) => e.id);

    await prisma.resolutionVerificationAssessment.deleteMany({
      where: { evidenceId: { in: evidenceIds } },
    });
    await prisma.resolutionEvidenceFile.deleteMany({
      where: { evidenceId: { in: evidenceIds } },
    });
    await prisma.resolutionEvidence.updateMany({
      where: { id: { in: evidenceIds } },
      data: { replacesEvidenceId: null },
    });
    await prisma.resolutionEvidence.deleteMany({ where: { id: { in: evidenceIds } } });
    await prisma.resolutionVerificationRequest.deleteMany({
      where: { problemId: { in: problemIds } },
    });

    // The ledger and badges are append-only: clean-up is an explicit maintenance act.
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('samadhaan.audit_maintenance', 'on', true)`;
      await tx.impactPointTransaction.deleteMany({
        where: { OR: [{ userId: { in: ids } }, { problemId: { in: problemIds } }] },
      });
      await tx.userBadge.deleteMany({ where: { userId: { in: ids } } });
    });

    const all = [
      ...problemIds,
      ...roomIds,
      ...projects.map((p) => p.id),
      ...allocations,
      ...evidenceIds,
    ];
    await prisma.notification.deleteMany({
      where: { OR: [{ entityId: { in: all } }, { recipientId: { in: ids } }] },
    });
    await deleteAuditLogs(prisma, {
      OR: [{ entityId: { in: [...all, ...ids] } }, { actorUserId: { in: ids } }],
    });
    await prisma.resolutionRoom.deleteMany({ where: { id: { in: roomIds } } });
    await prisma.problemAllocation.deleteMany({
      where: { problemId: { in: problemIds } },
    });
    await prisma.problem.deleteMany({ where: { id: { in: problemIds } } });
    await prisma.organization.deleteMany({ where: { slug: { startsWith: `${RUN}-` } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
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

  /** Everything the event bus started — notifications, impact awards — has finished. */
  async function settle(): Promise<void> {
    await bus.drain();
    await impact.idle();
    await bus.drain();
  }

  function api(as: string) {
    return {
      get: (path: string) =>
        request(server).get(`/api/v1${path}`).set('Cookie', cookies[as]!),
      post: (path: string, body: object = {}) =>
        request(server).post(`/api/v1${path}`).set('Cookie', cookies[as]!).send(body),
      patch: (path: string, body: object = {}) =>
        request(server).patch(`/api/v1${path}`).set('Cookie', cookies[as]!).send(body),
      upload: (path: string, file: Buffer, name: string, field?: [string, string]) => {
        const r = request(server)
          .post(`/api/v1${path}`)
          .set('Cookie', cookies[as]!)
          .attach('file', file, name);
        return field ? r.field(field[0], field[1]) : r;
      },
    };
  }
  const gov = (office = 'office') => `/government/${SLUG(office)}`;
  const problemStatus = async () =>
    (await prisma.problem.findUniqueOrThrow({ where: { id: problem.id } })).status;

  // ================================================================ citizen

  describe('citizen reports', () => {
    it('accepts a real JPEG and rejects text bytes named .jpg', async () => {
      const ok = await api('reporter')
        .upload('/problems/images', jpeg, 'pothole.jpg')
        .expect(201);
      photoKey = ok.body.data.storageKey;
      storedKeys.push(photoKey);
      expect(ok.body.data).toMatchObject({
        contentType: 'image/jpeg',
        width: 800,
        height: 600,
      });

      const bad = await api('reporter').upload(
        '/problems/images',
        Buffer.from('this is plain text, not an image at all'),
        'fake.jpg',
      );
      expect(bad.status).toBeGreaterThanOrEqual(400);
      expect(bad.status).toBeLessThan(500);
    });

    it('creates a problem in the office’s city with that photo', async () => {
      const response = await api('reporter')
        .post('/problems', {
          title: `Deep pothole outside the ${SUFFIX} ward office`,
          description:
            'A deep pothole has opened outside the ward office gate. Two-wheelers swerve into traffic to avoid it.',
          category: 'POTHOLES',
          location: {
            latitude: 23.2599,
            longitude: 77.4126,
            city: CITY,
            address: 'Ward Office Road',
          },
          images: [{ storageKey: photoKey, sortOrder: 0, isPrimary: true }],
        })
        .expect(201);
      problem = { id: response.body.data.id, publicId: response.body.data.publicId };
      expect(problem.publicId).toMatch(/^SAM-\d+$/);
      expect(response.body.data.status).toBe('SUBMITTED');
      expect(response.body.data.images).toHaveLength(1);

      // Analysis and duplicate detection run detached against the real AI
      // service. Let them finish so nothing races the rest of the journey.
      await vi.waitFor(
        async () => {
          const running = await prisma.problemAiAnalysis.count({
            where: {
              problemId: problem.id,
              processingStatus: { in: ['PENDING', 'PROCESSING'] },
            },
          });
          expect(running).toBe(0);
        },
        { timeout: 50_000, interval: 250 },
      );
      expect(await problemStatus()).toBe('SUBMITTED');
      const analyses = await prisma.problemAiAnalysis.findMany({
        where: { problemId: problem.id },
        select: { analysisType: true, processingStatus: true },
      });
      expect(analyses).toEqual(
        expect.arrayContaining([
          { analysisType: 'INITIAL_ANALYSIS', processingStatus: 'COMPLETED' },
        ]),
      );
    }, 60_000);

    it('serves the problem back publicly, with its photo', async () => {
      const response = await request(server)
        .get(`/api/v1/problems/${problem.publicId}`)
        .expect(200);
      expect(response.body.data).toMatchObject({
        publicId: problem.publicId,
        status: 'SUBMITTED',
        location: expect.objectContaining({ city: CITY }),
      });
      const url = response.body.data.images[0].url as string;
      const path = url.slice(url.indexOf('/api/v1/media/'));
      expect(path).toBe(`/api/v1/media/${photoKey}`);
      const media = await request(server).get(path).expect(200);
      expect(media.headers['content-type']).toContain('image/jpeg');
    });

    it('lets a second citizen support, follow and comment', async () => {
      const support = await api('neighbour')
        .post(`/problems/${problem.publicId}/support`)
        .expect(200);
      expect(support.body.data.supportCount).toBe(1);

      const follow = await api('neighbour')
        .post(`/problems/${problem.publicId}/follow`)
        .expect(200);
      // The reporter follows their own report from the start.
      expect(follow.body.data).toEqual({ followerCount: 2, followedByCurrentUser: true });

      const comment = await api('neighbour')
        .post(`/problems/${problem.publicId}/comments`, {
          body: 'Same here — my scooter nearly went into it last night.',
        })
        .expect(201);
      expect(comment.body.data.commentCount).toBe(1);

      const row = await prisma.problem.findUniqueOrThrow({ where: { id: problem.id } });
      expect(row).toMatchObject({ voteCount: 1, followCount: 2, commentCount: 1 });
    });

    it('notifies the reporter of the comment, who marks it read', async () => {
      await settle();
      const inbox = await api('reporter').get('/notifications').expect(200);
      const note = inbox.body.data.items.find(
        (n: { type: string }) => n.type === 'PROBLEM_COMMENTED',
      );
      expect(note).toMatchObject({
        isRead: false,
        problemPublicId: problem.publicId,
        href: `/problems/${problem.publicId}#discussion`,
      });
      const before = (
        await api('reporter').get('/notifications/unread-count').expect(200)
      ).body.data.count as number;

      const marked = await api('reporter')
        .patch(`/notifications/${note.id}/read`)
        .expect(200);
      expect(marked.body.data).toMatchObject({ id: note.id, isRead: true });
      const after = (await api('reporter').get('/notifications/unread-count').expect(200))
        .body.data.count as number;
      expect(after).toBe(before - 1);
      // Nobody else can mark it.
      await api('neighbour').patch(`/notifications/${note.id}/read`).expect(404);
    });
  });

  // ============================================================= government

  describe('government review', () => {
    it('shows the problem in the office’s review queue', async () => {
      const queue = await api('official').get(`${gov()}/problems`).expect(200);
      expect(
        queue.body.data.items.map((i: { publicId: string }) => i.publicId),
      ).toContain(problem.publicId);
      await api('official').get(`${gov()}/problems/${problem.publicId}`).expect(200);
    });

    it('hides it from an official of a different office', async () => {
      const own = await api('stranger')
        .get(`${gov('elsewhere')}/problems?view=all`)
        .expect(200);
      expect(
        own.body.data.items.map((i: { publicId: string }) => i.publicId),
      ).not.toContain(problem.publicId);
      for (const path of [
        `${gov('elsewhere')}/problems/${problem.publicId}`,
        `${gov()}/problems/${problem.publicId}`,
      ]) {
        const response = await api('stranger').get(path);
        expect([403, 404]).toContain(response.status);
      }
      const write = await api('stranger').patch(
        `${gov('elsewhere')}/problems/${problem.publicId}/status`,
        { status: 'UNDER_REVIEW' },
      );
      expect([403, 404]).toContain(write.status);
      expect(await problemStatus()).toBe('SUBMITTED');
    });

    it('verifies it through review, refusing an invalid transition', async () => {
      const status = `${gov()}/problems/${problem.publicId}/status`;
      await api('official').patch(status, { status: 'UNDER_REVIEW' }).expect(200);
      const verified = await api('official')
        .patch(status, { status: 'VERIFIED', note: 'Confirmed by the ward engineer.' })
        .expect(200);
      expect(verified.body.data.status).toBe('VERIFIED');

      const skip = await api('official').patch(status, { status: 'RESOLVED' });
      expect(skip.status).toBeGreaterThanOrEqual(400);
      expect(skip.status).toBeLessThan(500);
      expect(await problemStatus()).toBe('VERIFIED');
      // Citizens cannot drive the review at all.
      await api('reporter').patch(status, { status: 'REJECTED', note: 'x' }).expect(403);
    });
  });

  // ============================================================= allocation

  describe('allocation', () => {
    it('allocates to the NGO, which accepts — the problem goes IN_PROGRESS with a room', async () => {
      const created = await api('official')
        .post(`${gov()}/problems/${problem.publicId}/allocations`, {
          organizationId: orgs.ngo,
          instructions: 'Fill and compact within the week.',
        })
        .expect(201);
      allocationId = created.body.data.id;

      // An unrelated NGO cannot answer for the assigned one.
      const foreign = await api('outsider').post(
        `/organizations/${SLUG('unrelated')}/allocations/${allocationId}/accept`,
      );
      expect([403, 404]).toContain(foreign.status);

      const accepted = await api('ngoOwner')
        .post(`/organizations/${SLUG('ngo')}/allocations/${allocationId}/accept`)
        .expect(200);
      roomId = accepted.body.data.roomId;
      expect(roomId).toMatch(/^[0-9a-f-]{36}$/);

      expect(await problemStatus()).toBe('IN_PROGRESS');
      const room = await prisma.resolutionRoom.findUniqueOrThrow({
        where: { id: roomId },
      });
      expect(room).toMatchObject({
        status: 'OPEN',
        problemId: problem.id,
        allocationId,
        governmentOrganizationId: orgs.office,
        assignedOrganizationId: orgs.ngo,
      });
      const publicView = await request(server)
        .get(`/api/v1/problems/${problem.publicId}`)
        .expect(200);
      expect(publicView.body.data.status).toBe('IN_PROGRESS');
    });
  });

  // ========================================================== organization

  describe('organisation work', () => {
    it('lets the NGO owner post in the room, and keeps an unrelated NGO out', async () => {
      const posted = await api('ngoOwner')
        .post(`/resolution-rooms/${roomId}/messages`, {
          body: 'Crew booked for Thursday morning.',
        })
        .expect(201);
      expect(posted.body.data.author.userId).toBe(users.ngoOwner);

      const page = await api('official')
        .get(`/resolution-rooms/${roomId}/messages`)
        .expect(200);
      expect(page.body.data.items.map((m: { body: string }) => m.body)).toContain(
        'Crew booked for Thursday morning.',
      );

      for (const response of [
        await api('outsider').get(`/resolution-rooms/${roomId}`),
        await api('outsider').get(`/resolution-rooms/${roomId}/messages`),
        await api('outsider').post(`/resolution-rooms/${roomId}/messages`, {
          body: 'hi',
        }),
      ]) {
        expect([403, 404]).toContain(response.status);
      }
    });

    it('activates the project opened on acceptance, and completes a task', async () => {
      // No endpoint creates a project: it is opened automatically with the room on acceptance.
      const project = await api('ngoOwner')
        .get(`/resolution-rooms/${roomId}/project`)
        .expect(200);
      projectId = project.body.data.id;
      await api('ngoOwner')
        .post(`/resolution-projects/${projectId}/status`, { status: 'ACTIVE' })
        .expect(200);

      const task = await api('ngoOwner')
        .post(`/resolution-projects/${projectId}/tasks`, {
          title: 'Fill and compact the pothole',
        })
        .expect(201);
      taskId = task.body.data.id;
      await api('outsider')
        .post(`/resolution-projects/${projectId}/tasks/${taskId}/status`, {
          status: 'COMPLETED',
        })
        .then((r) => expect([403, 404]).toContain(r.status));
      await api('ngoOwner')
        .post(`/resolution-projects/${projectId}/tasks/${taskId}/status`, {
          status: 'IN_PROGRESS',
        })
        .expect(200);
      await api('ngoOwner')
        .post(`/resolution-projects/${projectId}/tasks/${taskId}/status`, {
          status: 'COMPLETED',
        })
        .expect(200);

      const stored = await prisma.resolutionTask.findUniqueOrThrow({
        where: { id: taskId },
      });
      expect(stored.status).toBe('COMPLETED');
      expect(
        (await prisma.resolutionProject.findUniqueOrThrow({ where: { id: projectId } }))
          .status,
      ).toBe('ACTIVE');
    });

    it('creates evidence, uploads an after photo and submits it', async () => {
      const draft = await api('ngoOwner')
        .post(`/resolution-projects/${projectId}/evidence`, {
          evidenceType: 'AFTER_IMAGE',
          title: 'Pothole filled',
        })
        .expect(201);
      evidenceId = draft.body.data.id;
      expect(draft.body.data.status).toBe('DRAFT');

      const after = await sharp({
        create: {
          width: 800,
          height: 600,
          channels: 3,
          background: { r: 60, g: 60, b: 60 },
        },
      })
        .jpeg()
        .toBuffer();
      await api('ngoOwner')
        .upload(
          `/evidence/${evidenceId}/files`,
          Buffer.from('not an image'),
          'after.jpg',
          ['role', 'AFTER'],
        )
        .expect(400);
      const uploaded = await api('ngoOwner')
        .upload(`/evidence/${evidenceId}/files`, after, 'after.jpg', ['role', 'AFTER'])
        .expect(201);
      expect(uploaded.body.data.files).toHaveLength(1);

      await api('ngoOwner').post(`/evidence/${evidenceId}/submit`).expect(200);
      await jobs.idle();
      const row = await prisma.resolutionEvidence.findUniqueOrThrow({
        where: { id: evidenceId },
      });
      expect(row.status).toBe('AI_REVIEWED');
      // The real AI service answered; with LLM_PROVIDER=development no model
      // runs, so the review is honestly recorded as UNAVAILABLE, not a verdict.
      expect(row.aiStatus).toBe('UNAVAILABLE');
    }, 60_000);
  });

  // ============================================================= resolution

  describe('resolution', () => {
    it('lets the NGO request verification and the office approve it — RESOLVED', async () => {
      const requested = await api('ngoOwner')
        .post(`/resolution-projects/${projectId}/verification/request`, {
          note: 'Work complete; photo attached.',
        })
        .expect(200);
      expect(requested.body.data.request).toMatchObject({
        status: 'PENDING',
        evidenceCount: 1,
      });

      const view = await api('official')
        .get(`${gov()}/problems/${problem.publicId}/verification`)
        .expect(200);
      expect(view.body.data).toMatchObject({ canDecide: true, approvalBlockers: [] });

      // Neither the NGO nor another office may decide.
      await api('ngoOwner')
        .post(`${gov()}/problems/${problem.publicId}/verification/approve`)
        .expect(403);
      const other = await api('stranger').post(
        `${gov('elsewhere')}/problems/${problem.publicId}/verification/approve`,
      );
      expect([403, 404]).toContain(other.status);

      await api('official')
        .post(`${gov()}/problems/${problem.publicId}/verification/approve`, {
          note: 'Inspected on site.',
        })
        .expect(200);

      const row = await prisma.problem.findUniqueOrThrow({ where: { id: problem.id } });
      expect(row.status).toBe('RESOLVED');
      expect(row.resolvedAt).not.toBeNull();
      expect(
        (await prisma.resolutionProject.findUniqueOrThrow({ where: { id: projectId } }))
          .status,
      ).toBe('COMPLETED');
      expect(
        (await prisma.resolutionEvidence.findUniqueOrThrow({ where: { id: evidenceId } }))
          .status,
      ).toBe('APPROVED');
      const publicView = await request(server)
        .get(`/api/v1/problems/${problem.publicId}`)
        .expect(200);
      expect(publicView.body.data.status).toBe('RESOLVED');
    });

    it('awards the reporter PROBLEM_RESOLVED impact via the event bus', async () => {
      await settle();
      const ledger = await prisma.impactPointTransaction.findMany({
        where: { userId: users.reporter!, problemId: problem.id },
      });
      expect(ledger.map((r) => r.type)).toEqual(
        expect.arrayContaining(['PROBLEM_VERIFIED', 'PROBLEM_RESOLVED']),
      );
      expect(ledger.filter((r) => r.type === 'PROBLEM_RESOLVED')).toHaveLength(1);
      const mine = await api('reporter').get('/users/me/impact').expect(200);
      expect(JSON.stringify(mine.body.data)).toBeTruthy();
    });

    it('records the key actions in the audit log', async () => {
      const actions = (
        await prisma.auditLog.findMany({
          where: {
            entityId: { in: [problem.id, roomId, projectId, allocationId, evidenceId] },
          },
          select: { action: true },
        })
      ).map((r) => r.action);
      expect(actions).toEqual(
        expect.arrayContaining([
          'PROBLEM_STATUS_CHANGED',
          'ALLOCATION_CREATED',
          'ALLOCATION_ACCEPTED',
          'RESOLUTION_ROOM_CREATED',
          'RESOLUTION_PROJECT_STATUS_CHANGED',
          'RESOLUTION_VERIFICATION_REQUESTED',
          'RESOLUTION_APPROVED',
        ]),
      );
      const transitions = await prisma.auditLog.findMany({
        where: { entityId: problem.id, action: 'PROBLEM_STATUS_CHANGED' },
        orderBy: { createdAt: 'asc' },
      });
      const path = transitions.map((t) => (t.metadata as { to?: string } | null)?.to);
      expect(path).toEqual(
        expect.arrayContaining(['UNDER_REVIEW', 'VERIFIED', 'RESOLVED']),
      );
    });
  });

  // ============================================================== analytics

  describe('analytics', () => {
    it('serves the office overview to its official, and refuses a citizen', async () => {
      const overview = await api('official')
        .get(`${gov()}/analytics/overview`)
        .expect(200);
      expect(overview.body.data).toBeTruthy();
      await api('reporter').get(`${gov()}/analytics/overview`).expect(403);
      const other = await api('stranger').get(`${gov()}/analytics/overview`);
      expect([403, 404]).toContain(other.status);
    });
  });
});
