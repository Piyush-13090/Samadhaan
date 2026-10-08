/**
 * AI-assisted priority features between the API and the AI service
 * (Prompt 21). The response is validated here; anything malformed is treated
 * as "no AI features" and the score is computed without them.
 */

export interface PriorityFeatureInput {
  problemId: string;
  title: string;
  description: string;
  category: string;
  subcategory: string | null;
  severity: string | null;
  urgency: string | null;
  analysisSummary: string | null;
  observations: string[];
  /** Coarse area only — never coordinates or a full address. */
  locality: string | null;
}

export interface AiSignal {
  /** 0–1, or null when the model could not judge. */
  value: number | null;
  confidence: number;
  evidence: string[];
}

export interface AiPriorityFeatures {
  safetyRisk: AiSignal;
  urgency: AiSignal;
  impactBreadth: AiSignal;
  statedAffected: {
    value: number | null;
    unit: 'people' | 'households' | 'unknown';
    confidence: number;
    evidence: string[];
  };
  /** False when no model ran (development provider). */
  aiRan: boolean;
  provider: string;
  modelName: string;
  modelVersion: string;
  promptVersion: string;
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.slice(0, max) : null;
const unit = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null;
const phrases = (value: unknown, max: number): string[] =>
  Array.isArray(value)
    ? value
        .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
        .slice(0, max)
        .map((v) => v.trim().slice(0, 160))
    : [];

function signal(value: unknown): AiSignal | null {
  if (!isObject(value)) return null;
  const confidence = unit(value.confidence);
  if (confidence === null) return null;
  const v = value.value === null ? null : unit(value.value);
  if (value.value !== null && v === null) return null;
  // A judgement without a value carries no weight.
  return v === null
    ? { value: null, confidence: 0, evidence: [] }
    : { value: v, confidence, evidence: phrases(value.evidence, 3) };
}

export function toPriorityFeatureRequest(input: PriorityFeatureInput): Json {
  return {
    problem_id: input.problemId,
    title: input.title.slice(0, 200),
    description: input.description.slice(0, 4000),
    category: input.category,
    subcategory: input.subcategory?.slice(0, 120) ?? null,
    severity: input.severity,
    urgency: input.urgency,
    analysis_summary: input.analysisSummary?.slice(0, 600) ?? null,
    observations: input.observations.slice(0, 5).map((o) => o.slice(0, 300)),
    locality: input.locality?.slice(0, 200) ?? null,
  };
}

export function parsePriorityFeatures(body: unknown): AiPriorityFeatures | null {
  if (!isObject(body)) return null;
  const safetyRisk = signal(body.safety_risk);
  const urgency = signal(body.urgency);
  const impactBreadth = signal(body.impact_breadth);
  const provider = str(body.provider, 100);
  const modelName = str(body.model_name, 200);
  const modelVersion = str(body.model_version, 200);
  const promptVersion = str(body.prompt_version, 100);
  if (
    !safetyRisk ||
    !urgency ||
    !impactBreadth ||
    !provider ||
    !modelName ||
    !modelVersion ||
    !promptVersion ||
    typeof body.ai_ran !== 'boolean'
  ) {
    return null;
  }
  const stated = isObject(body.stated_affected) ? body.stated_affected : {};
  const count =
    typeof stated.value === 'number' &&
    Number.isInteger(stated.value) &&
    stated.value >= 1 &&
    stated.value <= 10_000_000
      ? stated.value
      : null;
  const statedUnit =
    stated.unit === 'people' || stated.unit === 'households' ? stated.unit : 'unknown';

  // A response claiming no model ran must not carry values.
  if (!body.ai_ran && [safetyRisk, urgency, impactBreadth].some((s) => s.value !== null)) {
    return null;
  }
  return {
    safetyRisk,
    urgency,
    impactBreadth,
    statedAffected: {
      value: count,
      unit: count === null ? 'unknown' : statedUnit,
      confidence: count === null ? 0 : (unit(stated.confidence) ?? 0),
      evidence: count === null ? [] : phrases(stated.evidence, 2),
    },
    aiRan: body.ai_ran,
    provider,
    modelName,
    modelVersion,
    promptVersion,
  };
}
