import {
  VERIFICATION_RECOMMENDATIONS,
  type VerificationRecommendation,
} from '@samadhaan/shared';

/**
 * Evidence verification between the API and the AI service (Prompt 22). The
 * response is validated here; anything malformed is a failed review, never a
 * guessed one.
 */

export interface AiSignal {
  value: number | null;
  confidence: number;
}

export interface AiObservation {
  text: string;
  refs: string[];
}

export interface AiVerification {
  relevance: AiSignal;
  visualConsistency: AiSignal;
  completionSignals: AiSignal;
  documentation: AiSignal;
  /** Null when no model ran. Never "RESOLVED" — the vocabulary has none. */
  recommendation: VerificationRecommendation | null;
  confidence: number;
  supporting: AiObservation[];
  remainingIssues: AiObservation[];
  aiRan: boolean;
  documentsRead: number;
  provider: string;
  modelName: string;
  modelVersion: string;
  promptVersion: string;
  processingMs: number;
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.slice(0, max) : null;
const unit = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;

function signal(value: unknown): AiSignal | null {
  if (!isObject(value)) return null;
  const confidence = unit(value.confidence);
  if (confidence === null) return null;
  if (value.value === null) return { value: null, confidence: 0 };
  const v = unit(value.value);
  return v === null ? null : { value: v, confidence };
}

function observations(value: unknown, known: ReadonlySet<string>): AiObservation[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isObject)
    .map((item) => ({
      text: str(item.text, 240),
      refs: Array.isArray(item.refs)
        ? item.refs.filter((r): r is string => typeof r === 'string' && known.has(r)).slice(0, 4)
        : [],
    }))
    .filter((o): o is AiObservation => o.text !== null && o.refs.length > 0)
    .slice(0, 5);
}

export function parseVerificationResponse(
  body: unknown,
  knownRefs: ReadonlySet<string>,
): AiVerification | null {
  if (!isObject(body) || typeof body.ai_ran !== 'boolean') return null;
  const relevance = signal(body.relevance);
  const visualConsistency = signal(body.visual_consistency);
  const completionSignals = signal(body.completion_signals);
  const documentation = signal(body.documentation);
  const provider = str(body.provider, 100);
  const modelName = str(body.model_name, 200);
  const modelVersion = str(body.model_version, 200);
  const promptVersion = str(body.prompt_version, 100);
  const confidence = unit(body.confidence);
  if (
    !relevance ||
    !visualConsistency ||
    !completionSignals ||
    !documentation ||
    !provider ||
    !modelName ||
    !modelVersion ||
    !promptVersion ||
    confidence === null
  ) {
    return null;
  }
  const recommendation =
    body.recommendation === null
      ? null
      : (VERIFICATION_RECOMMENDATIONS as readonly unknown[]).includes(body.recommendation)
        ? (body.recommendation as VerificationRecommendation)
        : undefined;
  // An unknown verdict — "RESOLVED" included — is not trusted.
  if (recommendation === undefined) return null;
  // A model that ran must recommend; one that did not must not.
  if (body.ai_ran !== (recommendation !== null)) return null;
  return {
    relevance,
    visualConsistency,
    completionSignals,
    documentation,
    recommendation,
    confidence,
    supporting: observations(body.supporting, knownRefs),
    remainingIssues: observations(body.remaining_issues, knownRefs),
    aiRan: body.ai_ran,
    documentsRead: typeof body.documents_read === 'number' ? body.documents_read : 0,
    provider,
    modelName,
    modelVersion,
    promptVersion,
    processingMs: typeof body.processing_ms === 'number' ? body.processing_ms : 0,
  };
}
