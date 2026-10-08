import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { PriorityGuidance, ProblemCategory } from '@samadhaan/shared';
import { AiService } from '../ai/ai.service.js';
import type { AiPriorityFeatures } from '../ai/dto/priority.dto.js';
import { AppConfig } from '../config/app.config.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { KnowledgeRetrievalService } from '../knowledge/knowledge-retrieval.service.js';
import type { FeatureValue, PriorityFeatures } from './priority-model.js';

const LEVEL: Record<string, number> = { LOW: 0.25, MEDIUM: 0.5, HIGH: 0.75, CRITICAL: 1 };

/**
 * Category safety priors — how often a report in this category involves a
 * risk of physical harm. A documented judgement, deliberately given low
 * confidence (0.35) so it only matters when nothing better is known.
 */
export const CATEGORY_SAFETY_PRIOR: Record<ProblemCategory, number> = {
  ELECTRICITY: 0.8,
  PUBLIC_SAFETY: 0.8,
  WATER: 0.6,
  TRAFFIC: 0.55,
  DRAINAGE: 0.5,
  POTHOLES: 0.5,
  ROADS: 0.45,
  STREETLIGHTS: 0.45,
  SANITATION: 0.45,
  PUBLIC_INFRASTRUCTURE: 0.4,
  POLLUTION: 0.4,
  GARBAGE: 0.3,
  PUBLIC_TRANSPORT: 0.3,
  OTHER: 0.3,
  PARKS: 0.2,
};
const PRIOR_CONFIDENCE = 0.35;
/** A recorded level with no analysis behind it (the default is MEDIUM). */
const RECORDED_CONFIDENCE = 0.3;
const ACTIVE_STATUSES = ['SUBMITTED', 'UNDER_REVIEW', 'VERIFIED', 'IN_PROGRESS'];

/** Statuses the engine assesses: everything under review or being worked on. */
export const ASSESSABLE_STATUSES = [
  'SUBMITTED',
  'UNDER_REVIEW',
  'VERIFIED',
  'IN_PROGRESS',
] as const;

export interface ProblemForPriority {
  id: string;
  publicId: string;
  title: string;
  description: string;
  category: ProblemCategory;
  subcategory: string | null;
  status: string;
  severity: string;
  urgency: string;
  address: string | null;
  city: string | null;
  hasLocation: boolean;
  createdAt: Date;
  submittedAt: Date | null;
  duplicateOfId: string | null;
}

/** AI features as stored with an assessment, for reuse while inputs are unchanged. */
export interface StoredAi {
  status: 'COMPLETED' | 'UNAVAILABLE' | 'FAILED' | 'DISABLED';
  features: AiPriorityFeatures | null;
}

export interface Extraction {
  features: PriorityFeatures;
  ai: StoredAi & { reused: boolean };
  aiInputsHash: string;
  guidance: Array<Omit<PriorityGuidance, 'href'>>;
  /** Context lines that are not scored (resolution under way…). */
  info: string[];
  facts: Record<string, number | string | boolean | null>;
}

export interface PreviousAssessment {
  aiInputsHash: string | null;
  aiStatus: string;
  calculatedAt: Date;
  featureMetadata: unknown;
  guidance: unknown;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));
const saturate = (x: number, k: number) => 1 - Math.exp(-x / k);
const pct = (n: number) => `${Math.round(n * 100)}%`;
const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/**
 * The area sent to the AI service: neighbourhood and city only. Address
 * segments containing a digit (house and plot numbers, postcodes) are dropped,
 * so no street address leaves the API.
 */
export function aiLocality(address: string | null, city: string | null): string | null {
  const segments = (address ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && !/\d/.test(s) && s.toLowerCase() !== (city ?? '').toLowerCase());
  const area = segments.at(-1);
  return [area, city].filter(Boolean).join(', ') || null;
}

/** Confidence-weighted combination of independent estimates of one signal. */
export function combine(parts: Array<{ value: number | null; confidence: number }>): {
  value: number | null;
  confidence: number;
} {
  const usable = parts.filter((p) => p.value !== null && p.confidence > 0);
  const weight = usable.reduce((sum, p) => sum + p.confidence, 0);
  if (weight === 0) return { value: null, confidence: 0 };
  return {
    value: clamp01(
      usable.reduce((sum, p) => sum + (p.value ?? 0) * p.confidence, 0) / weight,
    ),
    confidence: Math.max(...usable.map((p) => p.confidence)),
  };
}

/**
 * Community impact, normalised to the area (fairness): distinct people
 * relative to what is typical within a few kilometres, saturating. Ten
 * supporters in a quiet ward count like thirty in a busy one.
 */
export function communityImpact(distinctPeople: number, localBaseline: number): number {
  return clamp01(saturate(distinctPeople / Math.max(3, localBaseline), 1));
}

/** Stated counts only, on a log scale: 10 → 0.26, 100 → 0.5, 1 000 → 0.75, 10 000 → 1. */
export function populationScore(
  count: number,
  unit: 'people' | 'households' | 'unknown',
): number {
  const people = unit === 'households' ? count * 3 : count;
  return clamp01(Math.log10(people + 1) / 4);
}

/**
 * Extracts every priority feature for one problem from existing data
 * (Prompt 21): the AI analysis, community engagement, duplicate reports,
 * PostGIS proximity, verification state — and, when its inputs changed, the
 * AI service's safety/urgency/impact signals. Missing data is reported as
 * unavailable, never filled in.
 */
@Injectable()
export class PriorityFeatureService {
  private readonly logger = new Logger(PriorityFeatureService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly knowledge: KnowledgeRetrievalService,
    private readonly config: AppConfig,
  ) {}

  async load(problemId: string): Promise<ProblemForPriority | null> {
    const rows = await this.prisma.$queryRaw<ProblemForPriority[]>`
      SELECT p.id, p."publicId", p.title, p.description, p.category::text AS category,
             p.subcategory, p.status::text AS status, p.severity::text AS severity,
             p.urgency::text AS urgency, p.address, p.city,
             p.location IS NOT NULL AS "hasLocation",
             p."createdAt", p."submittedAt", p."duplicateOfId"
      FROM problems p
      WHERE p.id = ${problemId}::uuid AND p."deletedAt" IS NULL
    `;
    return rows[0] ?? null;
  }

  async extract(
    problem: ProblemForPriority,
    previous: PreviousAssessment | null,
    options: { forceAi?: boolean; now?: Date } = {},
  ): Promise<Extraction> {
    const settings = this.config.priority;
    const now = options.now ?? new Date();

    const [analysis, signals] = await Promise.all([
      this.prisma.problemAiAnalysis.findFirst({
        where: {
          problemId: problem.id,
          analysisType: { in: ['INITIAL_ANALYSIS', 'REANALYSIS'] },
          processingStatus: 'COMPLETED',
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.signals(problem, now),
    ]);
    const raw = (analysis?.rawResult ?? {}) as { observations?: unknown };
    const observations = Array.isArray(raw.observations)
      ? raw.observations.filter((o): o is string => typeof o === 'string').slice(0, 5)
      : [];
    const analysisConfidence =
      analysis?.confidence === null || analysis?.confidence === undefined
        ? null
        : Number(analysis.confidence);

    // --- AI-assisted signals: reused while their inputs are unchanged. ------
    const aiInputs = {
      title: problem.title,
      description: problem.description,
      category: problem.category,
      subcategory: problem.subcategory,
      analysis: analysis ? `${analysis.id}:${analysis.updatedAt.toISOString()}` : null,
    };
    const aiInputsHash = createHash('sha256')
      .update(JSON.stringify(aiInputs))
      .digest('hex');
    const ai = await this.aiFeatures(
      problem,
      analysis,
      observations,
      aiInputsHash,
      previous,
      {
        forceAi: options.forceAi ?? false,
        now,
      },
    );
    const guidance = await this.guidance(problem, aiInputsHash, previous);
    const f = ai.features;
    const aiNote =
      ai.status === 'UNAVAILABLE'
        ? 'no AI model ran (development provider)'
        : ai.status === 'FAILED'
          ? 'the AI service was unavailable'
          : ai.status === 'DISABLED'
            ? 'AI-assisted features are switched off'
            : null;

    // --- Severity -----------------------------------------------------------
    const analysisSeverity =
      analysis?.severityScore !== null && analysis?.severityScore !== undefined
        ? Number(analysis.severityScore) / 10
        : analysis?.severity
          ? LEVEL[analysis.severity]!
          : null;
    const verified = problem.status === 'VERIFIED' || problem.status === 'IN_PROGRESS';
    const severity: FeatureValue = analysis
      ? {
          value: clamp01(analysisSeverity ?? LEVEL[problem.severity]!),
          confidence: clamp01((analysisConfidence ?? 0.6) + (verified ? 0.1 : 0)),
          source: `AI analysis (${analysis.modelName})${verified ? ', report verified by a government office' : ''}`,
          evidence: [
            `Assessed ${analysis.severity ?? problem.severity}${analysisSeverity !== null ? ` (${(analysisSeverity * 10).toFixed(1)}/10)` : ''}`,
            ...(analysisConfidence !== null
              ? [`Analysis confidence ${pct(analysisConfidence)}`]
              : []),
          ],
          note: null,
          headline: `${(analysis.severity ?? problem.severity) === 'CRITICAL' ? 'Critical' : 'High'} severity`,
        }
      : {
          value: LEVEL[problem.severity]!,
          confidence: RECORDED_CONFIDENCE,
          source: 'Recorded severity only — no completed AI analysis',
          evidence: [`Recorded ${problem.severity}`],
          note: 'no completed AI analysis yet; using the recorded level with low confidence',
          headline: `${problem.severity === 'CRITICAL' ? 'Critical' : 'High'} recorded severity`,
        };
    if ((severity.value ?? 0) < 0.75) severity.headline = null;

    // --- Urgency ------------------------------------------------------------
    const urgencyParts = [
      analysis?.urgency
        ? { value: LEVEL[analysis.urgency]!, confidence: analysisConfidence ?? 0.6 }
        : { value: LEVEL[problem.urgency]!, confidence: RECORDED_CONFIDENCE },
      { value: f?.urgency.value ?? null, confidence: f?.urgency.confidence ?? 0 },
    ];
    const urgencyCombined = combine(urgencyParts);
    const urgency: FeatureValue = {
      ...urgencyCombined,
      source: [
        analysis?.urgency
          ? `AI analysis: ${analysis.urgency}`
          : `Recorded: ${problem.urgency}`,
        f?.urgency.value !== null && f?.urgency.value !== undefined
          ? `AI urgency signal ${pct(f.urgency.value)} (confidence ${pct(f.urgency.confidence)})`
          : null,
      ]
        .filter(Boolean)
        .join('; '),
      evidence: f?.urgency.evidence ?? [],
      note: f?.urgency.value === null || !f ? aiNote : null,
      headline: f?.urgency.evidence[0]
        ? `Time-sensitive: “${f.urgency.evidence[0]}”`
        : analysis?.urgency
          ? `Urgent — the AI analysis rated it ${analysis.urgency.toLowerCase()}`
          : `Urgent — recorded as ${problem.urgency.toLowerCase()}`,
    };

    // --- Safety risk --------------------------------------------------------
    const prior = CATEGORY_SAFETY_PRIOR[problem.category];
    const safetyCombined = combine([
      { value: prior, confidence: PRIOR_CONFIDENCE },
      { value: f?.safetyRisk.value ?? null, confidence: f?.safetyRisk.confidence ?? 0 },
    ]);
    const safetyRisk: FeatureValue = {
      ...safetyCombined,
      source: [
        `Category prior for ${problem.category.toLowerCase().replace('_', ' ')}: ${pct(prior)} (low confidence)`,
        f?.safetyRisk.value !== null && f?.safetyRisk.value !== undefined
          ? `AI safety signal ${pct(f.safetyRisk.value)} (confidence ${pct(f.safetyRisk.confidence)})`
          : null,
      ]
        .filter(Boolean)
        .join('; '),
      evidence: f?.safetyRisk.evidence ?? [],
      note:
        f?.safetyRisk.value === null || !f
          ? `${aiNote ?? 'no AI safety signal'}; category prior only`
          : null,
      headline: f?.safetyRisk.evidence[0]
        ? `Strong safety-risk signal: “${f.safetyRisk.evidence[0]}”`
        : 'Safety risk typical of this category',
    };

    // --- Community impact (normalised; de-duplicated people) ----------------
    const ageHours =
      (now.getTime() - (problem.submittedAt ?? problem.createdAt).getTime()) / 3_600_000;
    const community = communityImpact(signals.distinctPeople, signals.localBaseline);
    const communityFeature: FeatureValue = {
      value: community,
      // A brand-new report has had no time to gather support.
      confidence: clamp01(Math.max(0.3, Math.min(1, ageHours / 72))),
      source: `Distinct people engaged, relative to the local norm (${signals.localBaseline.toFixed(1)} within ${settings.baselineRadiusM / 1000} km)`,
      evidence: [
        `${plural(signals.distinctPeople, 'person', 'people')} supported, followed, commented or reported it independently`,
        ...(signals.linkedReporters > 0
          ? [`${plural(signals.linkedReporters, 'related report')} from other people`]
          : []),
        ...(signals.recentSupports > 0
          ? [`${plural(signals.recentSupports, 'new supporter')} in the last 7 days`]
          : []),
      ],
      note:
        signals.distinctPeople === 0
          ? 'no community activity yet — measured as none, not missing'
          : null,
      headline:
        signals.linkedReporters >= 2
          ? `${signals.linkedReporters} related reports from different people`
          : signals.recentSupports >= 3 &&
              signals.recentSupports * 2 > signals.distinctPeople
            ? 'Recent increase in community support'
            : 'Significant community support',
    };

    // --- Geographic impact (PostGIS density + AI breadth) -------------------
    const density =
      signals.nearbyOpen === null
        ? null
        : { value: saturate(signals.nearbyOpen, 3), confidence: 0.6 };
    const geoCombined = combine([
      density ?? { value: null, confidence: 0 },
      {
        value: f?.impactBreadth.value ?? null,
        confidence: f?.impactBreadth.confidence ?? 0,
      },
    ]);
    const geographicImpact: FeatureValue = {
      ...geoCombined,
      source: [
        density
          ? `${plural(signals.nearbyOpen!, 'other open problem')} within ${settings.nearbyRadiusM} m`
          : null,
        f?.impactBreadth.value !== null && f?.impactBreadth.value !== undefined
          ? `AI breadth signal ${pct(f.impactBreadth.value)} (confidence ${pct(f.impactBreadth.confidence)})`
          : null,
      ]
        .filter(Boolean)
        .join('; '),
      evidence: [
        ...(density
          ? [
              `${plural(signals.nearbyOpen!, 'other open problem')} within ${settings.nearbyRadiusM} m`,
            ]
          : []),
        ...(f?.impactBreadth.evidence ?? []),
      ],
      note: !problem.hasLocation
        ? 'no precise location; infrastructure-proximity data is not available'
        : 'infrastructure-proximity data is not available',
      headline:
        signals.nearbyOpen && signals.nearbyOpen >= 2
          ? `${signals.nearbyOpen} other open problems nearby`
          : f?.impactBreadth.evidence[0]
            ? `Wide reach: “${f.impactBreadth.evidence[0]}”`
            : 'Wide geographic impact',
    };

    // --- Recency ------------------------------------------------------------
    const days = Math.max(0, ageHours / 24);
    const recency: FeatureValue = {
      value: Math.pow(0.5, days / settings.recencyHalfLifeDays),
      confidence: 1,
      source: `Half-life ${settings.recencyHalfLifeDays} days; adds at most its weight`,
      evidence: [
        `Reported ${days < 1 ? 'today' : `${Math.floor(days)} day${Math.floor(days) === 1 ? '' : 's'} ago`}`,
      ],
      note: null,
      headline: 'Recently reported',
    };

    // --- Affected population: stated figures only ---------------------------
    const stated = f?.statedAffected;
    const affectedPopulation: FeatureValue =
      stated && stated.value !== null
        ? {
            value: populationScore(stated.value, stated.unit),
            confidence: stated.confidence,
            source:
              'A figure stated in the report (extracted by AI, checked against the text)',
            evidence:
              stated.evidence.length > 0
                ? stated.evidence
                : [`${stated.value} ${stated.unit}`],
            note: null,
            headline: `Report states about ${stated.value} ${stated.unit === 'unknown' ? 'people' : stated.unit} affected`,
          }
        : {
            value: null,
            confidence: 0,
            source: 'Unknown',
            evidence: [],
            note: 'the report states no figure, and Samadhaan has no population data — none is estimated',
            headline: null,
          };

    // --- Evidence / confidence ----------------------------------------------
    const evidenceValue =
      0.4 * (verified ? 1 : 0) +
      0.25 * (signals.images > 0 ? 1 : 0) +
      0.2 * (analysisConfidence ?? 0) +
      0.15 * Math.min(1, signals.linkedReporters / 2);
    const evidence: FeatureValue = {
      value: clamp01(evidenceValue),
      confidence: 1,
      source: 'Verification, photos, analysis confidence and independent reports',
      evidence: [
        verified ? 'Verified by a government office' : 'Not yet verified',
        `${plural(signals.images, 'photo')}`,
        ...(analysisConfidence !== null
          ? [`AI analysis confidence ${pct(analysisConfidence)}`]
          : []),
      ],
      note: null,
      headline: verified ? 'Verified by a government office' : null,
    };

    const info: string[] = [];
    if (signals.projectStatus) {
      info.push(
        `An organisation is working on this (project ${signals.projectStatus.toLowerCase()}). Priority measures civic importance, not who is available to act.`,
      );
    }

    return {
      features: {
        severity,
        urgency,
        communityImpact: communityFeature,
        safetyRisk,
        geographicImpact,
        recency,
        affectedPopulation,
        evidence,
      },
      ai,
      aiInputsHash,
      guidance,
      info,
      facts: {
        distinctPeople: signals.distinctPeople,
        linkedReporters: signals.linkedReporters,
        localBaseline: signals.localBaseline,
        nearbyOpen: signals.nearbyOpen,
        recentSupports: signals.recentSupports,
        images: signals.images,
        verified,
        analysisId: analysis?.id ?? null,
        locality: aiLocality(problem.address, problem.city),
      },
    };
  }

  /** Deterministic signals in two bounded queries. */
  private async signals(
    problem: ProblemForPriority,
    now: Date,
  ): Promise<{
    distinctPeople: number;
    linkedReporters: number;
    recentSupports: number;
    localBaseline: number;
    nearbyOpen: number | null;
    images: number;
    projectStatus: string | null;
  }> {
    const settings = this.config.priority;
    const since7 = new Date(now.getTime() - 7 * 86_400_000);
    const since90 = new Date(now.getTime() - 90 * 86_400_000);
    const since180 = new Date(now.getTime() - 180 * 86_400_000);

    // Everyone who engaged, counted once — support, follow, comment, and
    // independent reports of the same issue (and support on those). The
    // reporter is not counted. A cluster therefore cannot double-count the
    // same people through several channels.
    const [engagement] = await this.prisma.$queryRaw<
      Array<{
        people: number;
        linked: number;
        recent: number;
        images: number;
        project: string | null;
      }>
    >(Prisma.sql`
      WITH linked AS (
        SELECT o.id, o."reporterId" FROM problems o
        WHERE o."duplicateOfId" = ${problem.id}::uuid AND o."deletedAt" IS NULL
        UNION
        SELECT c.id, c."reporterId" FROM problem_duplicate_candidates d
        JOIN problems c ON c.id = d."candidateProblemId"
        WHERE d."problemId" = ${problem.id}::uuid AND d.status IN ('LIKELY_DUPLICATE', 'CONFIRMED_DUPLICATE')
          AND c."deletedAt" IS NULL AND c.status NOT IN ('DRAFT', 'REJECTED')
        UNION
        SELECT s.id, s."reporterId" FROM problem_duplicate_candidates d
        JOIN problems s ON s.id = d."problemId"
        WHERE d."candidateProblemId" = ${problem.id}::uuid AND d.status IN ('LIKELY_DUPLICATE', 'CONFIRMED_DUPLICATE')
          AND s."deletedAt" IS NULL AND s.status NOT IN ('DRAFT', 'REJECTED')
      ),
      people AS (
        SELECT v."userId" AS u FROM problem_votes v WHERE v."problemId" = ${problem.id}::uuid
        UNION SELECT f."userId" FROM problem_follows f WHERE f."problemId" = ${problem.id}::uuid
        UNION SELECT c."userId" FROM problem_comments c
          WHERE c."problemId" = ${problem.id}::uuid AND c."deletedAt" IS NULL
        UNION SELECT l."reporterId" FROM linked l
        UNION SELECT v."userId" FROM problem_votes v WHERE v."problemId" IN (SELECT id FROM linked)
      )
      SELECT
        (SELECT count(*) FROM people x JOIN problems me ON me.id = ${problem.id}::uuid
          WHERE x.u <> me."reporterId")::int AS people,
        (SELECT count(DISTINCT l."reporterId") FROM linked l JOIN problems me ON me.id = ${problem.id}::uuid
          WHERE l."reporterId" <> me."reporterId")::int AS linked,
        (SELECT count(*) FROM problem_votes v
          WHERE v."problemId" = ${problem.id}::uuid AND v."createdAt" >= ${since7})::int AS recent,
        (SELECT count(*) FROM problem_images i
          WHERE i."problemId" = ${problem.id}::uuid AND i."deletedAt" IS NULL)::int AS images,
        (SELECT rp.status::text FROM resolution_projects rp
          WHERE rp."problemId" = ${problem.id}::uuid AND rp.status IN ('PLANNED', 'ACTIVE')
          ORDER BY rp."createdAt" DESC LIMIT 1) AS project
    `);

    // The local baseline and nearby density, both PostGIS-indexed. Without a
    // precise location the baseline falls back to the city, and density is
    // unavailable.
    const [area] = problem.hasLocation
      ? await this.prisma.$queryRaw<
          Array<{ baseline: number | null; nearby: number }>
        >(Prisma.sql`
          SELECT
            (SELECT percentile_cont(0.75) WITHIN GROUP (
                ORDER BY o."voteCount" + o."followCount" + o."commentCount")
             FROM problems o, problems me
             WHERE me.id = ${problem.id}::uuid AND o.id <> me.id
               AND o."deletedAt" IS NULL AND o.status::text = ANY (${ACTIVE_STATUSES.concat(['RESOLVED'])}::text[])
               AND o."createdAt" >= ${since180}
               AND ST_DWithin(o.location, me.location, ${settings.baselineRadiusM})) AS baseline,
            (SELECT count(*) FROM problems o, problems me
             WHERE me.id = ${problem.id}::uuid AND o.id <> me.id
               AND o."deletedAt" IS NULL AND o.status::text = ANY (${ACTIVE_STATUSES}::text[])
               AND o."createdAt" >= ${since90}
               AND o."duplicateOfId" IS DISTINCT FROM me.id
               AND (me."duplicateOfId" IS NULL OR o.id <> me."duplicateOfId")
               AND NOT EXISTS (
                 SELECT 1 FROM problem_duplicate_candidates d
                 WHERE d.status IN ('LIKELY_DUPLICATE', 'CONFIRMED_DUPLICATE')
                   AND ((d."problemId" = me.id AND d."candidateProblemId" = o.id)
                     OR (d."candidateProblemId" = me.id AND d."problemId" = o.id)))
               AND ST_DWithin(o.location, me.location, ${settings.nearbyRadiusM}))::int AS nearby
        `)
      : await this.prisma.$queryRaw<
          Array<{ baseline: number | null; nearby: number }>
        >(Prisma.sql`
          SELECT percentile_cont(0.75) WITHIN GROUP (
                   ORDER BY o."voteCount" + o."followCount" + o."commentCount") AS baseline,
                 0 AS nearby
          FROM problems o
          WHERE o.id <> ${problem.id}::uuid AND o."deletedAt" IS NULL
            AND lower(o.city) = lower(${problem.city ?? ''})
            AND o."createdAt" >= ${since180}
        `);

    return {
      distinctPeople: engagement?.people ?? 0,
      linkedReporters: engagement?.linked ?? 0,
      recentSupports: engagement?.recent ?? 0,
      images: engagement?.images ?? 0,
      projectStatus: engagement?.project ?? null,
      localBaseline:
        area?.baseline === null || area?.baseline === undefined
          ? 0
          : Number(area.baseline),
      nearbyOpen: problem.hasLocation ? (area?.nearby ?? 0) : null,
    };
  }

  private async aiFeatures(
    problem: ProblemForPriority,
    analysis: {
      severity: string | null;
      urgency: string | null;
      summary: string | null;
    } | null,
    observations: string[],
    hash: string,
    previous: PreviousAssessment | null,
    options: { forceAi: boolean; now: Date },
  ): Promise<StoredAi & { reused: boolean }> {
    const settings = this.config.priority;
    if (!settings.aiFeatures)
      return { status: 'DISABLED', features: null, reused: false };

    const stored = storedAi(previous?.featureMetadata);
    const fresh =
      previous &&
      previous.aiInputsHash === hash &&
      options.now.getTime() - previous.calculatedAt.getTime() <
        settings.aiReuseDays * 86_400_000;
    if (!options.forceAi && fresh && stored && stored.status !== 'FAILED') {
      return { ...stored, reused: true };
    }

    const outcome = await this.ai.priorityFeatures({
      problemId: problem.id,
      title: problem.title,
      description: problem.description,
      category: problem.category,
      subcategory: problem.subcategory,
      severity: analysis?.severity ?? null,
      urgency: analysis?.urgency ?? null,
      analysisSummary: analysis?.summary ?? null,
      observations,
      locality: aiLocality(problem.address, problem.city),
    });
    if (!outcome.ok) {
      this.logger.warn(
        `AI priority features unavailable for ${problem.publicId}: ${outcome.failure.code}`,
      );
      return { status: 'FAILED', features: null, reused: false };
    }
    return {
      status: outcome.features.aiRan ? 'COMPLETED' : 'UNAVAILABLE',
      features: outcome.features.aiRan ? outcome.features : null,
      reused: false,
    };
  }

  /**
   * Supporting civic guidance — PUBLIC knowledge only, retrieved when the
   * report changes. Shown beside the assessment; it never enters the score.
   */
  private async guidance(
    problem: ProblemForPriority,
    hash: string,
    previous: PreviousAssessment | null,
  ): Promise<Array<Omit<PriorityGuidance, 'href'>>> {
    const topK = this.config.priority.guidanceTopK;
    if (topK === 0 || !this.config.rag.enabled) return [];
    if (previous && previous.aiInputsHash === hash && Array.isArray(previous.guidance)) {
      return previous.guidance as Array<Omit<PriorityGuidance, 'href'>>;
    }
    try {
      const query = `${problem.category.toLowerCase().replace('_', ' ')} ${problem.subcategory ?? ''} ${problem.title}`;
      const result = await this.knowledge.retrieve({
        semanticQuery: `${query} safety guidance`,
        keywordQuery: problem.title,
        scope: {
          userId: '00000000-0000-0000-0000-000000000000',
          officeIds: [],
          organizationIds: [],
          projectId: null,
          only: ['PUBLIC'],
        },
        context: { kind: 'PROBLEM', category: problem.category, city: problem.city },
        topK,
      });
      return result.passages.map((p) => ({
        sourceId: p.sourceId,
        chunkId: p.chunkId,
        title: p.title,
        sectionTitle: p.sectionTitle,
      }));
    } catch {
      return []; // guidance is optional context
    }
  }
}

/** Reads the AI block stored with a previous assessment. */
export function storedAi(metadata: unknown): StoredAi | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const ai = (metadata as { ai?: unknown }).ai;
  if (!ai || typeof ai !== 'object') return null;
  const { status, features } = ai as { status?: unknown; features?: unknown };
  if (
    status !== 'COMPLETED' &&
    status !== 'UNAVAILABLE' &&
    status !== 'FAILED' &&
    status !== 'DISABLED'
  ) {
    return null;
  }
  return { status, features: (features ?? null) as AiPriorityFeatures | null };
}
