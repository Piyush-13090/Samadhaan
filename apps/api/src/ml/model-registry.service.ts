import { Injectable, Logger } from '@nestjs/common';
import { AiService } from '../ai/ai.service.js';
import { AppException } from '../common/app.exception.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  Prisma,
  type ModelStatus,
  type ModelTask,
  type ModelVersion,
} from '../generated/prisma/client.js';
import { TASK_SPECS, artifactUriFor, MODEL_TASKS } from './ml-tasks.js';
import { ModelInferenceService } from './model-inference.service.js';
import type {
  ApproveModelDto,
  LifecycleReasonDto,
  RecordEvaluationDto,
  RegisterModelDto,
} from './model-registry.dto.js';

type Actor = { id: string };

export type ModelAuditAction =
  | 'MODEL_REGISTERED'
  | 'MODEL_EVALUATION_RECORDED'
  | 'MODEL_APPROVED'
  | 'MODEL_ACTIVATED'
  | 'MODEL_ACTIVATION_REFUSED'
  | 'MODEL_ROLLED_BACK'
  | 'MODEL_DEACTIVATED'
  | 'MODEL_RETIRED';

/** Largest metrics document accepted (bytes of JSON). */
const MAX_METRICS_BYTES = 256 * 1024;

/**
 * Number of held-out examples a metrics document reports: `n` at the top, or
 * under `test` (the training run's shape). Zero means nothing was measured.
 */
export function measuredCount(metrics: Record<string, unknown>): number {
  const direct = Number((metrics as { n?: unknown }).n);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const test = (metrics as { test?: { n?: unknown } }).test;
  const nested = Number(test?.n);
  return Number.isFinite(nested) && nested > 0 ? nested : 0;
}

/**
 * Model registry and lifecycle (Prompt 28).
 *
 * EXPERIMENTAL -> EVALUATED -> APPROVED -> ACTIVE, with RETIRED from anywhere
 * but ACTIVE. Every rule is enforced here and the important ones again in the
 * database (CHECK constraints and a one-ACTIVE-per-task index):
 *
 * - registration needs the training run's held-out test metrics, schema
 *   versions matching the task, and the canonical artifact location;
 * - synthetic-data models can be registered (pipeline testing) but never
 *   evaluated for promotion, approved or activated;
 * - approval needs a recorded evaluation and a different administrator from
 *   the one who registered the model (separation of duties);
 * - activation needs approval *and* a fresh check by the AI service that the
 *   artifact exists, matches its sha256 and has compatible schemas;
 * - nothing is activated automatically, ever — not on registration, not on a
 *   better score;
 * - activation keeps the previous version as the rollback target; rollback
 *   re-verifies it.
 *
 * Every transition writes an audit entry in the same transaction.
 */
@Injectable()
export class ModelRegistryService {
  private readonly logger = new Logger(ModelRegistryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly inference: ModelInferenceService,
  ) {}

  list(task?: ModelTask): Promise<ModelVersion[]> {
    return this.prisma.modelVersion.findMany({
      where: task ? { task } : {},
      orderBy: [{ task: 'asc' }, { createdAt: 'desc' }],
      take: 200,
    });
  }

  async get(id: string): Promise<ModelVersion> {
    const row = await this.prisma.modelVersion.findUnique({ where: { id } });
    if (!row) throw AppException.notFound('Model version');
    return row;
  }

  /** The serving state of every task: active version and rollback target. */
  async tasks() {
    const rows = await this.prisma.activeModel.findMany({
      include: {
        modelVersion: { select: { id: true, version: true, status: true } },
        previousModelVersion: { select: { id: true, version: true, status: true } },
      },
    });
    return MODEL_TASKS.map((task) => {
      const row = rows.find((r) => r.task === task);
      return {
        task,
        active: row?.modelVersion ?? null,
        rollbackTarget: row?.previousModelVersion ?? null,
        activatedAt: row?.activatedAt ?? null,
        reason: row?.reason ?? null,
      };
    });
  }

  async register(dto: RegisterModelDto, actor: Actor): Promise<ModelVersion> {
    const spec = TASK_SPECS[dto.task];
    if (
      dto.featureSchemaVersion !== spec.featureSchema ||
      dto.labelSchemaVersion !== spec.labelSchema
    ) {
      throw AppException.badRequest(
        `Schema versions must be ${spec.featureSchema} / ${spec.labelSchema} for ${dto.task}`,
      );
    }
    if (dto.artifactUri !== artifactUriFor(dto.task, dto.version)) {
      throw AppException.badRequest(
        `artifactUri must be ${artifactUriFor(dto.task, dto.version)}`,
      );
    }
    this.checkSize(dto.metrics, dto.trainingConfig);
    if (measuredCount(dto.metrics) === 0) {
      throw AppException.badRequest(
        'metrics must include the training run’s held-out test evaluation (test.n > 0)',
      );
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.modelVersion.create({
          data: {
            task: dto.task,
            version: dto.version,
            modelFormat: dto.modelFormat,
            artifactUri: dto.artifactUri,
            artifactSha256: dto.artifactSha256,
            featureSchemaVersion: dto.featureSchemaVersion,
            labelSchemaVersion: dto.labelSchemaVersion,
            datasetName: dto.datasetName,
            datasetVersion: dto.datasetVersion,
            datasetFingerprint: dto.datasetFingerprint,
            syntheticData: dto.syntheticData,
            trainingConfig: dto.trainingConfig as Prisma.InputJsonObject,
            codeRevision: dto.codeRevision ?? null,
            trainedAt: new Date(dto.trainedAt),
            trainingMetrics: dto.metrics as Prisma.InputJsonObject,
            registeredById: actor.id,
          },
        });
        await audit(tx, actor, 'MODEL_REGISTERED', row.id, {
          task: row.task,
          version: row.version,
          sha256: row.artifactSha256,
          datasetVersion: row.datasetVersion,
          syntheticData: row.syntheticData,
        });
        return row;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw AppException.conflict(`${dto.task} ${dto.version} is already registered`);
      }
      throw error;
    }
  }

  async recordEvaluation(id: string, dto: RecordEvaluationDto, actor: Actor) {
    const row = await this.get(id);
    if (row.syntheticData) {
      throw AppException.conflict(
        'A model trained on synthetic data cannot be evaluated for promotion',
      );
    }
    this.checkSize(dto.metrics);
    if (measuredCount(dto.metrics) === 0) {
      throw AppException.badRequest('metrics must report a held-out evaluation (n > 0)');
    }
    return this.transition(row, ['EXPERIMENTAL', 'EVALUATED'], 'EVALUATED', actor, {
      data: {
        evaluationDatasetVersion: dto.evaluationDatasetVersion,
        evaluationMetrics: dto.metrics as Prisma.InputJsonObject,
        evaluatedAt: new Date(),
        evaluatedById: actor.id,
      },
      action: 'MODEL_EVALUATION_RECORDED',
      metadata: { evaluationDatasetVersion: dto.evaluationDatasetVersion },
    });
  }

  async approve(id: string, dto: ApproveModelDto, actor: Actor) {
    const row = await this.get(id);
    if (row.registeredById === actor.id) {
      throw AppException.forbidden(
        'Separation of duties: a model must be approved by a different administrator than the one who registered it',
      );
    }
    if (row.syntheticData) {
      throw AppException.conflict('A model trained on synthetic data cannot be approved');
    }
    return this.transition(row, ['EVALUATED'], 'APPROVED', actor, {
      data: { approvedById: actor.id, approvedAt: new Date(), approvalNote: dto.note },
      action: 'MODEL_APPROVED',
      metadata: {},
    });
  }

  async retire(id: string, dto: LifecycleReasonDto, actor: Actor) {
    const row = await this.get(id);
    if (row.status === 'ACTIVE') {
      throw AppException.conflict(
        'Deactivate or roll back the task before retiring its active model',
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await this.transitionIn(
        tx,
        row,
        ['EXPERIMENTAL', 'EVALUATED', 'APPROVED'],
        'RETIRED',
        { retiredAt: new Date() },
      );
      // A retired version can no longer be a rollback target.
      await tx.activeModel.updateMany({
        where: { previousModelVersionId: id },
        data: { previousModelVersionId: null },
      });
      await audit(tx, actor, 'MODEL_RETIRED', id, { task: row.task, reason: dto.reason });
      return updated;
    });
  }

  async activate(id: string, dto: LifecycleReasonDto, actor: Actor, requestId?: string) {
    const row = await this.get(id);
    if (row.status === 'ACTIVE')
      throw AppException.conflict('This version is already active');
    if (
      row.status !== 'APPROVED' ||
      row.syntheticData ||
      !row.approvedById ||
      !row.evaluatedAt
    ) {
      throw AppException.conflict(
        'Only an evaluated, approved, non-synthetic model can be activated',
      );
    }
    await this.verifyArtifact(row, actor, requestId);

    const result = await this.prisma.$transaction(async (tx) => {
      await lockTask(tx, row.task);
      const current = await tx.activeModel.findUnique({ where: { task: row.task } });
      // Demote first: the one-ACTIVE-per-task index forbids even a moment
      // with two ACTIVE rows.
      if (current?.modelVersionId && current.modelVersionId !== id) {
        await tx.modelVersion.updateMany({
          where: { id: current.modelVersionId, status: 'ACTIVE' },
          data: { status: 'APPROVED' },
        });
      }
      const updated = await this.transitionIn(tx, row, ['APPROVED'], 'ACTIVE', {
        activatedAt: new Date(),
      });
      // The version being replaced becomes the rollback target; when the task
      // was switched off, the earlier target is kept — unless it is this one.
      const candidate =
        current?.modelVersionId ?? current?.previousModelVersionId ?? null;
      const previous = candidate === id ? null : candidate;
      await tx.activeModel.upsert({
        where: { task: row.task },
        create: {
          task: row.task,
          modelVersionId: id,
          previousModelVersionId: previous,
          activatedById: actor.id,
          activatedAt: new Date(),
          reason: dto.reason,
        },
        update: {
          modelVersionId: id,
          previousModelVersionId: previous,
          activatedById: actor.id,
          activatedAt: new Date(),
          reason: dto.reason,
        },
      });
      await audit(tx, actor, 'MODEL_ACTIVATED', id, {
        task: row.task,
        version: row.version,
        replaced: current?.modelVersionId ?? null,
        reason: dto.reason,
      });
      return updated;
    });
    this.inference.invalidate(row.task);
    this.logger.log(`Activated ${row.task} ${row.version}`);
    return result;
  }

  /** Swaps the active version and the rollback target, after re-verifying the target. */
  async rollback(
    task: ModelTask,
    dto: LifecycleReasonDto,
    actor: Actor,
    requestId?: string,
  ) {
    const pointer = await this.prisma.activeModel.findUnique({ where: { task } });
    if (!pointer?.previousModelVersionId) {
      throw AppException.conflict(`${task} has no previous version to roll back to`);
    }
    const target = await this.get(pointer.previousModelVersionId);
    if (target.status !== 'APPROVED' || target.syntheticData) {
      throw AppException.conflict('The rollback target is no longer approved');
    }
    await this.verifyArtifact(target, actor, requestId);

    const result = await this.prisma.$transaction(async (tx) => {
      await lockTask(tx, task);
      const current = await tx.activeModel.findUnique({ where: { task } });
      if (current?.previousModelVersionId !== target.id) {
        throw AppException.conflict('The active model changed; reload and try again');
      }
      if (current.modelVersionId) {
        await tx.modelVersion.updateMany({
          where: { id: current.modelVersionId, status: 'ACTIVE' },
          data: { status: 'APPROVED' },
        });
      }
      const updated = await this.transitionIn(tx, target, ['APPROVED'], 'ACTIVE', {
        activatedAt: new Date(),
      });
      await tx.activeModel.update({
        where: { task },
        data: {
          modelVersionId: target.id,
          previousModelVersionId: current.modelVersionId,
          activatedById: actor.id,
          activatedAt: new Date(),
          reason: dto.reason,
        },
      });
      await audit(tx, actor, 'MODEL_ROLLED_BACK', target.id, {
        task,
        from: current.modelVersionId,
        to: target.id,
        reason: dto.reason,
      });
      return updated;
    });
    this.inference.invalidate(task);
    return result;
  }

  /** Switches a task off: the existing provider path alone serves it. */
  async deactivate(task: ModelTask, dto: LifecycleReasonDto, actor: Actor) {
    const result = await this.prisma.$transaction(async (tx) => {
      await lockTask(tx, task);
      const current = await tx.activeModel.findUnique({ where: { task } });
      if (!current?.modelVersionId)
        throw AppException.conflict(`${task} has no active model`);
      await tx.modelVersion.updateMany({
        where: { id: current.modelVersionId, status: 'ACTIVE' },
        data: { status: 'APPROVED' },
      });
      await tx.activeModel.update({
        where: { task },
        data: {
          modelVersionId: null,
          previousModelVersionId: current.modelVersionId,
          activatedById: actor.id,
          activatedAt: new Date(),
          reason: dto.reason,
        },
      });
      await audit(tx, actor, 'MODEL_DEACTIVATED', current.modelVersionId, {
        task,
        reason: dto.reason,
      });
      return { task, active: null };
    });
    this.inference.invalidate(task);
    return result;
  }

  // ------------------------------------------------------------------ helpers

  private async verifyArtifact(row: ModelVersion, actor: Actor, requestId?: string) {
    const spec = TASK_SPECS[row.task];
    const check = await this.ai.verifyModelArtifact(
      { task: spec.aiTask, version: row.version, sha256: row.artifactSha256 },
      requestId,
    );
    let problem: string | null = null;
    if (!check.ok) {
      problem = `artifact verification failed (${check.code})`;
    } else {
      const r = check.report;
      if (r.sha256 !== row.artifactSha256) problem = 'artifact sha256 differs';
      else if (r.feature_schema_version !== spec.featureSchema)
        problem = 'feature schema differs';
      else if (r.label_schema_version !== spec.labelSchema)
        problem = 'label schema differs';
      else if (r.synthetic_data !== false)
        problem = 'artifact was trained on synthetic data';
    }
    if (problem) {
      await audit(this.prisma, actor, 'MODEL_ACTIVATION_REFUSED', row.id, {
        task: row.task,
        version: row.version,
        problem,
      });
      throw AppException.conflict(`Cannot activate: ${problem}`);
    }
  }

  private checkSize(...docs: unknown[]) {
    for (const doc of docs) {
      if (JSON.stringify(doc ?? null).length > MAX_METRICS_BYTES) {
        throw AppException.badRequest(
          'metrics and config documents must be under 256 KB',
        );
      }
    }
  }

  private transition(
    row: ModelVersion,
    from: ModelStatus[],
    to: ModelStatus,
    actor: Actor,
    change: {
      data: Prisma.ModelVersionUncheckedUpdateManyInput;
      action: ModelAuditAction;
      metadata: Prisma.InputJsonObject;
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const updated = await this.transitionIn(tx, row, from, to, change.data);
      await audit(tx, actor, change.action, row.id, {
        task: row.task,
        version: row.version,
        from: row.status,
        to,
        ...change.metadata,
      });
      return updated;
    });
  }

  /** Conditional update: succeeds only if the row is still in an allowed state. */
  private async transitionIn(
    tx: Prisma.TransactionClient,
    row: ModelVersion,
    from: ModelStatus[],
    to: ModelStatus,
    data: Prisma.ModelVersionUncheckedUpdateManyInput,
  ): Promise<ModelVersion> {
    const { count } = await tx.modelVersion.updateMany({
      where: { id: row.id, status: { in: from } },
      data: { ...data, status: to },
    });
    if (count !== 1) {
      throw AppException.conflict(
        `Model ${row.version} must be ${from.join(' or ')} to become ${to}`,
      );
    }
    return tx.modelVersion.findUniqueOrThrow({ where: { id: row.id } });
  }
}

/** Serialises lifecycle changes per task, including the first activation. */
async function lockTask(tx: Prisma.TransactionClient, task: ModelTask) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'model-task:' + task}))`;
}

async function audit(
  db: Prisma.TransactionClient,
  actor: Actor,
  action: ModelAuditAction,
  modelVersionId: string,
  metadata: Prisma.InputJsonObject,
) {
  await db.auditLog.create({
    data: {
      actorUserId: actor.id,
      action,
      entityType: 'ModelVersion',
      entityId: modelVersionId,
      metadata,
    },
  });
}
