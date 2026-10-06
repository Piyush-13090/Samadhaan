import {
  MATCH_REASON_CODES,
  MATCH_SIGNALS,
  type MatchReasonCode,
  type MatchSignal,
} from '@samadhaan/shared';

/**
 * Organisation matching, between the API and the AI service.
 *
 * The request carries numbers the database computed (pgvector similarity,
 * PostGIS distance, activity counts) and public profile facts. The response is
 * validated here before anything is persisted, as with every AI response.
 */

export interface MatchProblemInput {
  publicId: string;
  category: string;
  aiCategory: string | null;
  subcategory: string | null;
  aiSubcategory: string | null;
  severity: string | null;
  /** Title, description, AI summary, category. Never anything about the reporter. */
  focusText: string;
}

export interface MatchCandidateInput {
  organizationId: string;
  type: 'NGO' | 'UNIVERSITY' | 'INDUSTRY';
  expertise: Array<{ category: string; subcategory: string | null; level: string }>;
  semanticSimilarity: number | null;
  distanceMeters: number | null;
  sameCity: boolean;
  hasLocation: boolean;
  relevantActivityCount: number;
}

export interface AiOrganizationMatch {
  organizationId: string;
  rank: number;
  finalScore: number;
  signals: Record<MatchSignal, number | null>;
  reasons: Array<{ code: MatchReasonCode; signal: string; value: number }>;
  /** Indexes into the candidate's expertise list, strongest first. */
  matchedExpertise: number[];
}

export interface AiMatchResult {
  matches: AiOrganizationMatch[];
  considered: number;
  degraded: string[];
  engine: string;
  engineVersion: string;
  matchingVersion: string;
  weights: Record<string, number>;
  embeddingModel: string | null;
  trained: boolean;
  processingMs: number;
}

export function toMatchRequest(
  problem: MatchProblemInput,
  candidates: MatchCandidateInput[],
  options: { resultLimit: number; minScore: number },
) {
  return {
    problem: {
      public_id: problem.publicId,
      category: problem.category,
      ai_category: problem.aiCategory,
      subcategory: problem.subcategory?.slice(0, 120) ?? null,
      ai_subcategory: problem.aiSubcategory?.slice(0, 120) ?? null,
      severity: problem.severity,
      focus_text: problem.focusText.slice(0, 6000),
    },
    candidates: candidates.map((candidate) => ({
      organization_id: candidate.organizationId,
      type: candidate.type,
      expertise: candidate.expertise.slice(0, 30).map((entry) => ({
        category: entry.category,
        subcategory: entry.subcategory?.slice(0, 120) ?? null,
        level: entry.level,
      })),
      semantic_similarity:
        candidate.semanticSimilarity === null
          ? null
          : Math.max(-1, Math.min(1, candidate.semanticSimilarity)),
      distance_meters: candidate.distanceMeters,
      same_city: candidate.sameCity,
      has_location: candidate.hasLocation,
      relevant_activity_count: candidate.relevantActivityCount,
    })),
    options: { result_limit: options.resultLimit, min_score: options.minScore },
  };
}

const isScore = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Validates the AI service's match response. Returns `null` for anything
 * unusable — an out-of-range score, an organisation that was not a candidate,
 * an unknown reason code — so nothing malformed reaches the database.
 */
export function parseMatchResponse(
  payload: unknown,
  candidateIds: ReadonlySet<string>,
): AiMatchResult | null {
  if (!isObject(payload) || !Array.isArray(payload.matches) || !isObject(payload.model)) {
    return null;
  }
  const model = payload.model;
  if (
    typeof model.matching_version !== 'string' ||
    typeof model.engine !== 'string' ||
    typeof model.engine_version !== 'string' ||
    !isObject(model.weights)
  ) {
    return null;
  }

  const matches: AiOrganizationMatch[] = [];
  const seen = new Set<string>();

  for (const raw of payload.matches) {
    if (!isObject(raw) || !isObject(raw.signals) || !Array.isArray(raw.reasons))
      return null;
    const id = raw.organization_id;
    if (typeof id !== 'string' || !candidateIds.has(id) || seen.has(id)) return null;
    if (!isScore(raw.final_score) || typeof raw.rank !== 'number') return null;
    seen.add(id);

    const signals = {} as Record<MatchSignal, number | null>;
    for (const signal of MATCH_SIGNALS) {
      const value = raw.signals[signal];
      if (value !== null && !isScore(value)) return null;
      signals[signal] = value ?? null;
    }

    const reasons: AiOrganizationMatch['reasons'] = [];
    for (const reason of raw.reasons) {
      if (
        !isObject(reason) ||
        !(MATCH_REASON_CODES as readonly string[]).includes(reason.code as string) ||
        typeof reason.value !== 'number' ||
        !Number.isFinite(reason.value)
      ) {
        return null;
      }
      reasons.push({
        code: reason.code as MatchReasonCode,
        signal: String(reason.signal),
        value: reason.value,
      });
    }

    const matched = Array.isArray(raw.matched_expertise)
      ? raw.matched_expertise.filter(
          (index): index is number => Number.isInteger(index) && (index as number) >= 0,
        )
      : [];

    matches.push({
      organizationId: id,
      rank: raw.rank,
      finalScore: raw.final_score,
      signals,
      reasons,
      matchedExpertise: matched,
    });
  }

  return {
    matches,
    considered: typeof payload.considered === 'number' ? payload.considered : 0,
    degraded: Array.isArray(payload.degraded)
      ? payload.degraded.filter((entry): entry is string => typeof entry === 'string')
      : [],
    engine: model.engine,
    engineVersion: model.engine_version,
    matchingVersion: model.matching_version.slice(0, 120),
    weights: Object.fromEntries(
      Object.entries(model.weights).filter(([, value]) => typeof value === 'number'),
    ) as Record<string, number>,
    embeddingModel:
      typeof model.embedding_model === 'string' ? model.embedding_model : null,
    trained: model.trained === true,
    processingMs: typeof payload.processing_ms === 'number' ? payload.processing_ms : 0,
  };
}
