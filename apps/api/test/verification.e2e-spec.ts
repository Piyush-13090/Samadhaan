import { createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { err, ok } from '@samadhaan/shared';
import { AppModule } from '../src/app.module.js';
import { AiClient, AiRequestError } from '../src/ai/ai.client.js';
import { configureApp, registerNotFoundHandler } from '../src/bootstrap.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { DomainEventBus } from '../src/events/domain-event-bus.js';
import { RedisService } from '../src/redis/redis.service.js';
import { StorageService } from '../src/storage/storage.types.js';
import { VerificationJobsService } from '../src/verification/verification-jobs.service.js';
import { deleteAuditLogs } from './audit-maintenance.js';

/**
 * Resolution verification (Prompt 22) end to end, against real PostgreSQL,
 * storage and image processing. Only the AI transport is faked: it records
 * every verification request and answers as each test configures.
 */
describe('Resolution verification (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let bus: DomainEventBus;
  let jobs: VerificationJobsService;
  let storage: StorageService;
  let server: Parameters<typeof request>[0];

  const PASSWORD = 'DevPassword123!';
  const PREFIX = 'e2e-verify-';
  const TITLE = 'Verify probe ';
  const EMAIL = (key: string) => `${PREFIX}${key}@samadhaan.test`;

  type Mode = 'likely' | 'weak' | 'fail' | 'resolved' | 'none';
  let mode: Mode = 'likely';
  const sent: Array<Record<string, unknown>> = [];

  const users: Record<string, string> = {};
  const orgs: Record<string, string> = {};
  const cookies: Record<string, string[]> = {};
  let problem: { id: string; publicId: string };
  let projectId: string;
  let roomId: string;
  const evidence: Record<string, string> = {};

  // ---------------------------------------------------------------- fakes

  const fakeClient = {
    post: async (path: string, body: Record<string, unknown>) => {
      if (path === '/verify/evidence') {
        sent.push(body);
        if (mode === 'fail') {
          return err(
            new AiRequestError('down', 503, {
              code: 'PROVIDER_UNAVAILABLE',
              message: 'x',
              retryable: true,
            }),
          );
        }
        const s = (value: number | null, confidence: number) => ({ value, confidence });
        return ok({
          relevance: s(0.92, 0.9),
          visual_consistency: s(0.8, 0.8),
          completion_signals: s(0.85, 0.85),
          documentation: s(null, 0),
          recommendation:
            mode === 'resolved' ? 'RESOLVED' : mode === 'none' ? null : 'LIKELY_RESOLVED',
          confidence: mode === 'weak' ? 0.3 : 0.86,
          supporting: [
            { text: 'After photo shows a repaired surface', refs: ['F1', 'B1'] },
          ],
          remaining_issues: [{ text: 'Durability cannot be judged', refs: ['F1'] }],
          ai_ran: mode !== 'none',
          documents_read: 0,
          provider: mode === 'none' ? 'development' : 'fake',
          model_name: mode === 'none' ? 'development' : 'fake-vlm',
          model_version: '1',
          prompt_version: 'evidence-verification-2026-10-v1',
          processing_ms: 4,
        });
      }
      return err(
        new AiRequestError('n/a', 503, {
          code: 'PROVIDER_UNAVAILABLE',
          message: 'n/a',
          retryable: false,
        }),
      );
    },
    get: async () => err(new Error('not used')),
  };

  async function photo(seed: number, gps?: [number, number]): Promise<Buffer> {
    const width = 96;
    const height = 72;
    const raw = Buffer.alloc(width * height * 3);
    for (let i = 0; i < raw.length; i += 1)
      raw[i] = (i * seed + (i % width) * (seed % 7)) % 256;
    let image = sharp(raw, { raw: { width, height, channels: 3 } }).resize(800, 600);
    if (gps) {
      const dms = (v: number) => {
        const d = Math.floor(v);
        const m = Math.floor((v - d) * 60);
        const sec = Math.round(((v - d) * 60 - m) * 60 * 100);
        return `${d}/1 ${m}/1 ${sec}/100`;
      };
      image = image.withExif({
        IFD0: { Make: 'TestCam' },
        IFD2: {
          DateTimeOriginal: new Date()
            .toISOString()
            .slice(0, 19)
            .replace('T', ' ')
            .replaceAll('-', ':'),
        },
        IFD3: {
          GPSLatitudeRef: 'N',
          GPSLatitude: dms(gps[0]),
          GPSLongitudeRef: 'E',
          GPSLongitude: dms(gps[1]),
        },
      });
    }
    return image.jpeg().toBuffer();
  }

  // ---------------------------------------------------------------- setup

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
    jobs = app.get(VerificationJobsService);
    storage = app.get(StorageService);

    await cleanUp();
    const template = await prisma.user.findUniqueOrThrow({
      where: { email: 'government@samadhaan.dev' },
    });
    for (const [key, role] of [
      ['official', 'GOVERNMENT'],
      ['overlap', 'GOVERNMENT'],
      ['owner', 'NGO'],
      ['member', 'NGO'],
      ['outsider', 'NGO'],
      ['citizen', 'CITIZEN'],
    ] as const) {
      users[key] = (
        await prisma.user.create({
          data: {
            email: EMAIL(key),
            passwordHash: template.passwordHash,
            fullName: `Verify ${key}`,
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
    ) => {
      const created = await prisma.organization.create({
        data: {
          name: `E2E Verify ${key}`,
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
      if (type === 'GOVERNMENT') {
        await prisma.$executeRaw`UPDATE organizations SET "jurisdictionBoundary" = ST_Multi(ST_MakeEnvelope(73.7, 18.4, 74.0, 18.65, 4326))::geography WHERE id = ${created.id}::uuid`;
      }
      for (const [userKey, role] of members) {
        await prisma.organizationMember.create({
          data: {
            organizationId: created.id,
            userId: users[userKey]!,
            membershipRole: role,
            status: 'ACTIVE',
            joinedAt: new Date(),
          },
        });
      }
    };
    await org('pune', 'GOVERNMENT', [['official', 'OWNER']]);
    // A second office whose area also covers the problem — but it did not allocate it.
    await org('overlap', 'GOVERNMENT', [['overlap', 'OWNER']]);
    await org('ngo', 'NGO', [
      ['owner', 'OWNER'],
      ['member', 'MEMBER'],
    ]);
    await org('outsider', 'NGO', [['outsider', 'OWNER']]);

    const created = await prisma.problem.create({
      data: {
        reporterId: users.citizen!,
        title: `${TITLE}pothole on the main road`,
        description: 'A deep pothole on the main road outside the market.',
        category: 'POTHOLES',
        status: 'VERIFIED',
        latitude: 18.52,
        longitude: 73.85,
        city: 'Pune',
        submittedAt: new Date(Date.now() - 3 * 86_400_000),
      },
    });
    problem = { id: created.id, publicId: created.publicId };
    // The citizen's report photo — the "before".
    const before = await photo(3);
    const key = `problems/${created.id}/before.jpg`;
    await storage.put({ key, body: before, contentType: 'image/jpeg' });
    await prisma.problemImage.create({
      data: {
        problemId: created.id,
        storageKey: key,
        mimeType: 'image/jpeg',
        fileSize: before.length,
        isPrimary: true,
      },
    });

    await clearKeys();
    for (const k of ['official', 'overlap', 'owner', 'member', 'outsider', 'citizen'])
      cookies[k] = await loginAs(EMAIL(k));

    const allocation = await api('official')
      .post(`/government/${PREFIX}pune/problems/${problem.publicId}/allocations`, {
        organizationId: orgs.ngo,
      })
      .expect(201);
    const accepted = await api('owner')
      .post(`/organizations/${PREFIX}ngo/allocations/${allocation.body.data.id}/accept`)
      .expect(200);
    roomId = accepted.body.data.roomId;
    projectId = (
      await api('owner').get(`/resolution-rooms/${roomId}/project`).expect(200)
    ).body.data.id;
    await api('owner')
      .post(`/resolution-projects/${projectId}/status`, { status: 'ACTIVE' })
      .expect(200);
  });

  beforeEach(async () => {
    mode = 'likely';
    await clearKeys();
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
    ).map((p) => p.id);
    const evidenceRows = await prisma.resolutionEvidence.findMany({
      where: { problemId: { in: ids } },
      include: { files: true },
    });
    for (const f of evidenceRows.flatMap((e) => e.files))
      await storage.delete(f.storageKey).catch(() => undefined);
    const images = await prisma.problemImage.findMany({
      where: { problemId: { in: ids } },
    });
    for (const i of images) await storage.delete(i.storageKey).catch(() => undefined);
    const projects = await prisma.resolutionProject.findMany({
      where: { problemId: { in: ids } },
      select: { id: true, roomId: true },
    });
    const allocations = (
      await prisma.problemAllocation.findMany({
        where: { problemId: { in: ids } },
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
      where: { problemId: { in: ids } },
    });
    const all = [
      ...ids,
      ...evidenceIds,
      ...projects.flatMap((p) => [p.id, p.roomId]),
      ...allocations,
    ];
    await prisma.notification.deleteMany({ where: { entityId: { in: all } } });
    await deleteAuditLogs(prisma, { entityId: { in: all } });
    await prisma.resolutionRoom.deleteMany({
      where: { id: { in: projects.map((p) => p.roomId) } },
    });
    await prisma.problemAllocation.deleteMany({ where: { problemId: { in: ids } } });
    await prisma.problem.deleteMany({ where: { id: { in: ids } } });
    await prisma.organization.deleteMany({ where: { slug: { startsWith: PREFIX } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
  }

  async function clearKeys(): Promise<void> {
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

  function api(as: string) {
    return {
      get: (path: string) =>
        request(server).get(`/api/v1${path}`).set('Cookie', cookies[as]!),
      post: (path: string, body: object = {}) =>
        request(server).post(`/api/v1${path}`).set('Cookie', cookies[as]!).send(body),
      delete: (path: string) =>
        request(server).delete(`/api/v1${path}`).set('Cookie', cookies[as]!),
      upload: (path: string, file: Buffer, name: string, role?: string) => {
        const r = request(server)
          .post(`/api/v1${path}`)
          .set('Cookie', cookies[as]!)
          .attach('file', file, name);
        return role ? r.field('role', role) : r;
      },
    };
  }
  const gov = (as: string, slug = 'pune') => ({
    get: (path: string) =>
      api(as).get(`/government/${PREFIX}${slug}/problems/${problem.publicId}${path}`),
    post: (path: string, body: object = {}) =>
      api(as).post(
        `/government/${PREFIX}${slug}/problems/${problem.publicId}${path}`,
        body,
      ),
  });
  const statusOf = async (key: string) =>
    (await prisma.resolutionEvidence.findUniqueOrThrow({ where: { id: evidence[key]! } }))
      .status;

  /** Draft → after photo with GPS near the report → submitted → reviewed. */
  async function submitAfterPhoto(key: string, seed: number, as = 'member') {
    const created = await api(as)
      .post(`/resolution-projects/${projectId}/evidence`, {
        evidenceType: 'AFTER_IMAGE',
        title: `${key} after photo`,
      })
      .expect(201);
    evidence[key] = created.body.data.id;
    await api(as)
      .upload(
        `/evidence/${evidence[key]}/files`,
        await photo(seed, [18.5201, 73.8502]),
        'after.jpg',
        'AFTER',
      )
      .expect(201);
    await api(as).post(`/evidence/${evidence[key]}/submit`).expect(200);
    await jobs.idle();
  }

  // ============================================================ access

  describe('who may submit and read evidence', () => {
    it('lets a member of the assigned organisation draft evidence, and no one else', async () => {
      const body = { evidenceType: 'AFTER_IMAGE', title: 'Patched' };
      await api('citizen')
        .post(`/resolution-projects/${projectId}/evidence`, body)
        .expect(404);
      await api('outsider')
        .post(`/resolution-projects/${projectId}/evidence`, body)
        .expect(404);
      await api('official')
        .post(`/resolution-projects/${projectId}/evidence`, body)
        .expect(403);
      await api('member')
        .post(`/resolution-projects/${projectId}/evidence`, {
          ...body,
          projectId: '00000000-0000-4000-8000-000000000000',
        })
        .expect(400);
      await api('member')
        .post(`/resolution-projects/${projectId}/evidence`, {
          ...body,
          status: 'APPROVED',
        })
        .expect(400);
      const draft = await api('member')
        .post(`/resolution-projects/${projectId}/evidence`, body)
        .expect(201);
      evidence.draft = draft.body.data.id;
      expect(draft.body.data).toMatchObject({
        status: 'DRAFT',
        version: 1,
        permissions: { canUpload: true },
      });
    });

    it('keeps drafts from the government and evidence from outsiders', async () => {
      const list = (
        await api('official')
          .get(`/resolution-projects/${projectId}/evidence`)
          .expect(200)
      ).body.data;
      expect(list.map((e: { id: string }) => e.id)).not.toContain(evidence.draft);
      await api('official').get(`/evidence/${evidence.draft}`).expect(404);
      await api('outsider').get(`/evidence/${evidence.draft}`).expect(404);
      await api('citizen').get(`/evidence/${evidence.draft}`).expect(404);
    });
  });

  // ============================================================ uploads

  describe('uploads', () => {
    it('refuses executables, disguised files, markup and oversized images', async () => {
      const url = `/evidence/${evidence.draft}/files`;
      await api('member')
        .upload(url, Buffer.from('MZ\x90\x00 not a photo'), 'photo.jpg')
        .expect(400);
      await api('member')
        .upload(url, await photo(5), 'photo.exe')
        .expect(400);
      await api('member')
        .upload(url, Buffer.from('<svg onload="alert(1)"/>'), 'x.svg')
        .expect(400);
      await api('member')
        .upload(url, Buffer.from('<html><script>alert(1)</script>'), 'x.html')
        .expect(400);
      const huge = Buffer.concat([
        Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
        Buffer.alloc(11 * 1024 * 1024),
      ]);
      await api('member').upload(url, huge, 'huge.jpg').expect(400);
      await api('member')
        .upload(url, Buffer.from('%PDF-1.4 report'), 'report.pdf', 'AFTER')
        .expect(400);
      await api('outsider')
        .upload(url, await photo(5), 'p.jpg')
        .expect(404);
    });

    it('stores photos without their metadata, keeping a checksum and a distance', async () => {
      const original = await photo(7, [18.5201, 73.8502]);
      const view = (
        await api('member')
          .upload(`/evidence/${evidence.draft}/files`, original, '../../etc/after.jpg')
          .expect(201)
      ).body.data;
      const file = view.files[0];
      expect(file).toMatchObject({
        fileName: 'after.jpg',
        role: 'AFTER',
        checksum: createHash('sha256').update(original).digest('hex'),
        url: `/api/v1/evidence/${evidence.draft}/files/${file.id}`,
      });
      expect(file.locationDistanceM).toBeLessThan(50);
      expect(JSON.stringify(view)).not.toMatch(
        /evidence\/[0-9a-f-]{36}\/[0-9a-f]{32}|gpsLatitude|18\.520/,
      );
      const download = await api('member')
        .get(`/evidence/${evidence.draft}/files/${file.id}`)
        .buffer(true)
        .expect(200);
      expect(download.headers['x-content-type-options']).toBe('nosniff');
      expect(download.headers['content-security-policy']).toContain('sandbox');
      expect((await sharp(download.body as Buffer).metadata()).exif).toBeUndefined();
      const row = await prisma.resolutionEvidenceFile.findUniqueOrThrow({
        where: { id: file.id },
      });
      await request(server).get(`/api/v1/media/${row.storageKey}`).expect(404);
    });

    it('needs a file before submission', async () => {
      const empty = await api('member')
        .post(`/resolution-projects/${projectId}/evidence`, {
          evidenceType: 'DOCUMENT',
          title: 'Nothing yet',
        })
        .expect(201);
      await api('member').post(`/evidence/${empty.body.data.id}/submit`).expect(400);
      await api('member').post(`/evidence/${empty.body.data.id}/withdraw`).expect(200);
    });
  });

  // ======================================================= AI review

  describe('AI review', () => {
    it('reviews submitted evidence in the background and records a guarded, versioned assessment', async () => {
      sent.length = 0;
      await api('member').post(`/evidence/${evidence.draft}/submit`).expect(200);
      evidence.first = evidence.draft!;
      expect(await statusOf('first')).toMatch(/SUBMITTED|PROCESSING|AI_REVIEWED/);
      await jobs.idle();
      expect(await statusOf('first')).toBe('AI_REVIEWED');

      const view = (await api('official').get(`/evidence/${evidence.first}`).expect(200))
        .body.data;
      expect(view.assessment).toMatchObject({
        status: 'COMPLETED',
        recommendation: 'LIKELY_RESOLVED',
        model: {
          name: 'fake-vlm',
          promptVersion: 'evidence-verification-2026-10-v1',
          verificationVersion: 'verification-baseline-v1',
        },
      });
      expect(view.assessment.evidenceQuality).toBeGreaterThan(50);
      const location = view.assessment.signals.find(
        (s: { key: string }) => s.key === 'locationConsistency',
      );
      expect(location.value).toBe(1);
      expect(
        view.assessment.missingEvidence.find(
          (m: { kind: string }) => m.kind === 'BEFORE_IMAGE',
        ).satisfied,
      ).toBe(true);
      expect(
        view.assessment.missingEvidence.find(
          (m: { kind: string }) => m.kind === 'DOCUMENT',
        ).satisfied,
      ).toBe(false);

      // Bounded context: report photo + evidence photo, no coordinates, no storage keys.
      const body = sent[0]!;
      expect((body.before_images as unknown[]).length).toBe(1);
      expect((body.after_images as unknown[]).length).toBe(1);
      expect(JSON.stringify(body)).not.toMatch(
        /18\.52|73\.85|storageKey|problems\/|evidence\//,
      );
    });

    it('downgrades a low-confidence verdict instead of passing it on', async () => {
      mode = 'weak';
      await submitAfterPhoto('weak', 11);
      const view = (await api('member').get(`/evidence/${evidence.weak}`).expect(200))
        .body.data;
      expect(view.assessment).toMatchObject({
        aiRecommendation: 'LIKELY_RESOLVED',
        recommendation: 'POSSIBLY_RESOLVED',
      });
      expect(view.assessment.adjustments).toContain('The AI review had low confidence.');
      await api('member').post(`/evidence/${evidence.weak}/withdraw`).expect(200);
    });

    it('retries a failing AI service, then records the failure without blocking review', async () => {
      mode = 'fail';
      const calls = sent.length;
      await submitAfterPhoto('failing', 13);
      expect(sent.length - calls).toBe(3); // VERIFICATION_MAX_ATTEMPTS
      const row = await prisma.resolutionEvidence.findUniqueOrThrow({
        where: { id: evidence.failing },
      });
      expect(row).toMatchObject({
        status: 'AI_REVIEWED',
        aiStatus: 'FAILED',
        aiAttempts: 3,
      });
      const view = (await api('member').get(`/evidence/${evidence.failing}`).expect(200))
        .body.data;
      expect(view.assessment).toMatchObject({ status: 'FAILED', recommendation: null });
      expect(view.assessment.failureMessage).toMatch(/reviewed directly/);
      // Deterministic signals are still there for the reviewer.
      expect(
        view.assessment.signals.find(
          (s: { key: string }) => s.key === 'locationConsistency',
        ).value,
      ).toBe(1);

      mode = 'likely';
      await api('member').post(`/evidence/${evidence.failing}/analyze`).expect(403); // members cannot
      await api('owner').post(`/evidence/${evidence.failing}/analyze`).expect(202);
      await jobs.idle();
      expect(
        (
          await prisma.resolutionEvidence.findUniqueOrThrow({
            where: { id: evidence.failing },
          })
        ).aiStatus,
      ).toBe('COMPLETED');
    });

    it('never stores a "RESOLVED" verdict from the model', async () => {
      mode = 'resolved';
      await api('owner').post(`/evidence/${evidence.failing}/analyze`).expect(202);
      await jobs.idle();
      const assessments = await prisma.resolutionVerificationAssessment.findMany({
        where: { evidenceId: evidence.failing },
      });
      expect(assessments.every((a) => a.recommendation !== ('RESOLVED' as never))).toBe(
        true,
      );
      expect(
        assessments[0]!.recommendation === null ||
          assessments.some((a) => a.status === 'FAILED'),
      ).toBe(true);
    });

    it('claims no recommendation when no model ran', async () => {
      mode = 'none';
      await api('owner').post(`/evidence/${evidence.failing}/analyze`).expect(202);
      await jobs.idle();
      const latest = await prisma.resolutionVerificationAssessment.findFirstOrThrow({
        where: { evidenceId: evidence.failing },
        orderBy: { createdAt: 'desc' },
      });
      expect(latest).toMatchObject({
        status: 'UNAVAILABLE',
        recommendation: null,
        modelName: null,
      });
      await api('member').post(`/evidence/${evidence.failing}/withdraw`).expect(200);
    });
  });

  // =============================================== verification lifecycle

  describe('request → reject → resubmit → more evidence → resubmit → approve', () => {
    it('organisations cannot complete the project themselves', async () => {
      await api('owner')
        .post(`/resolution-projects/${projectId}/status`, { status: 'COMPLETED' })
        .expect(409);
    });

    it('lets only the organisation’s managers request verification, once', async () => {
      await api('member')
        .post(`/resolution-projects/${projectId}/verification/request`)
        .expect(403);
      await api('official')
        .post(`/resolution-projects/${projectId}/verification/request`)
        .expect(403);
      const view = (
        await api('owner')
          .post(`/resolution-projects/${projectId}/verification/request`, {
            note: 'Work done.',
          })
          .expect(200)
      ).body.data;
      expect(view.request).toMatchObject({ status: 'PENDING', evidenceCount: 1 });
      expect(await statusOf('first')).toBe('UNDER_GOVERNMENT_REVIEW');
      await api('owner')
        .post(`/resolution-projects/${projectId}/verification/request`)
        .expect(409);
      await api('member').post(`/evidence/${evidence.first}/withdraw`).expect(409);
    });

    it('refuses every decision from anyone but the allocating office', async () => {
      const body = { reason: 'Not convinced by this evidence at all.' };
      // Another office covering the same area sees the problem, but nothing of
      // a project it did not allocate — and cannot decide.
      const other = (await gov('overlap', 'overlap').get('/verification').expect(200))
        .body.data;
      expect(other).toMatchObject({
        project: null,
        evidence: [],
        request: null,
        canDecide: false,
      });
      await gov('overlap', 'overlap').post('/verification/approve').expect(404);
      await gov('overlap', 'overlap').post('/verification/reject', body).expect(404);
      for (const who of ['owner', 'member', 'citizen', 'outsider']) {
        await gov(who).post('/verification/approve').expect(403);
      }
      await request(server)
        .post(
          `/api/v1/government/${PREFIX}pune/problems/${problem.publicId}/verification/approve`,
        )
        .expect(401);
      expect(
        (await prisma.problem.findUniqueOrThrow({ where: { id: problem.id } })).status,
      ).toBe('IN_PROGRESS');
    });

    it('shows the official the evidence, the AI review and its limits', async () => {
      const view = (await gov('official').get('/verification').expect(200)).body.data;
      expect(view).toMatchObject({ canDecide: true, request: { status: 'PENDING' } });
      expect(view.problem.beforeImages).toHaveLength(1);
      expect(view.project).toMatchObject({ id: projectId, status: 'ACTIVE' });
      expect(view.rollup.recommendation).toBe('LIKELY_RESOLVED');
      expect(view.limitations.join(' ')).toMatch(/does not prove/);
      expect(view.timeline.map((t: { action: string }) => t.action)).toEqual(
        expect.arrayContaining([
          'EVIDENCE_SUBMITTED',
          'EVIDENCE_AI_REVIEWED',
          'RESOLUTION_VERIFICATION_REQUESTED',
        ]),
      );
    });

    it('rejects with a reason; the problem and project are untouched', async () => {
      await gov('official').post('/verification/reject').expect(400);
      await gov('official').post('/verification/reject', { reason: 'short' }).expect(400);
      await gov('official')
        .post('/verification/reject', {
          reason: 'The photo shows a different stretch of road.',
        })
        .expect(200);
      expect(await statusOf('first')).toBe('REJECTED');
      const p = await prisma.problem.findUniqueOrThrow({ where: { id: problem.id } });
      expect(p.status).toBe('IN_PROGRESS');
      expect(
        (await prisma.resolutionProject.findUniqueOrThrow({ where: { id: projectId } }))
          .status,
      ).toBe('ACTIVE');
      expect(
        await prisma.resolutionEvidenceFile.count({
          where: { evidenceId: evidence.first },
        }),
      ).toBe(1);
      const evidenceView = (
        await api('member').get(`/evidence/${evidence.first}`).expect(200)
      ).body.data;
      expect(evidenceView.decisionReason).toBe(
        'The photo shows a different stretch of road.',
      );
      await gov('official').post('/verification/approve').expect(409); // nothing pending
    });

    it('takes a new version, then asks for more evidence', async () => {
      const v2 = await api('member')
        .post(`/resolution-projects/${projectId}/evidence`, {
          evidenceType: 'AFTER_IMAGE',
          title: 'Correct stretch, after',
          replacesEvidenceId: evidence.first,
        })
        .expect(201);
      expect(v2.body.data.version).toBe(2);
      evidence.second = v2.body.data.id;
      await api('member')
        .upload(
          `/evidence/${evidence.second}/files`,
          await photo(17, [18.5201, 73.8502]),
          'after2.jpg',
          'AFTER',
        )
        .expect(201);
      await api('member').post(`/evidence/${evidence.second}/submit`).expect(200);
      await jobs.idle();
      await api('owner')
        .post(`/resolution-projects/${projectId}/verification/request`)
        .expect(200);
      await gov('official')
        .post('/verification/request-evidence', {
          reason: 'Please add the contractor’s completion document.',
        })
        .expect(200);
      expect(await statusOf('second')).toBe('NEEDS_MORE_EVIDENCE');
      expect(
        (await prisma.problem.findUniqueOrThrow({ where: { id: problem.id } })).status,
      ).toBe('IN_PROGRESS');
    });

    it('approves only once open tasks are done — then resolves and completes together', async () => {
      const doc = await api('member')
        .post(`/resolution-projects/${projectId}/evidence`, {
          evidenceType: 'DOCUMENT',
          title: 'Completion certificate',
        })
        .expect(201);
      evidence.doc = doc.body.data.id;
      await api('member')
        .upload(
          `/evidence/${evidence.doc}/files`,
          Buffer.from('%PDF-1.4 completion report'),
          'certificate.pdf',
        )
        .expect(201);
      await api('member').post(`/evidence/${evidence.doc}/submit`).expect(200);
      await jobs.idle();
      const request2 = (
        await api('owner')
          .post(`/resolution-projects/${projectId}/verification/request`)
          .expect(200)
      ).body.data;
      expect(request2.request.evidenceCount).toBe(2); // the returned evidence and the new document
      expect(
        request2.missingEvidence.find((m: { kind: string }) => m.kind === 'DOCUMENT')
          .satisfied,
      ).toBe(true);

      const task = (
        await api('owner')
          .post(`/resolution-projects/${projectId}/tasks`, { title: 'Final inspection' })
          .expect(201)
      ).body.data;
      const blocked = (await gov('official').get('/verification').expect(200)).body.data;
      expect(blocked.approvalBlockers.join(' ')).toMatch(/1 task is still open/);
      await gov('official').post('/verification/approve').expect(409);
      expect(
        (await prisma.problem.findUniqueOrThrow({ where: { id: problem.id } })).status,
      ).toBe('IN_PROGRESS');
      expect(
        (
          await prisma.resolutionVerificationRequest.findFirstOrThrow({
            where: { projectId, status: 'PENDING' },
          })
        ).id,
      ).toBeDefined();

      await api('owner')
        .post(`/resolution-projects/${projectId}/tasks/${task.id}/status`, {
          status: 'IN_PROGRESS',
        })
        .expect(200);
      await api('owner')
        .post(`/resolution-projects/${projectId}/tasks/${task.id}/status`, {
          status: 'COMPLETED',
        })
        .expect(200);

      const [a, b] = await Promise.all([
        gov('official').post('/verification/approve', { note: 'Inspected on site.' }),
        gov('official').post('/verification/approve', { note: 'Inspected on site.' }),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);

      const p = await prisma.problem.findUniqueOrThrow({ where: { id: problem.id } });
      expect(p.status).toBe('RESOLVED');
      expect(p.resolvedAt).not.toBeNull();
      expect(
        (await prisma.resolutionProject.findUniqueOrThrow({ where: { id: projectId } }))
          .status,
      ).toBe('COMPLETED');
      expect(await statusOf('second')).toBe('APPROVED');
      expect(await statusOf('doc')).toBe('APPROVED');
      expect(
        (
          await prisma.problemAllocation.findFirstOrThrow({
            where: { problemId: problem.id },
          })
        ).status,
      ).toBe('ACCEPTED');
      const actions = (
        await prisma.auditLog.findMany({
          where: { entityId: { in: [problem.id, projectId] } },
        })
      ).map((r) => r.action);
      expect(actions).toEqual(
        expect.arrayContaining([
          'RESOLUTION_REJECTED',
          'MORE_EVIDENCE_REQUESTED',
          'RESOLUTION_APPROVED',
          'PROBLEM_STATUS_CHANGED',
          'RESOLUTION_PROJECT_STATUS_CHANGED',
        ]),
      );
      expect(
        await prisma.auditLog.count({
          where: { entityId: evidence.first, action: 'EVIDENCE_REJECTED' },
        }),
      ).toBe(1);
    });

    it('shows the public only what is public', async () => {
      const view = (
        await request(server).get(`/api/v1/problems/${problem.publicId}`).expect(200)
      ).body.data;
      expect(view.status).toBe('RESOLVED');
      expect(view.resolution).toMatchObject({ verifiedBy: `E2E Verify pune` });
      expect(view.assignment.progress).toBe(100);
      expect(JSON.stringify(view)).not.toMatch(
        /Inspected on site|different stretch|completion document|LIKELY_RESOLVED/,
      );
    });

    it('notified each party, never the actor', async () => {
      await bus.drain();
      const notes = await prisma.notification.findMany({
        where: { OR: [{ entityId: projectId }, { entityId: problem.id }] },
        select: { recipientId: true, type: true, message: true },
      });
      const to = (type: string) =>
        notes.filter((n) => n.type === type).map((n) => n.recipientId);
      expect(to('RESOLUTION_EVIDENCE_SUBMITTED')).toContain(users.official);
      expect(to('RESOLUTION_VERIFICATION_REQUESTED')).toContain(users.official);
      expect(to('RESOLUTION_REJECTED')).toEqual(
        expect.arrayContaining([users.owner, users.member]),
      );
      expect(
        notes.find((n) => n.type === 'RESOLUTION_MORE_EVIDENCE_REQUESTED')!.message,
      ).toMatch(/completion document/);
      expect(to('RESOLUTION_APPROVED')).not.toContain(users.official);
      const citizen = notes.find(
        (n) =>
          n.recipientId === users.citizen &&
          n.type === 'PROBLEM_STATUS_CHANGED' &&
          n.message.includes('resolved'),
      );
      expect(citizen!.message).toBe(
        `Your reported problem ${problem.publicId} has been resolved, verified by E2E Verify pune.`,
      );
      expect(notes.filter((n) => n.recipientId === users.overlap)).toHaveLength(0);
    });

    it('accepts no more evidence once resolved', async () => {
      await api('member')
        .post(`/resolution-projects/${projectId}/evidence`, {
          evidenceType: 'OTHER',
          title: 'Late',
        })
        .expect(409);
    });
  });
});
