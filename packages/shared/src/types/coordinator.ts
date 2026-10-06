import type { ResolutionParticipantSide } from './resolution.js';

/**
 * AI Project Coordinator (Prompt 19): advisory insights over a resolution
 * project.
 *
 * Health is computed **deterministically** from the project's data, live, on
 * every read; the AI adds an interpretation — a summary, suggestions, questions
 * and blockers it noticed in messages — that is cached, timestamped and marked
 * stale when the project changes. Every AI finding cites the tasks, messages or
 * events it rests on. Nothing here can change the project: people act.
 *
 * Project health is not civic priority. Prompt 21's priority engine is a
 * separate system.
 */

export const PROJECT_HEALTH_LEVELS = ['HEALTHY', 'NEEDS_ATTENTION', 'AT_RISK', 'BLOCKED'] as const;
export type ProjectHealth = (typeof PROJECT_HEALTH_LEVELS)[number];

export const RISK_TYPES = [
  'OVERDUE_TASK',
  'BLOCKED_TASK',
  'UPCOMING_DEADLINE',
  'MISSING_UPDATE',
  'MILESTONE_DELAY',
  'INSUFFICIENT_PROGRESS',
  'REPEATED_BLOCKER',
  'OTHER',
] as const;
export type RiskType = (typeof RISK_TYPES)[number];

export const RISK_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type RiskSeverity = (typeof RISK_SEVERITIES)[number];

export const QUESTION_CATEGORIES = [
  'TASK_PROGRESS',
  'BLOCKER',
  'DEADLINE',
  'MILESTONE',
  'MISSING_UPDATE',
  'GENERAL',
] as const;
export type QuestionCategory = (typeof QUESTION_CATEGORIES)[number];

export type CoordinatorQuestionStatus = 'OPEN' | 'ANSWERED' | 'DISMISSED' | 'EXPIRED';

/** The deterministic signals the health engine recognises. */
export type CoordinatorSignalCode =
  | 'OVERDUE_TASK'
  | 'BLOCKED_TASK'
  | 'MILESTONE_OVERDUE'
  | 'DEADLINE_APPROACHING'
  | 'TARGET_DATE_PASSED'
  | 'INACTIVITY';

/** Something a finding rests on, resolved to a label and a link. */
export interface SourceReference {
  kind: 'task' | 'milestone' | 'message' | 'event' | 'update' | 'question' | 'signal' | 'knowledge';
  id: string;
  label: string;
  href: string | null;
}

export interface CoordinatorSignal {
  code: CoordinatorSignalCode;
  severity: RiskSeverity;
  title: string;
  source: SourceReference | null;
}

export interface CoordinatorRisk {
  type: RiskType;
  severity: RiskSeverity;
  title: string;
  description: string;
  sources: SourceReference[];
  /** Deterministic (from data) or AI-identified. */
  origin: 'RULE' | 'AI';
}

export interface CoordinatorBlocker {
  title: string;
  description: string;
  sources: SourceReference[];
  /** RULE: a task marked BLOCKED. AI: noticed in messages — unconfirmed. */
  origin: 'RULE' | 'AI';
}

export interface CoordinatorDeadline {
  kind: 'task' | 'milestone' | 'project';
  title: string;
  dueDate: string;
  daysLeft: number;
  source: SourceReference | null;
}

export interface CoordinatorQuestionView {
  id: string;
  question: string;
  category: QuestionCategory;
  status: CoordinatorQuestionStatus;
  target: SourceReference | null;
  askedAt: string;
  answer: string | null;
  answeredAt: string | null;
  answeredBy: { name: string } | null;
}

/** `GET /resolution-projects/:id/ai-coordinator` */
export interface CoordinatorView {
  /** Live, deterministic. Always current. */
  health: {
    level: ProjectHealth;
    reasons: string[];
    signals: CoordinatorSignal[];
  };
  /** Deterministic findings, computed live. */
  risks: CoordinatorRisk[];
  blockers: CoordinatorBlocker[];
  deadlines: CoordinatorDeadline[];
  /** The latest AI interpretation, or null if none has run. */
  insight: {
    health: ProjectHealth;
    healthReason: string;
    summary: string;
    risks: CoordinatorRisk[];
    blockers: CoordinatorBlocker[];
    suggestions: Array<{ text: string; sources: SourceReference[] }>;
    generatedAt: string;
    expiresAt: string;
    /** The project changed since, or it expired. Shown as possibly outdated. */
    stale: boolean;
    model: { provider: string; name: string; version: string; promptVersion: string };
  } | null;
  /** The newest attempt failed — the previous insight (if any) is kept. */
  lastFailure: { at: string; message: string } | null;
  questions: CoordinatorQuestionView[];
  /** When the viewer may refresh again (rate limit), or null now. */
  refreshAvailableAt: string | null;
  canRefresh: boolean;
  canAnswer: boolean;
  canPostUpdates: boolean;
}

export const PROJECT_UPDATE_ITEM_MAX = 200;
export const PROJECT_UPDATE_ITEMS_MAX = 8;
export const UPDATE_EXTRACT_TEXT_MAX = 6000;
export const QUESTION_ANSWER_MAX = 1000;

/** A structured update, as written or confirmed by a person. */
export interface ProjectUpdateView {
  id: string;
  summary: string;
  completed: string[];
  current: string[];
  blockers: string[];
  nextSteps: string[];
  source: 'MANUAL' | 'AI_ASSISTED';
  author: { name: string; organizationName: string; side: ResolutionParticipantSide };
  createdAt: string;
}

/** An AI-drafted update. Not saved until its author confirms it. */
export interface ExtractedUpdateView {
  summary: string;
  completed: string[];
  current: string[];
  blockers: string[];
  nextSteps: string[];
  /** The model does not report a calibrated confidence. Always null. */
  confidence: null;
  model: { provider: string; name: string; version: string; promptVersion: string };
}
