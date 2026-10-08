import { Injectable, Logger } from '@nestjs/common';
import {
  PRIORITY_FEATURES,
  type PriorityAssessmentView,
  type PriorityFeatureKey,
  type PriorityGuidance,
  type PriorityReason,
  type PriorityTier,
} from '@samadhaan/shared';
import { AppConfig } from '../config/app.config.js';
import { PrismaService } from '../database/prisma.service.js';
import { DomainEventBus } from '../events/domain-event-bus.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  ASSESSABLE_STATUSES,
  PriorityFeatureService,
  type PreviousAssessment,
} from './priority-feature.service.js';
import {
  FEATURE_LABELS,
  FEATURE_VERSION,
  describeChanges,
  explain,
  normaliseWeights,
  outcomeHash,
  priorityModelFor,
  type ComparableAssessment,
  type FeatureValue,
} from './priority-model.js';

/** Column per feature on `problem_priority_assessments`. */
const COLUMN: Record<PriorityFeatureKey, string> = {
  severity: 'severityScore',
  urgency: 'urgencyScore',
  communityImpact: 'communityImpactScore',
  safetyRisk: 'safetyRiskScore',
  geographicImpact: 'geographicImpactScore',
  recency: 'recencyScore',
  affectedPopulation: 'affectedPopulationScore',
  evidence: 'evidenceScore',
};

type AssessmentRow = Prisma.ProblemPriorityAssessmentGetPayload<object>;

export interface CalculationResult {
  assessmentId: string;
  score: number;
  tier: PriorityTier;
  /** A new history row was written (false: the latest was confirmed). */
  created: boolean;
  previousTier: PriorityTier | null;
}

const num = (value: Prisma.Decimal | null) => (value === null ? null : Number(value));

/**
 * Runs the priority pipeline for one problem (Prompt 21):
 *
 *   load ─▶ extract features (deterministic + AI-assisted, reused when
 *   unchanged) ─▶ score (PriorityModel) ─▶ tier ─▶ explanation ─▶ persist
 *   (history de-duplicated) ─▶ PRIORITY_TIER_CHANGED when the tier moved
 *
 * Advisory only: it writes the assessment and the problem's denormalised
 * score and tier, and nothing else — no status, allocation or override.
 */
@Injectable()
export class PriorityCalculationService {
  private readonly logger = new Logger(PriorityCalculationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly features: PriorityFeatureService,
    private readonly events: DomainEventBus,
    private readonly config: AppConfig,
  ) {}

  async calculate(
    problemId: string,
    trigger: string,
    options: { forceAi?: boolean; now?: Date } = {},
  ): Promise<CalculationResult | null> {
    const settings = this.config.priority;
    if (!settings.enabled) return null;
    const problem = await this.features.load(problemId);
    if (
      !problem ||
      !(ASSESSABLE_STATUSES as readonly string[]).includes(problem.status)
    ) {
      return null; // history is kept; nothing new is assessed
    }

    const previous = await this.prisma.problemPriorityAssessment.findFirst({
      where: { problemId },
      orderBy: { calculatedAt: 'desc' },
    });
    const extraction = await this.features.extract(
      problem,
      previous
        ? ({
            aiInputsHash: previous.aiInputsHash,
            aiStatus: previous.aiStatus,
            calculatedAt: previous.calculatedAt,
            featureMetadata: previous.featureMetadata,
            guidance: previous.guidance,
          } satisfies PreviousAssessment)
        : null,
      options,
    );
    const model = priorityModelFor(settings.model);
    const output = model.score(extraction.features, settings);
    const reasons = explain(extraction.features, output, { info: extraction.info });

    const components = Object.fromEntries(
      PRIORITY_FEATURES.map((key) => [
        key,
        extraction.features[key].value === null
          ? null
          : Number(extraction.features[key].value!.toFixed(4)),
      ]),
    ) as ComparableAssessment['components'];
    const next: ComparableAssessment = {
      score: output.score,
      tier: output.tier,
      components,
    };
    const hash = outcomeHash(next, { scoring: model.version, feature: FEATURE_VERSION });
    const weights = normaliseWeights(settings.weights);
    const ai = extraction.ai;
    const aiStatus = ai.reused ? 'REUSED' : ai.status;

    const featureMetadata = {
      features: Object.fromEntries(
        PRIORITY_FEATURES.map((key) => [
          key,
          {
            ...extraction.features[key],
            weight: Number(weights[key].toFixed(4)),
            contribution: output.contributions[key],
          },
        ]),
      ),
      ai: { status: ai.status, features: ai.features },
      facts: extraction.facts,
      floor: output.floor,
      thresholds: settings.tiers,
    };

    const result = await this.prisma.$transaction(async (tx) => {
      // One calculation per problem at a time, across API instances.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`priority:${problemId}`}))`;
      const latest = await tx.problemPriorityAssessment.findFirst({
        where: { problemId },
        orderBy: { calculatedAt: 'desc' },
      });
      const now = new Date();
      let id: string;
      let created = false;
      if (latest && latest.outcomeHash === hash) {
        // Nothing material changed: confirm, keep the AI block current.
        await tx.problemPriorityAssessment.update({
          where: { id: latest.id },
          data: {
            confirmedAt: now,
            aiStatus,
            modelName: ai.features?.modelName ?? null,
            modelVersion: ai.features?.modelVersion ?? null,
            promptVersion: ai.features?.promptVersion ?? null,
            featureMetadata: featureMetadata as Prisma.InputJsonValue,
            explanation: reasons as unknown as Prisma.InputJsonValue,
            aiInputsHash: extraction.aiInputsHash,
            guidance: extraction.guidance as unknown as Prisma.InputJsonValue,
          },
        });
        id = latest.id;
      } else {
        const row = await tx.problemPriorityAssessment.create({
          data: {
            problemId,
            priorityScore: output.score,
            priorityTier: output.tier,
            ...Object.fromEntries(
              PRIORITY_FEATURES.map((key) => [COLUMN[key], components[key]]),
            ),
            confidence: output.confidence,
            dataCompleteness: output.dataCompleteness,
            modelName: ai.features?.modelName ?? null,
            modelVersion: ai.features?.modelVersion ?? null,
            promptVersion: ai.features?.promptVersion ?? null,
            aiStatus,
            scoringModel: model.name,
            scoringVersion: model.version,
            featureVersion: FEATURE_VERSION,
            explanation: reasons as unknown as Prisma.InputJsonValue,
            featureMetadata: featureMetadata as Prisma.InputJsonValue,
            guidance: extraction.guidance as unknown as Prisma.InputJsonValue,
            changes: describeChanges(latest ? comparable(latest) : null, next),
            outcomeHash: hash,
            aiInputsHash: extraction.aiInputsHash,
            trigger: trigger.slice(0, 40),
            calculatedAt: now,
            confirmedAt: now,
          },
        });
        id = row.id;
        created = true;
      }
      // Raw, so the problem's `updatedAt` (a real-change signal elsewhere) is untouched.
      await tx.$executeRaw`
        UPDATE problems
        SET "priorityScore" = ${output.score}, "priorityTier" = ${output.tier}::"PriorityTier",
            "priorityAssessedAt" = ${now}
        WHERE id = ${problemId}::uuid
      `;
      return {
        assessmentId: id,
        created,
        previousTier: (latest?.priorityTier ?? null) as PriorityTier | null,
      };
    });

    this.logger.log(
      `${problem.publicId}: priority ${output.score.toFixed(1)} ${output.tier} ` +
        `(confidence ${output.confidence.toFixed(2)}, completeness ${output.dataCompleteness.toFixed(2)}, ` +
        `ai ${aiStatus}, ${result.created ? 'new' : 'confirmed'}, ${trigger})`,
    );

    if (result.previousTier !== output.tier) {
      this.events.publish({
        type: 'PRIORITY_TIER_CHANGED',
        problemId,
        problemPublicId: problem.publicId,
        assessmentId: result.assessmentId,
        fromTier: result.previousTier,
        toTier: output.tier,
        score: output.score,
      });
    }
    return { ...result, score: output.score, tier: output.tier };
  }

  // --------------------------------------------------------------- views

  async latest(problemId: string): Promise<AssessmentRow | null> {
    return this.prisma.problemPriorityAssessment.findFirst({
      where: { problemId },
      orderBy: { calculatedAt: 'desc' },
    });
  }

  async history(problemId: string, limit = 10): Promise<AssessmentRow[]> {
    return this.prisma.problemPriorityAssessment.findMany({
      where: { problemId },
      orderBy: { calculatedAt: 'desc' },
      take: limit,
    });
  }

  /** The full assessment, for government officials. */
  async view(row: AssessmentRow): Promise<PriorityAssessmentView> {
    const meta = (row.featureMetadata ?? {}) as {
      features?: Record<
        string,
        FeatureValue & { weight?: number; contribution?: number }
      >;
    };
    const settings = this.config.priority;
    const confidence = Number(row.confidence);
    const completeness = Number(row.dataCompleteness);
    return {
      id: row.id,
      score: Number(row.priorityScore),
      tier: row.priorityTier as PriorityTier,
      confidence,
      dataCompleteness: completeness,
      provisional:
        confidence < settings.provisional.confidence ||
        completeness < settings.provisional.completeness,
      reasons: (Array.isArray(row.explanation)
        ? row.explanation
        : []) as unknown as PriorityReason[],
      breakdown: PRIORITY_FEATURES.map((key) => {
        const f = meta.features?.[key];
        return {
          key,
          label: FEATURE_LABELS[key],
          value: f?.value ?? null,
          confidence: f?.confidence ?? 0,
          available: f?.value !== null && f?.value !== undefined,
          weight: f?.weight ?? 0,
          contribution: f?.contribution ?? 0,
          source: f?.source ?? '',
          evidence: f?.evidence ?? [],
          note: f?.note ?? null,
        };
      }),
      model: {
        scoringModel: row.scoringModel,
        scoringVersion: row.scoringVersion,
        featureVersion: row.featureVersion,
        aiStatus: row.aiStatus,
        aiModel:
          row.modelName && row.modelVersion
            ? {
                name: row.modelName,
                version: row.modelVersion,
                promptVersion: row.promptVersion,
              }
            : null,
      },
      guidance: await this.liveGuidance(row.guidance),
      calculatedAt: row.calculatedAt.toISOString(),
      confirmedAt: row.confirmedAt.toISOString(),
    };
  }

  /** Stored guidance, re-checked: only passages still PUBLIC and present. */
  private async liveGuidance(stored: unknown): Promise<PriorityGuidance[]> {
    if (!Array.isArray(stored) || stored.length === 0) return [];
    const items = stored as Array<Omit<PriorityGuidance, 'href'>>;
    const live = await this.prisma.knowledgeChunk.findMany({
      where: {
        id: { in: items.map((g) => g.chunkId) },
        source: { visibility: 'PUBLIC', status: 'COMPLETED' },
      },
      select: { id: true },
    });
    const ok = new Set(live.map((c) => c.id));
    return items
      .filter((g) => ok.has(g.chunkId))
      .map((g) => ({
        ...g,
        href: `/knowledge/sources/${g.sourceId}#chunk-${g.chunkId}`,
      }));
  }
}

function comparable(row: AssessmentRow): ComparableAssessment {
  return {
    score: Number(row.priorityScore),
    tier: row.priorityTier as PriorityTier,
    components: Object.fromEntries(
      PRIORITY_FEATURES.map((key) => [
        key,
        num(
          (row as unknown as Record<string, Prisma.Decimal | null>)[COLUMN[key]] ?? null,
        ),
      ]),
    ) as ComparableAssessment['components'],
  };
}
