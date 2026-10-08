/**
 * Analytics insights between the API and the AI service (Prompt 24). NestJS
 * sends computed facts; the response is re-validated here — a statement must
 * cite facts that were sent, and guidance notes must cite refs that were sent.
 * Anything malformed is treated as "no insight".
 */

export interface InsightFactInput {
  key: string;
  label: string;
  value: string;
  signal?: 'increase' | 'decrease' | 'bottleneck' | 'attention';
}

export interface InsightGuidanceInput {
  ref: string;
  title: string;
  text: string;
}

export interface InsightRequestInput {
  scope: 'government' | 'organization';
  periodLabel: string;
  facts: InsightFactInput[];
  guidance: InsightGuidanceInput[];
}

export interface AiInsightStatement {
  text: string;
  metricKeys: string[];
}

export interface AiInsight {
  summary: string;
  observations: AiInsightStatement[];
  attention: AiInsightStatement[];
  guidanceNotes: Array<{ text: string; refs: string[] }>;
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
  typeof value === 'string' && value.trim().length > 0
    ? value.trim().slice(0, max)
    : null;

export function toInsightRequest(input: InsightRequestInput): Json {
  return {
    scope: input.scope,
    period_label: input.periodLabel.slice(0, 120),
    facts: input.facts.slice(0, 60).map((fact) => ({
      key: fact.key.slice(0, 64),
      label: fact.label.slice(0, 160),
      value: fact.value.slice(0, 80),
      signal: fact.signal ?? null,
    })),
    guidance: input.guidance.slice(0, 3).map((item) => ({
      ref: item.ref,
      title: item.title.slice(0, 200),
      text: item.text.slice(0, 1500),
    })),
  };
}

export function parseInsight(
  body: unknown,
  factKeys: ReadonlySet<string>,
  refs: ReadonlySet<string>,
): AiInsight | null {
  if (!isObject(body)) return null;
  const summary = str(body.summary, 600);
  const provider = str(body.provider, 100);
  const modelName = str(body.model_name, 200);
  const modelVersion = str(body.model_version, 200);
  const promptVersion = str(body.prompt_version, 100);
  if (!summary || !provider || !modelName || !modelVersion || !promptVersion) return null;
  if (typeof body.ai_ran !== 'boolean') return null;

  const statements = (value: unknown, max: number): AiInsightStatement[] =>
    (Array.isArray(value) ? value : [])
      .filter(isObject)
      .map((item) => ({
        text: str(item.text, 400),
        metricKeys: (Array.isArray(item.metric_keys) ? item.metric_keys : []).filter(
          (key): key is string => typeof key === 'string' && factKeys.has(key),
        ),
      }))
      .filter(
        (item): item is AiInsightStatement => !!item.text && item.metricKeys.length > 0,
      )
      .slice(0, max);

  const guidanceNotes = (Array.isArray(body.guidance_notes) ? body.guidance_notes : [])
    .filter(isObject)
    .map((item) => ({
      text: str(item.text, 400),
      refs: (Array.isArray(item.refs) ? item.refs : []).filter(
        (ref): ref is string => typeof ref === 'string' && refs.has(ref),
      ),
    }))
    .filter(
      (item): item is { text: string; refs: string[] } =>
        !!item.text && item.refs.length > 0,
    )
    .slice(0, 2);

  return {
    summary,
    observations: statements(body.observations, 5),
    attention: statements(body.attention, 3),
    guidanceNotes,
    aiRan: body.ai_ran,
    provider,
    modelName,
    modelVersion,
    promptVersion,
  };
}
