import type {
  ExpertiseLevel,
  MatchEvidence,
  MatchReason,
  MatchReasonCode,
  MatchSignal,
  ProblemCategory,
} from '@samadhaan/shared';
import { MATCH_REASON_CODES } from '@samadhaan/shared';

/** The stored match columns every serializer reads. */
export interface StoredMatch {
  semanticScore: number | null;
  expertiseScore: number | null;
  categoryScore: number | null;
  geographicScore: number | null;
  capabilityScore: number | null;
  activityScore: number | null;
  finalScore: number;
  rank: number;
  explanation: unknown;
  updatedAt: Date;
}

/**
 * Stored match → public evidence. An allow-list: version strings, model names
 * and internal ids stay on the server.
 */
export function toMatchEvidence(match: StoredMatch): MatchEvidence {
  const explanation =
    typeof match.explanation === 'object' && match.explanation !== null
      ? (match.explanation as Record<string, unknown>)
      : {};

  const reasons: MatchReason[] = Array.isArray(explanation.reasons)
    ? explanation.reasons.flatMap((raw: unknown) => {
        if (typeof raw !== 'object' || raw === null) return [];
        const { code, value } = raw as { code?: unknown; value?: unknown };
        if (!(MATCH_REASON_CODES as readonly unknown[]).includes(code)) return [];
        return [{ code: code as MatchReasonCode, value: Number(value) || 0 }];
      })
    : [];

  const matchedExpertise: MatchEvidence['matchedExpertise'] = Array.isArray(
    explanation.matchedExpertise,
  )
    ? explanation.matchedExpertise.flatMap((raw: unknown) => {
        if (typeof raw !== 'object' || raw === null) return [];
        const entry = raw as {
          category?: string;
          subcategory?: string | null;
          level?: string;
        };
        if (!entry.category || !entry.level) return [];
        return [
          {
            category: entry.category as ProblemCategory,
            subcategory: entry.subcategory ?? null,
            level: entry.level as ExpertiseLevel,
          },
        ];
      })
    : [];

  const signals: Record<MatchSignal, number | null> = {
    semantic: round(match.semanticScore),
    expertise: round(match.expertiseScore),
    category: round(match.categoryScore),
    geographic: round(match.geographicScore),
    capability: round(match.capabilityScore),
    activity: round(match.activityScore),
  };

  return {
    relevance: round(match.finalScore) ?? 0,
    rank: match.rank,
    signals,
    reasons,
    matchedExpertise,
    computedAt: match.updatedAt.toISOString(),
  };
}

function round(value: number | null): number | null {
  return value === null ? null : Math.round(value * 1000) / 1000;
}
