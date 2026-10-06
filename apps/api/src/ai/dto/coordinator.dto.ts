import {
  PROJECT_HEALTH_LEVELS,
  QUESTION_CATEGORIES,
  RISK_SEVERITIES,
  RISK_TYPES,
  type ProjectHealth,
  type QuestionCategory,
  type RiskSeverity,
  type RiskType,
} from '@samadhaan/shared';

/**
 * AI Project Coordinator, between the API and the AI service (Prompt 19).
 *
 * The request is the structured context the API built (snake_case, as the
 * Python schema expects). The response is re-validated here even though the
 * AI service validates its own output: enums, lengths, and — most important —
 * that every cited ref is one the API actually sent. A finding that cites
 * nothing real is dropped; health outside the allowed range is rejected.
 */

export interface CoordinatorContext {
  project_id: string;
  today: string;
  problem: {
    public_id: string;
    title: string;
    description: string;
    category: string;
    subcategory: string | null;
    severity: string | null;
    urgency: string | null;
    area: string | null;
    ai_summary: string | null;
  };
  project: {
    name: string;
    status: string;
    start_date: string | null;
    target_date: string | null;
    task_progress: number;
    open_tasks: number;
    completed_tasks: number;
    cancelled_tasks: number;
  };
  tasks: Array<{
    ref: string;
    title: string;
    status: string;
    priority: string;
    assignee: string | null;
    due_date: string | null;
    overdue: boolean;
    days_overdue: number | null;
    milestone_ref: string | null;
    days_since_update: number | null;
  }>;
  milestones: Array<{
    ref: string;
    title: string;
    status: string;
    due_date: string | null;
    open_tasks: number;
    completed_tasks: number;
  }>;
  events: Array<{
    ref: string;
    kind: string;
    subject: string | null;
    detail: string | null;
    days_ago: number;
  }>;
  messages: Array<{
    ref: string;
    side: 'GOVERNMENT' | 'ORGANIZATION';
    author: string;
    days_ago: number;
    text: string;
  }>;
  updates: Array<{
    ref: string;
    days_ago: number;
    summary: string;
    completed: string[];
    current: string[];
    blockers: string[];
    next_steps: string[];
  }>;
  answered_questions: Array<{
    ref: string;
    question: string;
    answer: string | null;
    days_ago: number;
  }>;
  open_questions: Array<{
    ref: string;
    question: string;
    answer: null;
    days_ago: number;
  }>;
  signals: Array<{
    ref: string;
    code: string;
    severity: RiskSeverity;
    title: string;
    source_ref: string | null;
  }>;
  /** Retrieved guidance (Prompt 20): PUBLIC and this project's sources only. */
  knowledge: Array<{
    ref: string;
    title: string;
    section: string | null;
    excerpt: string;
  }>;
  baseline: { health: ProjectHealth; reasons: string[] };
}

export interface AiCoordinatorFinding {
  title: string;
  description: string;
  sourceRefs: string[];
}

export interface AiCoordinatorResult {
  summary: string;
  health: ProjectHealth;
  healthReason: string;
  risks: Array<AiCoordinatorFinding & { type: RiskType; severity: RiskSeverity }>;
  blockers: AiCoordinatorFinding[];
  suggestions: Array<{ text: string; sourceRefs: string[] }>;
  questions: Array<{
    question: string;
    category: QuestionCategory;
    targetRef: string | null;
    sourceRefs: string[];
  }>;
  provider: string;
  modelName: string;
  modelVersion: string;
  promptVersion: string;
  processingMs: number;
  droppedItems: number;
}

export interface AiExtractedUpdate {
  summary: string;
  completed: string[];
  current: string[];
  blockers: string[];
  nextSteps: string[];
  provider: string;
  modelName: string;
  modelVersion: string;
  promptVersion: string;
}

const HEALTH_ORDER: Record<ProjectHealth, number> = {
  HEALTHY: 0,
  NEEDS_ATTENTION: 1,
  AT_RISK: 2,
  BLOCKED: 3,
};

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value.trim().length > 0
    ? value.trim().slice(0, max)
    : null;
const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): T | null =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
const strings = (value: unknown, maxItems: number, maxLength: number): string[] =>
  Array.isArray(value)
    ? value
        .map((item) => str(item, maxLength))
        .filter((item): item is string => item !== null)
        .slice(0, maxItems)
    : [];

/**
 * Parses and grounds a coordinator result. Returns null when the shape is
 * unusable — the caller records a FAILED insight and keeps the previous one.
 */
export function parseCoordinatorResponse(
  body: unknown,
  knownRefs: ReadonlySet<string>,
  targetRefs: ReadonlySet<string>,
  baseline: ProjectHealth,
): AiCoordinatorResult | null {
  if (!isObject(body)) return null;
  const summary = str(body.summary, 1200);
  const health = oneOf(body.health, PROJECT_HEALTH_LEVELS);
  const provider = str(body.provider, 100);
  const modelName = str(body.model_name, 200);
  const modelVersion = str(body.model_version, 200);
  const promptVersion = str(body.prompt_version, 100);
  if (!summary || !health || !provider || !modelName || !modelVersion || !promptVersion)
    return null;
  // The AI service enforces this; a response that breaks it is not trusted.
  const delta = HEALTH_ORDER[health] - HEALTH_ORDER[baseline];
  if (delta < 0 || delta > 1) return null;

  let dropped = typeof body.dropped_items === 'number' ? body.dropped_items : 0;
  const cite = (value: unknown): string[] => {
    const refs = strings(value, 6, 120);
    const kept = refs.filter((ref) => knownRefs.has(ref));
    return [...new Set(kept)];
  };
  const finding = (item: unknown): AiCoordinatorFinding | null => {
    if (!isObject(item)) return null;
    const title = str(item.title, 160);
    const description = str(item.description, 600) ?? title;
    const sourceRefs = cite(item.source_refs);
    if (!title || !description || sourceRefs.length === 0) {
      dropped += 1;
      return null;
    }
    return { title, description, sourceRefs };
  };

  const risks = (Array.isArray(body.risks) ? body.risks : [])
    .slice(0, 8)
    .map((item) => {
      const base = finding(item);
      if (!base || !isObject(item)) return null;
      const type = oneOf(item.type, RISK_TYPES) ?? 'OTHER';
      const severity = oneOf(item.severity, RISK_SEVERITIES) ?? 'MEDIUM';
      return { ...base, type, severity };
    })
    .filter((item) => item !== null);

  const blockers = (Array.isArray(body.potential_blockers) ? body.potential_blockers : [])
    .slice(0, 5)
    .map(finding)
    .filter((item) => item !== null);

  const suggestions = (Array.isArray(body.suggestions) ? body.suggestions : [])
    .slice(0, 5)
    .map((item) => {
      if (!isObject(item)) return null;
      const text = str(item.text, 600);
      const sourceRefs = cite(item.source_refs);
      if (!text || sourceRefs.length === 0) {
        dropped += 1;
        return null;
      }
      return { text, sourceRefs };
    })
    .filter((item) => item !== null);

  const questions = (Array.isArray(body.questions) ? body.questions : [])
    .slice(0, 4)
    .map((item) => {
      if (!isObject(item)) return null;
      const question = str(item.question, 400);
      const category = oneOf(item.category, QUESTION_CATEGORIES) ?? 'GENERAL';
      const target =
        typeof item.target_ref === 'string' && targetRefs.has(item.target_ref)
          ? item.target_ref
          : null;
      const sourceRefs = cite(item.source_refs);
      if (!question || sourceRefs.length === 0) {
        dropped += 1;
        return null;
      }
      return { question, category, targetRef: target, sourceRefs };
    })
    .filter((item) => item !== null);

  return {
    summary,
    health,
    healthReason: str(body.health_reason, 600) ?? '',
    risks,
    blockers,
    suggestions,
    questions,
    provider,
    modelName,
    modelVersion,
    promptVersion,
    processingMs:
      typeof body.processing_ms === 'number'
        ? Math.max(0, Math.round(body.processing_ms))
        : 0,
    droppedItems: dropped,
  };
}

export function parseExtractResponse(body: unknown): AiExtractedUpdate | null {
  if (!isObject(body)) return null;
  const summary = str(body.summary, 400);
  const provider = str(body.provider, 100);
  const modelName = str(body.model_name, 200);
  const modelVersion = str(body.model_version, 200);
  const promptVersion = str(body.prompt_version, 100);
  if (!summary || !provider || !modelName || !modelVersion || !promptVersion) return null;
  return {
    summary,
    completed: strings(body.completed, 8, 200),
    current: strings(body.current, 8, 200),
    blockers: strings(body.blockers, 8, 200),
    nextSteps: strings(body.next_steps, 8, 200),
    provider,
    modelName,
    modelVersion,
    promptVersion,
  };
}
