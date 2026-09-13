import type { ProblemCategory, ProblemSeverity, ProblemUrgency } from './problem.js';

/**
 * AI analysis contracts shared by the API and the web app.
 *
 * The AI service speaks snake_case (Python) and the API speaks camelCase; the
 * translation happens once, in the NestJS client, so nothing downstream has to
 * know which side produced a field.
 */

export const ANALYSIS_PROCESSING_STATUSES = [
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
] as const;

export type AnalysisProcessingStatus = (typeof ANALYSIS_PROCESSING_STATUSES)[number];

/**
 * A completed AI analysis, as shown to a citizen.
 *
 * Deliberately absent: the provider's raw response, the prompt, any private
 * model reasoning. `observations` are short evidence statements written for the
 * reader — never a window into how the model decided.
 */
export interface ProblemAnalysisView {
  id: string;
  status: AnalysisProcessingStatus;

  category: ProblemCategory | null;
  subcategory: string | null;
  severity: ProblemSeverity | null;
  urgency: ProblemUrgency | null;
  /** 0–10, derived from the severity band. */
  severityScore: number | null;
  summary: string | null;
  /** 0–1. Always displayed with the finding, never on its own. */
  confidence: number | null;
  observations: string[];

  /**
   * Which model produced this. Shown so a citizen can tell a real analysis from
   * a development placeholder, and so a regression is traceable.
   */
  modelName: string;
  /** True when the analysis rested on text alone. */
  textOnly: boolean;

  /** Operator-facing failure reason. Null unless `status` is FAILED. */
  errorMessage: string | null;
  processingMs: number | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * How to describe a confidence value to a person.
 *
 * A bare percentage invites false precision — it reads like a measurement when
 * it is an estimate. Pairing it with a plain-language band tells the reader how
 * much weight to give the result.
 */
export function confidenceBand(confidence: number): {
  label: string;
  tone: 'success' | 'warning' | 'danger';
} {
  if (confidence >= 0.85) return { label: 'High confidence', tone: 'success' };
  if (confidence >= 0.6) return { label: 'Moderate confidence', tone: 'warning' };
  return { label: 'AI is less certain about this', tone: 'danger' };
}

/** Stages shown while an analysis runs. Presentation only. */
export const ANALYSIS_STAGES = [
  { id: 'image', label: 'Understanding the photo' },
  { id: 'text', label: 'Reading your description' },
  { id: 'identify', label: 'Identifying the problem' },
  { id: 'severity', label: 'Estimating severity' },
  { id: 'summary', label: 'Preparing a summary' },
] as const;

export type AnalysisStageId = (typeof ANALYSIS_STAGES)[number]['id'];
