import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AiService } from '../src/ai/ai.service.js';
import { AppModule } from '../src/app.module.js';
import { configureApp, registerNotFoundHandler } from '../src/bootstrap.js';
import { AppConfig } from '../src/config/app.config.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { ModelInferenceService } from '../src/ml/model-inference.service.js';
import { deleteAuditLogs } from './audit-maintenance.js';

/**
 * Model registry and lifecycle (Prompt 28), end to end against PostgreSQL.
 * The AI service's artifact check is stubbed (its own behaviour is covered by
 * services/ai/tests/test_ml_serving.py); everything else is real: permissions,
 * state rules, separation of duties, audit, database constraints, rollback,
 * advisory inference and monitoring privacy.
 */
describe('Model registry (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ai: AiService;
  let server: Parameters<typeof request>[0];

  const PASSWORD = 'DevPassword123!';
  const PREFIX = 'e2e-ml-';
  const run = Date.now().toString(36);
  const TASK = 'PROBLEM_URGENCY' as const;
  const users: Record<string, string> = {};
  const cookies: Record<string, string[]> = {};
  const created: string[] = [];
  let problemId = '';

  const sha = (seed: string) =>
    Array.from(
      { length: 64 },
      (_, i) => '0123456789abcdef'[(seed.charCodeAt(i % seed.length) + i) % 16],
    ).join('');
  const body = (version: string, overrides: Record<string, unknown> = {}) => ({
    task: TASK,
    version,
    modelFormat: 'tfidf-softmax-v1',
    artifactUri: `problem_urgency/${version}`,
    artifactSha256: sha(version),
    featureSchemaVersion: 'problem-text-category-v1',
    labelSchemaVersion: 'problem-urgency-v1',
    datasetName: 'e2e-urgency',
    datasetVersion: 'v1',
    datasetFingerprint: `sha256:${'b'.repeat(64)}`,
    syntheticData: false,
    trainingConfig: { model: { C_grid: [1] } },
    trainedAt: new Date().toISOString(),
    metrics: {
      test: { n: 50, macroF1: 0.42 },
      reference: { predictionDistribution: { LOW: 30, HIGH: 20 } },
    },
    ...overrides,
  });

  const api = (as: string) => ({
    get: (path: string) =>
      request(server).get(`/api/v1${path}`).set('Cookie', cookies[as]!),
    post: (path: string, payload: object = {}) =>
      request(server).post(`/api/v1${path}`).set('Cookie', cookies[as]!).send(payload),
  });
  const reason = { reason: 'Held-out evaluation reviewed in e2e.' };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    registerNotFoundHandler(app);
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    ai = app.get(AiService);

    // Never disturb a real pointer in the developer's database.
    const existing = await prisma.activeModel.findUnique({ where: { task: TASK } });
    if (existing)
      throw new Error(`${TASK} already has an active-model row; run on a clean database`);

    const template = await prisma.user.findUniqueOrThrow({
      where: { email: 'government@samadhaan.dev' },
    });
    for (const [key, role] of [
      ['admin1', 'ADMIN'],
      ['admin2', 'ADMIN'],
      ['citizen', 'CITIZEN'],
      ['official', 'GOVERNMENT'],
      ['ngo', 'NGO'],
    ] as const) {
      users[key] = (
        await prisma.user.create({
          data: {
            email: `${PREFIX}${key}-${run}@samadhaan.test`,
            passwordHash: template.passwordHash,
            fullName: `ML ${key}`,
            role,
            status: 'ACTIVE',
          },
        })
      ).id;
      const login = await request(server)
        .post('/api/v1/auth/login')
        .send({ email: `${PREFIX}${key}-${run}@samadhaan.test`, password: PASSWORD })
        .expect(200);
      const header = login.headers['set-cookie'];
      cookies[key] = Array.isArray(header) ? header : header ? [header] : [];
    }

    vi.spyOn(ai, 'verifyModelArtifact').mockImplementation(async (ref) => ({
      ok: true,
      report: {
        sha256: ref.sha256,
        feature_schema_version: 'problem-text-category-v1',
        label_schema_version: 'problem-urgency-v1',
        synthetic_data: false,
      },
    }));
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    if (prisma) {
      await prisma.activeModel.deleteMany({ where: { task: TASK } });
      await prisma.modelInference.deleteMany({
        where: { modelVersionId: { in: created } },
      });
      await prisma.modelVersion.deleteMany({ where: { id: { in: created } } });
      await deleteAuditLogs(prisma, { entityId: { in: created } });
      if (problemId)
        await prisma.problem.delete({ where: { id: problemId } }).catch(() => undefined);
      await deleteAuditLogs(prisma, { actorUserId: { in: Object.values(users) } });
      await prisma.session.deleteMany({
        where: { userId: { in: Object.values(users) } },
      });
      await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } });
    }
    await app?.close();
  });

  async function register(version: string, overrides: Record<string, unknown> = {}) {
    const res = await api('admin1')
      .post('/admin/ml/models', body(version, overrides))
      .expect(201);
    created.push(res.body.data.id);
    return res.body.data as { id: string; status: string };
  }

  async function approved(version: string) {
    const model = await register(version);
    await api('admin1')
      .post(`/admin/ml/models/${model.id}/evaluation`, {
        evaluationDatasetVersion: 'v1',
        metrics: { n: 50, macroF1: 0.42 },
      })
      .expect(200);
    await api('admin2')
      .post(`/admin/ml/models/${model.id}/approve`, {
        note: 'Reviewed metrics and slices.',
      })
      .expect(200);
    return model;
  }

  it('is closed to everyone but platform administrators', async () => {
    for (const who of ['citizen', 'official', 'ngo']) {
      await api(who).get('/admin/ml/models').expect(403);
      await api(who)
        .post('/admin/ml/models', body(`denied-${run}`))
        .expect(403);
      await api(who).post(`/admin/ml/tasks/${TASK}/rollback`, reason).expect(403);
    }
    await request(server).get('/api/v1/admin/ml/models').expect(401);
  });

  it('registers only measured, schema-compatible runs, as EXPERIMENTAL', async () => {
    await api('admin1')
      .post(
        '/admin/ml/models',
        body(`bad-schema-${run}`, { featureSchemaVersion: 'problem-text-v1' }),
      )
      .expect(400);
    await api('admin1')
      .post(
        '/admin/ml/models',
        body(`bad-uri-${run}`, { artifactUri: '../../etc/passwd' }),
      )
      .expect(400);
    await api('admin1')
      .post('/admin/ml/models', body(`unmeasured-${run}`, { metrics: { macroF1: 0.99 } }))
      .expect(400);
    const model = await register(`a-${run}`);
    expect(model.status).toBe('EXPERIMENTAL');
    await api('admin1')
      .post('/admin/ml/models', body(`a-${run}`))
      .expect(409);
    const log = await prisma.auditLog.findFirst({
      where: { entityId: model.id, action: 'MODEL_REGISTERED' },
    });
    expect(log?.actorUserId).toBe(users.admin1);
  });

  it('keeps synthetic-data models out of every promotion path', async () => {
    const model = await register(`synthetic-${run}`, { syntheticData: true });
    await api('admin1')
      .post(`/admin/ml/models/${model.id}/evaluation`, {
        evaluationDatasetVersion: 'v1',
        metrics: { n: 10 },
      })
      .expect(409);
    // The database refuses it too, whatever writes.
    await expect(
      prisma.$executeRaw`UPDATE model_versions SET status = 'EVALUATED' WHERE id = ${model.id}::uuid`,
    ).rejects.toThrow();
  });

  it('requires evaluation, then a different administrator, before approval', async () => {
    const model = await register(`b-${run}`);
    await api('admin2')
      .post(`/admin/ml/models/${model.id}/approve`, { note: 'Too early to approve.' })
      .expect(409);
    await api('admin1')
      .post(`/admin/ml/models/${model.id}/evaluation`, {
        evaluationDatasetVersion: 'v1',
        metrics: { n: 50 },
      })
      .expect(200);
    await api('admin1')
      .post(`/admin/ml/models/${model.id}/approve`, { note: 'Approving my own model.' })
      .expect(403);
    const ok = await api('admin2')
      .post(`/admin/ml/models/${model.id}/approve`, {
        note: 'Reviewed metrics and slices.',
      })
      .expect(200);
    expect(ok.body.data).toMatchObject({
      status: 'APPROVED',
      approvedById: users.admin2,
    });
    // Not active just because it is approved: activation is a separate act.
    expect(
      (await api('admin1').get('/admin/ml/tasks').expect(200)).body.data,
    ).toContainEqual(expect.objectContaining({ task: TASK, active: null }));
  });

  it('refuses activation when the artifact does not verify, and audits the refusal', async () => {
    const model = await approved(`c-${run}`);
    vi.mocked(ai.verifyModelArtifact).mockResolvedValueOnce({
      ok: false,
      code: 'ARTIFACT_INTEGRITY',
      status: 409,
    });
    await api('admin1').post(`/admin/ml/models/${model.id}/activate`, reason).expect(409);
    expect(
      (await prisma.modelVersion.findUniqueOrThrow({ where: { id: model.id } })).status,
    ).toBe('APPROVED');
    expect(
      await prisma.auditLog.count({
        where: { entityId: model.id, action: 'MODEL_ACTIVATION_REFUSED' },
      }),
    ).toBe(1);
  });

  it('activates, keeps the previous version, rolls back and deactivates', async () => {
    const first = await approved(`d1-${run}`);
    const second = await approved(`d2-${run}`);
    await api('admin1').post(`/admin/ml/models/${first.id}/activate`, reason).expect(200);
    await api('admin1')
      .post(`/admin/ml/models/${second.id}/activate`, reason)
      .expect(200);

    let pointer = await prisma.activeModel.findUniqueOrThrow({ where: { task: TASK } });
    expect(pointer).toMatchObject({
      modelVersionId: second.id,
      previousModelVersionId: first.id,
    });
    expect(
      (await prisma.modelVersion.findUniqueOrThrow({ where: { id: first.id } })).status,
    ).toBe('APPROVED');

    // A second ACTIVE row is impossible at the database level.
    await expect(
      prisma.$executeRaw`UPDATE model_versions SET status = 'ACTIVE' WHERE id = ${first.id}::uuid`,
    ).rejects.toThrow();

    await api('admin1').post(`/admin/ml/tasks/${TASK}/rollback`, reason).expect(200);
    pointer = await prisma.activeModel.findUniqueOrThrow({ where: { task: TASK } });
    expect(pointer).toMatchObject({
      modelVersionId: first.id,
      previousModelVersionId: second.id,
    });

    // The active model cannot be retired out from under its task.
    await api('admin1').post(`/admin/ml/models/${first.id}/retire`, reason).expect(409);

    // Retiring the rollback target removes it as a target.
    await api('admin1').post(`/admin/ml/models/${second.id}/retire`, reason).expect(200);
    pointer = await prisma.activeModel.findUniqueOrThrow({ where: { task: TASK } });
    expect(pointer.previousModelVersionId).toBeNull();
    await api('admin1').post(`/admin/ml/tasks/${TASK}/rollback`, reason).expect(409);

    await api('admin1').post(`/admin/ml/tasks/${TASK}/deactivate`, reason).expect(200);
    pointer = await prisma.activeModel.findUniqueOrThrow({ where: { task: TASK } });
    expect(pointer).toMatchObject({
      modelVersionId: null,
      previousModelVersionId: first.id,
    });

    const actions = await prisma.auditLog.findMany({
      where: { entityId: { in: [first.id, second.id] } },
      orderBy: { createdAt: 'asc' },
      select: { action: true, actorUserId: true },
    });
    expect(actions.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        'MODEL_ACTIVATED',
        'MODEL_ROLLED_BACK',
        'MODEL_RETIRED',
        'MODEL_DEACTIVATED',
      ]),
    );
    expect(actions.every((a) => a.actorUserId)).toBe(true);

    // Re-activate for the inference test below.
    await api('admin1').post(`/admin/ml/models/${first.id}/activate`, reason).expect(200);
  });

  it('adds advisory predictions without changing the analysis or the problem, and monitors privately', async () => {
    const inference = app.get(ModelInferenceService);
    const config = app.get(AppConfig);
    inference.invalidate();
    // Off by default: nothing is called.
    const predict = vi.spyOn(ai, 'predictWithModel');
    expect(await inference.predict(TASK, { title: 'x', description: 'y' })).toBeNull();
    expect(predict).not.toHaveBeenCalled();

    vi.spyOn(config, 'ml', 'get').mockReturnValue({
      ...config.ml,
      inferenceEnabled: true,
      activeCacheSeconds: 0,
    });
    predict.mockResolvedValue({
      ok: true,
      body: {
        label: 'HIGH',
        confidence: 0.71,
        abstained: false,
        missing_features: [],
        latency_ms: 3,
      },
    });

    const reporter = await prisma.user.findUniqueOrThrow({
      where: { email: 'citizen@samadhaan.dev' },
    });
    const secret = `sewagepipeburst${run}`;
    const problem = await prisma.problem.create({
      data: {
        reporterId: reporter.id,
        title: `ML e2e ${secret}`,
        description: 'Sewage pipe burst flooding the lane outside the clinic.',
        category: 'DRAINAGE',
        city: 'Pune',
        latitude: 18.52,
        longitude: 73.85,
        status: 'SUBMITTED',
      },
    });
    problemId = problem.id;
    const analysis = await prisma.problemAiAnalysis.create({
      data: {
        problemId: problem.id,
        modelName: 'provider-model',
        modelVersion: '1',
        analysisType: 'INITIAL_ANALYSIS',
        category: 'DRAINAGE',
        urgency: 'MEDIUM',
        processingStatus: 'COMPLETED',
        rawResult: { provider: 'test' },
      },
    });

    await inference.annotateAnalysis(analysis.id, {
      title: problem.title,
      description: problem.description,
      category: problem.category,
    });

    const after = await prisma.problemAiAnalysis.findUniqueOrThrow({
      where: { id: analysis.id },
    });
    expect(after.urgency).toBe('MEDIUM'); // the provider's result stands
    expect(after.rawResult).toMatchObject({
      provider: 'test',
      mlPredictions: { [TASK]: { label: 'HIGH', advisory: true } },
    });
    const unchanged = await prisma.problem.findUniqueOrThrow({
      where: { id: problem.id },
    });
    expect(unchanged.urgency).toBe(problem.urgency);

    const rows = await prisma.modelInference.findMany({ where: { task: TASK } });
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toContain(secret);
    expect(JSON.stringify(rows)).not.toContain(problem.id);

    const report = await api('admin1')
      .get(`/admin/ml/monitoring?task=${TASK}&days=1`)
      .expect(200);
    const data = report.body.data;
    expect(data.labelledPerformance.available).toBe(false);
    expect(data.models[0]).toMatchObject({
      outcomes: { OK: rows.length },
      fallbackRate: 0,
    });
    expect(
      data.models[0].drift.every(
        (d: { status: string }) => d.status === 'not_assessable',
      ),
    ).toBe(true);
    expect(data.configurationChanges.length).toBeGreaterThan(0);
    await api('citizen').get(`/admin/ml/monitoring?task=${TASK}`).expect(403);
  });
});
