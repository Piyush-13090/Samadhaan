import type { ModelTask } from '../generated/prisma/client.js';

/**
 * Trainable tasks (Prompt 28). Mirrors services/ai/app/models/tasks.py: a
 * version whose schema versions differ is refused at registration and again
 * when the AI service verifies the artifact before activation.
 */
export interface TaskSpec {
  /** Name the AI service uses. */
  aiTask: 'problem_category' | 'problem_severity' | 'problem_urgency' | 'duplicate_pair';
  featureSchema: string;
  labelSchema: string;
  labels: readonly string[];
  /** Advisory only, always; listed so the docs and UI copy can say why. */
  sensitive: boolean;
}

const LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

export const TASK_SPECS: Record<ModelTask, TaskSpec> = {
  PROBLEM_CATEGORY: {
    aiTask: 'problem_category',
    featureSchema: 'problem-text-v1',
    labelSchema: 'problem-category-v1',
    labels: [
      'ROADS',
      'POTHOLES',
      'STREETLIGHTS',
      'WATER',
      'DRAINAGE',
      'SANITATION',
      'GARBAGE',
      'TRAFFIC',
      'PUBLIC_SAFETY',
      'POLLUTION',
      'ELECTRICITY',
      'PUBLIC_TRANSPORT',
      'PARKS',
      'PUBLIC_INFRASTRUCTURE',
      'OTHER',
    ],
    sensitive: false,
  },
  PROBLEM_SEVERITY: {
    aiTask: 'problem_severity',
    featureSchema: 'problem-text-category-v1',
    labelSchema: 'problem-severity-v1',
    labels: LEVELS,
    sensitive: true,
  },
  PROBLEM_URGENCY: {
    aiTask: 'problem_urgency',
    featureSchema: 'problem-text-category-v1',
    labelSchema: 'problem-urgency-v1',
    labels: LEVELS,
    sensitive: true,
  },
  DUPLICATE_PAIR: {
    aiTask: 'duplicate_pair',
    featureSchema: 'duplicate-signals-v1',
    labelSchema: 'duplicate-pair-v1',
    labels: ['NOT_DUPLICATE', 'DUPLICATE'],
    sensitive: true,
  },
};

export const MODEL_TASKS = Object.keys(TASK_SPECS) as ModelTask[];

/** Tasks the problem-analysis pipeline annotates with advisory predictions. */
export const ANALYSIS_TASKS: ModelTask[] = [
  'PROBLEM_CATEGORY',
  'PROBLEM_SEVERITY',
  'PROBLEM_URGENCY',
];

export const artifactUriFor = (task: ModelTask, version: string) =>
  `${task.toLowerCase()}/${version}`;

/** A prediction as returned by the AI service, after validation here. */
export interface ModelPrediction {
  label: string | null;
  confidence: number;
  abstained: boolean;
  abstainReason: string | null;
  missingFeatures: string[];
  latencyMs: number;
}

/**
 * Validates the AI service's response against the task: a label outside the
 * task's labels, a confidence outside 0–1 or a malformed body is rejected (the
 * caller falls back), never passed on.
 */
export function parsePrediction(task: ModelTask, body: unknown): ModelPrediction | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const label =
    b.label === null ? null : typeof b.label === 'string' ? b.label : undefined;
  if (label === undefined) return null;
  if (label !== null && !TASK_SPECS[task].labels.includes(label)) return null;
  const confidence = Number(b.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
  const abstained = b.abstained === true;
  if (abstained !== (label === null)) return null;
  const missing = Array.isArray(b.missing_features)
    ? b.missing_features.filter((f): f is string => typeof f === 'string').slice(0, 10)
    : [];
  return {
    label,
    confidence,
    abstained,
    abstainReason:
      typeof b.abstain_reason === 'string' ? b.abstain_reason.slice(0, 40) : null,
    missingFeatures: missing,
    latencyMs: Math.max(0, Math.round(Number(b.latency_ms) || 0)),
  };
}

/** Coarse input size for monitoring: never the text itself. */
export function lengthBucket(chars: number): string {
  if (chars < 50) return '0-49';
  if (chars < 200) return '50-199';
  if (chars < 500) return '200-499';
  if (chars < 1000) return '500-999';
  return '1000+';
}
