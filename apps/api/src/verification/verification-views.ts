import type {
  EvidenceConcern,
  EvidenceFileRole,
  EvidenceStatus,
  EvidenceType,
  EvidenceView,
  MissingEvidenceItem,
  VerificationAssessmentView,
  VerificationGuidance,
  VerificationObservation,
  VerificationRecommendation,
  VerificationRequestView,
  VerificationSignalView,
  VerificationTimelineEntry,
} from '@samadhaan/shared';
import type { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { SIGNAL_LABELS } from './verification-scoring.js';

/** What every evidence query loads. */
export const EVIDENCE_INCLUDE = {
  files: { orderBy: { createdAt: 'asc' } },
  submittedBy: { select: { fullName: true } },
  replacedBy: { select: { id: true } },
  assessments: { orderBy: { createdAt: 'desc' }, take: 1 },
} as const satisfies Prisma.ResolutionEvidenceInclude;

export type EvidenceRow = Prisma.ResolutionEvidenceGetPayload<{
  include: typeof EVIDENCE_INCLUDE;
}>;
type AssessmentRow = Prisma.ResolutionVerificationAssessmentGetPayload<object>;

export interface StoredGuidance {
  sourceId: string;
  chunkId: string;
  title: string;
  sectionTitle: string | null;
}

interface StoredExplanation {
  signals?: Partial<
    Record<
      VerificationSignalView['key'],
      { value: number | null; confidence: number; source: string }
    >
  >;
  supporting?: VerificationObservation[];
  remainingIssues?: VerificationObservation[];
  adjustments?: string[];
}

const num = (v: Prisma.Decimal | null) => (v === null ? null : Number(v));
const SIGNAL_KEYS = Object.keys(SIGNAL_LABELS) as Array<VerificationSignalView['key']>;

export function assessmentView(
  row: AssessmentRow,
  liveGuidance: (stored: unknown) => VerificationGuidance[],
): VerificationAssessmentView {
  const explanation = (row.explanation ?? {}) as StoredExplanation;
  return {
    id: row.id,
    status: row.status,
    recommendation: (row.recommendation as VerificationRecommendation | null) ?? null,
    aiRecommendation: (row.aiRecommendation as VerificationRecommendation | null) ?? null,
    confidence: num(row.confidence),
    evidenceQuality: num(row.evidenceQuality),
    signals: SIGNAL_KEYS.map((key) => {
      const s = explanation.signals?.[key];
      return {
        key,
        label: SIGNAL_LABELS[key],
        value: s?.value ?? null,
        confidence: s?.confidence ?? 0,
        source: s?.source ?? 'Unavailable',
      };
    }),
    supporting: explanation.supporting ?? [],
    remainingIssues: explanation.remainingIssues ?? [],
    adjustments: explanation.adjustments ?? [],
    concerns: (Array.isArray(row.concerns)
      ? row.concerns
      : []) as unknown as EvidenceConcern[],
    missingEvidence: (Array.isArray(row.missingEvidence)
      ? row.missingEvidence
      : []) as unknown as MissingEvidenceItem[],
    guidance: liveGuidance(row.guidance),
    model:
      row.modelName && row.modelVersion
        ? {
            name: row.modelName,
            version: row.modelVersion,
            promptVersion: row.promptVersion,
            verificationVersion: row.verificationVersion,
          }
        : null,
    failureMessage: row.failureMessage,
    createdAt: row.createdAt.toISOString(),
  };
}

export function evidenceView(
  row: EvidenceRow,
  permissions: EvidenceView['permissions'],
  liveGuidance: (stored: unknown) => VerificationGuidance[],
): EvidenceView {
  const assessment = row.assessments[0] ?? null;
  return {
    id: row.id,
    evidenceType: row.evidenceType as EvidenceType,
    title: row.title,
    description: row.description,
    status: row.status as EvidenceStatus,
    version: row.version,
    replacesEvidenceId: row.replacesEvidenceId,
    replacedByEvidenceId: row.replacedBy?.id ?? null,
    submittedBy: { name: row.submittedBy.fullName },
    submittedAt: row.submittedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    decisionReason: row.decisionReason,
    aiStatus: row.aiStatus,
    // Never the storage key, never raw GPS: a path through the API, and a distance.
    files: row.files.map((f) => ({
      id: f.id,
      role: f.role as EvidenceFileRole,
      fileName: f.originalFileName,
      mimeType: f.mimeType,
      fileSize: f.fileSize,
      checksum: f.checksum,
      url: `/api/v1/evidence/${row.id}/files/${f.id}`,
      width: f.width,
      height: f.height,
      capturedAt: f.capturedAt?.toISOString() ?? null,
      locationDistanceM: f.locationDistanceM,
      createdAt: f.createdAt.toISOString(),
    })),
    assessment: assessment ? assessmentView(assessment, liveGuidance) : null,
    permissions,
  };
}

/**
 * Loads which stored guidance passages are still readable by the project's
 * participants — PUBLIC, or this project's own — and returns a checker.
 */
export async function guidanceChecker(
  prisma: PrismaService,
  projectId: string,
  stored: unknown[],
): Promise<(value: unknown) => VerificationGuidance[]> {
  const all = stored.flatMap((g) => (Array.isArray(g) ? (g as StoredGuidance[]) : []));
  const live = all.length
    ? await prisma.knowledgeChunk.findMany({
        where: {
          id: { in: all.map((g) => g.chunkId) },
          source: {
            status: 'COMPLETED',
            OR: [{ visibility: 'PUBLIC' }, { visibility: 'PROJECT', projectId }],
          },
        },
        select: { id: true },
      })
    : [];
  const ok = new Set(live.map((c) => c.id));
  return (value) =>
    (Array.isArray(value) ? (value as StoredGuidance[]) : [])
      .filter((g) => ok.has(g.chunkId))
      .map((g) => ({
        title: g.title,
        sectionTitle: g.sectionTitle,
        href: `/knowledge/sources/${g.sourceId}#chunk-${g.chunkId}`,
      }));
}

export function requestView(
  row: Prisma.ResolutionVerificationRequestGetPayload<{
    include: {
      requestedBy: { select: { fullName: true } };
      _count: { select: { evidence: true } };
    };
  }>,
  governmentName: string,
): VerificationRequestView {
  return {
    id: row.id,
    status: row.status,
    note: row.note,
    requestedBy: row.requestedBy.fullName,
    governmentName,
    createdAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decisionReason: row.decisionReason,
    decisionNote: row.decisionNote,
    evidenceCount: row._count.evidence,
  };
}

const RECOMMENDATION_TEXT: Record<string, string> = {
  INSUFFICIENT_EVIDENCE: 'insufficient evidence',
  POSSIBLY_RESOLVED: 'possibly resolved',
  LIKELY_RESOLVED: 'likely resolved',
  LIKELY_NOT_RESOLVED: 'likely not resolved',
};

export const TIMELINE_ACTIONS = [
  'EVIDENCE_SUBMITTED',
  'EVIDENCE_WITHDRAWN',
  'EVIDENCE_AI_REVIEWED',
  'EVIDENCE_REVIEW_REQUESTED',
  'EVIDENCE_REJECTED',
  'RESOLUTION_VERIFICATION_REQUESTED',
  'RESOLUTION_APPROVED',
  'RESOLUTION_REJECTED',
  'MORE_EVIDENCE_REQUESTED',
] as const;

/** The verification history, from the append-only audit log. */
export async function verificationTimeline(
  prisma: PrismaService,
  projectId: string,
  governmentOrganizationId: string,
): Promise<VerificationTimelineEntry[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      action: string;
      metadata: unknown;
      createdAt: Date;
      actorUserId: string | null;
      actorName: string | null;
    }>
  >`
    SELECT a.id, a.action, a.metadata, a."createdAt", a."actorUserId", u."fullName" AS "actorName"
    FROM audit_logs a
    LEFT JOIN users u ON u.id = a."actorUserId"
    WHERE a.action = ANY (${[...TIMELINE_ACTIONS]}::text[])
      AND (a.metadata ->> 'projectId') = ${projectId}
    ORDER BY a."createdAt" ASC, a.id ASC
    LIMIT 200
  `;
  return rows.map((row) => {
    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    const title =
      typeof meta.evidenceTitle === 'string' ? `“${meta.evidenceTitle}”` : 'evidence';
    const recommendation =
      typeof meta.recommendation === 'string'
        ? RECOMMENDATION_TEXT[meta.recommendation]
        : null;
    const text: Record<string, string> = {
      EVIDENCE_SUBMITTED: `Evidence submitted: ${title}`,
      EVIDENCE_WITHDRAWN: `Evidence withdrawn: ${title}`,
      EVIDENCE_AI_REVIEWED: recommendation
        ? `AI review of ${title} completed — advisory recommendation: ${recommendation}`
        : `AI review of ${title} finished without a recommendation`,
      EVIDENCE_REVIEW_REQUESTED: `AI review of ${title} requested again`,
      EVIDENCE_REJECTED: `Evidence rejected: ${title}`,
      RESOLUTION_VERIFICATION_REQUESTED: 'Organisation requested government verification',
      RESOLUTION_APPROVED: 'Government approved the resolution',
      RESOLUTION_REJECTED: 'Government rejected the resolution',
      MORE_EVIDENCE_REQUESTED: 'Government requested more evidence',
    };
    const side: VerificationTimelineEntry['actor']['side'] =
      row.actorUserId === null
        ? 'SYSTEM'
        : meta.organizationId === governmentOrganizationId || meta.side === 'GOVERNMENT'
          ? 'GOVERNMENT'
          : 'ORGANIZATION';
    return {
      id: row.id,
      action: row.action,
      text: text[row.action] ?? row.action,
      actor: { name: row.actorUserId ? row.actorName : null, side },
      createdAt: row.createdAt.toISOString(),
    };
  });
}
