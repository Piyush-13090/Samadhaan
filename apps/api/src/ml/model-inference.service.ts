import { Injectable, Logger } from '@nestjs/common';
import { AiService } from '../ai/ai.service.js';
import { AppConfig } from '../config/app.config.js';
import { PrismaService } from '../database/prisma.service.js';
import type {
  ModelInferenceOutcome,
  ModelTask,
  Prisma,
} from '../generated/prisma/client.js';
import {
  ANALYSIS_TASKS,
  TASK_SPECS,
  lengthBucket,
  parsePrediction,
  type ModelPrediction,
} from './ml-tasks.js';
import { ModelMonitoringService } from './model-monitoring.service.js';

export interface ActiveModelRef {
  id: string;
  task: ModelTask;
  version: string;
  sha256: string;
}

export interface AdvisoryPrediction extends ModelPrediction {
  task: ModelTask;
  modelVersionId: string;
  modelVersion: string;
  /** Always true: a registry model never decides anything by itself. */
  advisory: true;
}

/**
 * Registry-backed inference (Prompt 28).
 *
 * Calls a model only when `ML_INFERENCE_ENABLED` is on *and* the registry has
 * an ACTIVE version for the task. Any failure — no model, timeout, missing or
 * corrupt artifact, input or output outside the schema — returns `null`, so the
 * caller keeps its existing behaviour (the provider path). Each attempt is
 * recorded for monitoring without input text or identifiers.
 */
@Injectable()
export class ModelInferenceService {
  private readonly logger = new Logger(ModelInferenceService.name);
  private readonly cache = new Map<
    ModelTask,
    { at: number; value: ActiveModelRef | null }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly config: AppConfig,
    private readonly monitoring: ModelMonitoringService,
  ) {}

  invalidate(task?: ModelTask): void {
    if (task) this.cache.delete(task);
    else this.cache.clear();
  }

  async active(task: ModelTask): Promise<ActiveModelRef | null> {
    const ttl = this.config.ml.activeCacheSeconds * 1000;
    const hit = this.cache.get(task);
    if (hit && Date.now() - hit.at < ttl) return hit.value;
    const row = await this.prisma.activeModel.findUnique({
      where: { task },
      include: { modelVersion: true },
    });
    const v = row?.modelVersion;
    // Belt and braces: the pointer must name an ACTIVE, non-synthetic version.
    const value =
      v && v.status === 'ACTIVE' && !v.syntheticData
        ? { id: v.id, task, version: v.version, sha256: v.artifactSha256 }
        : null;
    this.cache.set(task, { at: Date.now(), value });
    return value;
  }

  async predict(
    task: ModelTask,
    input: Record<string, unknown>,
    requestId?: string,
  ): Promise<AdvisoryPrediction | null> {
    if (!this.config.ml.inferenceEnabled) return null;
    const model = await this.active(task).catch(() => null);
    if (!model) return null;

    const started = Date.now();
    const call = await this.ai.predictWithModel(
      { task: TASK_SPECS[task].aiTask, version: model.version, sha256: model.sha256 },
      input,
      { timeoutMs: this.config.ml.inferenceTimeoutMs, requestId },
    );
    const latencyMs = Date.now() - started;
    const chars = Object.values(input)
      .filter((v): v is string => typeof v === 'string')
      .reduce((n, v) => n + v.length, 0);

    let outcome: ModelInferenceOutcome;
    let prediction: ModelPrediction | null = null;
    if (call.ok) {
      prediction = parsePrediction(task, call.body);
      outcome = prediction ? (prediction.abstained ? 'ABSTAINED' : 'OK') : 'ERROR';
    } else if (call.code === 'INPUT_SCHEMA') {
      outcome = 'INPUT_SCHEMA';
    } else if (call.code.startsWith('ARTIFACT_')) {
      outcome = 'ARTIFACT_ERROR';
    } else {
      outcome = call.code === 'TIMEOUT' ? 'TIMEOUT' : 'ERROR';
    }
    if (outcome !== 'OK' && outcome !== 'ABSTAINED') {
      this.logger.warn(`${task} ${model.version}: ${outcome} — falling back`);
    }

    await this.monitoring.record({
      task,
      modelVersionId: model.id,
      outcome,
      latencyMs,
      predictedLabel: prediction?.label ?? null,
      confidence: prediction ? prediction.confidence : null,
      abstainReason: prediction?.abstainReason ?? null,
      missingFeatures: prediction?.missingFeatures.length ?? 0,
      inputLength: lengthBucket(chars),
    });

    if (!prediction) return null;
    return {
      ...prediction,
      task,
      modelVersionId: model.id,
      modelVersion: model.version,
      advisory: true,
    };
  }

  /**
   * Adds advisory predictions to a completed analysis, under
   * `rawResult.mlPredictions` (never published; see problem-analysis.service).
   * The analysis's own fields and the problem itself are never changed: the
   * existing provider result stays primary and a reviewer still decides.
   */
  async annotateAnalysis(
    analysisId: string,
    problem: { title: string; description: string; category: string },
    requestId?: string,
  ): Promise<void> {
    if (!this.config.ml.inferenceEnabled) return;
    try {
      const predictions: Record<string, unknown> = {};
      for (const task of ANALYSIS_TASKS) {
        const input =
          task === 'PROBLEM_CATEGORY'
            ? { title: problem.title, description: problem.description }
            : {
                title: problem.title,
                description: problem.description,
                category: problem.category,
              };
        const p = await this.predict(task, input, requestId);
        if (p) {
          predictions[task] = {
            modelVersion: p.modelVersion,
            label: p.label,
            confidence: p.confidence,
            abstained: p.abstained,
            abstainReason: p.abstainReason,
            advisory: true,
            at: new Date().toISOString(),
          };
        }
      }
      if (Object.keys(predictions).length === 0) return;
      const row = await this.prisma.problemAiAnalysis.findUnique({
        where: { id: analysisId },
        select: { rawResult: true },
      });
      const raw = (row?.rawResult ?? {}) as Prisma.JsonObject;
      await this.prisma.problemAiAnalysis.update({
        where: { id: analysisId },
        data: {
          rawResult: { ...raw, mlPredictions: predictions } as Prisma.InputJsonObject,
        },
      });
    } catch (error) {
      // Advisory and best-effort: never fails the analysis it decorates.
      this.logger.warn(
        `Advisory predictions skipped for analysis ${analysisId}: ${String(error)}`,
      );
    }
  }
}
