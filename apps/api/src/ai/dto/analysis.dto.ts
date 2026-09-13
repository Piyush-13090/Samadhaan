import {
  PROBLEM_CATEGORIES,
  PROBLEM_SEVERITIES,
  PROBLEM_URGENCIES,
  type ProblemCategory,
  type ProblemSeverity,
  type ProblemUrgency,
} from '@samadhaan/shared';

/**
 * The AI service's analysis response, in its own wire shape.
 *
 * snake_case because that is what the Python service emits. Translation to the
 * application's camelCase happens once, in `parseAnalysisResponse`.
 */
export interface AiAnalysisResponse {
  problem_id: string;
  provider: string;
  model_name: string;
  model_version: string;
  category: string;
  subcategory: string | null;
  severity: string;
  urgency: string;
  summary: string;
  confidence: number;
  observations: string[];
  severity_score: number;
  processing_ms: number;
  image_count: number;
  text_only: boolean;
}

/** The validated, camelCase form the rest of the API works with. */
export interface AiAnalysis {
  provider: string;
  modelName: string;
  modelVersion: string;
  category: ProblemCategory;
  subcategory: string | null;
  severity: ProblemSeverity;
  urgency: ProblemUrgency;
  summary: string;
  confidence: number;
  observations: string[];
  severityScore: number;
  processingMs: number;
  textOnly: boolean;
}

/** A structured failure from the AI service. */
export interface AiAnalysisFailure {
  code: string;
  message: string;
  /** Whether trying again could plausibly succeed. Drives the retry policy. */
  retryable: boolean;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Validates an AI service response before anything is written to the database.
 *
 * The AI service already validates its own output, so this is the second of two
 * independent checks — and it is the one that matters here, because this
 * process is what performs the write. Trusting a remote service's promise about
 * its own shape is how an unknown enum value ends up in a column.
 *
 * Returns `null` for anything unusable; the caller turns that into a FAILED
 * analysis rather than persisting a half-valid row.
 */
export function parseAnalysisResponse(payload: unknown): AiAnalysis | null {
  if (typeof payload !== 'object' || payload === null) return null;

  const raw = payload as Partial<AiAnalysisResponse>;

  const category = raw.category as ProblemCategory;
  const severity = raw.severity as ProblemSeverity;
  const urgency = raw.urgency as ProblemUrgency;

  // Enum membership, checked against the same constants Prisma generates from.
  if (!PROBLEM_CATEGORIES.includes(category)) return null;
  if (!PROBLEM_SEVERITIES.includes(severity)) return null;
  if (!PROBLEM_URGENCIES.includes(urgency)) return null;

  if (!isNonEmptyString(raw.summary)) return null;
  if (!isNonEmptyString(raw.model_name)) return null;
  if (!isNonEmptyString(raw.provider)) return null;

  if (typeof raw.confidence !== 'number' || Number.isNaN(raw.confidence)) return null;
  if (raw.confidence < 0 || raw.confidence > 1) return null;

  const severityScore =
    typeof raw.severity_score === 'number' && !Number.isNaN(raw.severity_score)
      ? Math.min(10, Math.max(0, raw.severity_score))
      : 0;

  return {
    provider: raw.provider,
    modelName: raw.model_name,
    modelVersion: isNonEmptyString(raw.model_version) ? raw.model_version : 'unknown',
    category,
    subcategory: isNonEmptyString(raw.subcategory) ? raw.subcategory.slice(0, 80) : null,
    severity,
    urgency,
    // Bounded here as well as in the schema: the column is `text`, and an
    // unbounded summary from a misbehaving provider would be stored verbatim.
    summary: raw.summary.trim().slice(0, 1000),
    confidence: raw.confidence,
    observations: Array.isArray(raw.observations)
      ? raw.observations
          .filter(isNonEmptyString)
          .map((entry) => entry.trim().slice(0, 300))
          .slice(0, 5)
      : [],
    severityScore,
    processingMs:
      typeof raw.processing_ms === 'number' && raw.processing_ms >= 0
        ? Math.round(raw.processing_ms)
        : 0,
    textOnly: raw.text_only === true,
  };
}

/** Extracts a structured failure from an AI service error body. */
export function parseAnalysisFailure(payload: unknown): AiAnalysisFailure | null {
  if (typeof payload !== 'object' || payload === null) return null;

  const raw = payload as Partial<AiAnalysisFailure>;

  if (!isNonEmptyString(raw.code) || !isNonEmptyString(raw.message)) return null;

  return {
    code: raw.code,
    message: raw.message,
    // Absent means "do not retry". Assuming retryable on a malformed error
    // body would let a permanent failure burn paid calls in a loop.
    retryable: raw.retryable === true,
  };
}
