import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { AppConfig } from '../config/app.config.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  Prisma,
  type ModelInferenceOutcome,
  type ModelTask,
} from '../generated/prisma/client.js';
import { confidenceBin, driftCheck, type DriftCheck } from './model-monitoring.js';

export interface InferenceRecord {
  task: ModelTask;
  modelVersionId: string | null;
  outcome: ModelInferenceOutcome;
  latencyMs: number | null;
  predictedLabel: string | null;
  confidence: number | null;
  abstainReason: string | null;
  missingFeatures: number;
  inputLength: string | null;
}

type Counts = Record<string, number>;
const FAILURES: ModelInferenceOutcome[] = ['ERROR', 'TIMEOUT', 'ARTIFACT_ERROR'];

const add = (counts: Counts, key: string, n: number) => {
  counts[key] = (counts[key] ?? 0) + n;
};
const sum = (counts: Counts) => Object.values(counts).reduce((a, b) => a + b, 0);
const rate = (part: number, whole: number) =>
  whole ? Number((part / whole).toFixed(4)) : 0;

/**
 * Model monitoring (Prompt 28). Privacy-preserving by construction: rows hold
 * task, version, outcome, latency, label, confidence, a missing-feature count
 * and an input-length bucket — no text, no problem or user id.
 *
 * The report separates what can be known from these rows (failures, fallbacks,
 * latency, prediction and confidence distributions, data and prediction
 * drift) from what cannot: accuracy. Accuracy needs authorised human labels
 * linked to predictions, and the report says so instead of inferring it from
 * distributions.
 */
@Injectable()
export class ModelMonitoringService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ModelMonitoringService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    if (this.config.nodeEnv === 'test') return;
    this.timer = setInterval(() => void this.prune(), 60 * 60 * 1000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async record(entry: InferenceRecord): Promise<void> {
    try {
      await this.prisma.modelInference.create({
        data: {
          ...entry,
          confidence:
            entry.confidence === null
              ? null
              : new Prisma.Decimal(entry.confidence.toFixed(4)),
        },
      });
    } catch (error) {
      this.logger.warn(`Inference monitoring row not written: ${String(error)}`);
    }
  }

  /** Deletes rows past the retention window. */
  async prune(): Promise<number> {
    const cutoff = new Date(Date.now() - this.config.ml.retentionDays * 86_400_000);
    const { count } = await this.prisma.modelInference.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    if (count) this.logger.log(`Pruned ${count} inference monitoring rows`);
    return count;
  }

  async report(task: ModelTask, days: number) {
    const now = Date.now();
    const since = new Date(now - days * 86_400_000);
    const before = new Date(now - 2 * days * 86_400_000);
    const { driftPsiWarn: warn, minSamples } = this.config.ml;

    const rows = await this.prisma.$queryRaw<
      Array<{
        current: boolean;
        version: string | null;
        outcome: ModelInferenceOutcome;
        label: string | null;
        length: string | null;
        conf: number | null;
        missing: boolean;
        n: number;
      }>
    >`
      SELECT "createdAt" >= ${since} AS current,
             "modelVersionId"::text AS version,
             outcome,
             "predictedLabel" AS label,
             "inputLength" AS length,
             confidence::float8 AS conf,
             "missingFeatures" > 0 AS missing,
             count(*)::int AS n
      FROM model_inferences
      WHERE task = ${task}::"ModelTask" AND "createdAt" >= ${before}
      GROUP BY 1, 2, 3, 4, 5, 6, 7
    `;
    const latency = await this.prisma.$queryRaw<
      Array<{ version: string | null; p50: number | null; p95: number | null }>
    >`
      SELECT "modelVersionId"::text AS version,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY "latencyMs")::float8 AS p50,
             percentile_cont(0.95) WITHIN GROUP (ORDER BY "latencyMs")::float8 AS p95
      FROM model_inferences
      WHERE task = ${task}::"ModelTask" AND "createdAt" >= ${since}
      GROUP BY 1
    `;

    const versionIds = [
      ...new Set(rows.map((r) => r.version).filter((v): v is string => !!v)),
    ];
    const versions = await this.prisma.modelVersion.findMany({
      where: { id: { in: versionIds } },
      select: { id: true, version: true, trainingMetrics: true },
    });

    const perVersion = versionIds.map((id) => {
      const mine = rows.filter((r) => r.version === id);
      const cur = mine.filter((r) => r.current);
      const prev = mine.filter((r) => !r.current);
      const outcomes: Counts = {};
      const labels: Counts = {};
      const prevLabels: Counts = {};
      const lengths: Counts = {};
      const prevLengths: Counts = {};
      const confidence: Counts = {};
      let missing = 0;
      for (const r of cur) {
        add(outcomes, r.outcome, r.n);
        if (r.outcome === 'OK' || r.outcome === 'ABSTAINED') {
          add(labels, r.label ?? 'ABSTAINED', r.n);
          if (r.conf !== null) add(confidence, confidenceBin(r.conf), r.n);
        }
        if (r.length) add(lengths, r.length, r.n);
        if (r.missing) missing += r.n;
      }
      for (const r of prev) {
        if (r.outcome === 'OK' || r.outcome === 'ABSTAINED')
          add(prevLabels, r.label ?? 'ABSTAINED', r.n);
        if (r.length) add(prevLengths, r.length, r.n);
      }
      const total = sum(outcomes);
      const served = (outcomes.OK ?? 0) + (outcomes.ABSTAINED ?? 0);
      const meta = versions.find((v) => v.id === id);
      const reference = (
        meta?.trainingMetrics as
          { reference?: { predictionDistribution?: Counts } } | undefined
      )?.reference?.predictionDistribution;
      const drift: DriftCheck[] = [
        driftCheck(
          'prediction',
          `predictions, last ${days}d vs the ${days}d before`,
          prevLabels,
          labels,
          {
            minSamples,
            warn,
          },
        ),
        driftCheck(
          'data',
          `input length, last ${days}d vs the ${days}d before`,
          prevLengths,
          lengths,
          {
            minSamples,
            warn,
          },
        ),
      ];
      if (reference) {
        drift.push(
          driftCheck(
            'reference',
            'predictions vs the held-out test predictions at training time',
            reference,
            labels,
            {
              minSamples,
              warn,
            },
          ),
        );
      }
      const lat = latency.find((l) => l.version === id);
      return {
        modelVersionId: id,
        version: meta?.version ?? null,
        total,
        outcomes,
        failureRate: rate(
          FAILURES.reduce((n, o) => n + (outcomes[o] ?? 0), 0),
          total,
        ),
        fallbackRate: rate(total - served, total),
        inputSchemaFailures: outcomes.INPUT_SCHEMA ?? 0,
        abstentionRate: rate(outcomes.ABSTAINED ?? 0, total),
        missingFeatureRate: rate(missing, total),
        latencyMs: { p50: lat?.p50 ?? null, p95: lat?.p95 ?? null },
        predictionDistribution: labels,
        confidenceHistogram: confidence,
        inputLength: lengths,
        drift,
        warnings: drift
          .filter((d) => d.status === 'shift')
          .map(
            (d) =>
              `${d.kind} distribution shift (PSI ${d.psi}) — investigate before trusting predictions`,
          ),
      };
    });

    const changes = await this.prisma.auditLog.findMany({
      where: {
        action: { in: ['MODEL_ACTIVATED', 'MODEL_ROLLED_BACK', 'MODEL_DEACTIVATED'] },
        createdAt: { gte: before },
        metadata: { path: ['task'], equals: task },
      },
      orderBy: { createdAt: 'asc' },
      select: { action: true, entityId: true, createdAt: true },
    });

    return {
      task,
      windowDays: days,
      thresholds: { psiWarn: warn, minSamples },
      models: perVersion,
      configurationChanges: changes.map((c) => ({
        action: c.action,
        modelVersionId: c.entityId,
        at: c.createdAt,
      })),
      notes: [
        'Drift is computed per model version, so a version change is never reported as drift; configuration changes in the window are listed separately.',
        'Prediction and data drift describe distributions only. They are not accuracy.',
      ],
      labelledPerformance: {
        available: false,
        reason:
          'No authorised human label source is linked to these predictions yet. Accuracy is measured offline with `python -m ml evaluate` on a reviewed dataset (docs/MODEL_MONITORING.md).',
      },
    };
  }
}
