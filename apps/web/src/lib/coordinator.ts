import type { ProjectHealth, QuestionCategory, RiskSeverity } from '@samadhaan/shared';
import type { Tone } from '@/types/ui';

export const HEALTH_DISPLAY: Record<
  ProjectHealth,
  { label: string; tone: Tone; description: string }
> = {
  HEALTHY: {
    label: 'Healthy',
    tone: 'success',
    description: 'No warning signals in the project data.',
  },
  NEEDS_ATTENTION: {
    label: 'Needs attention',
    tone: 'warning',
    description: 'Something needs a follow-up.',
  },
  AT_RISK: { label: 'At risk', tone: 'danger', description: 'The plan is slipping.' },
  BLOCKED: {
    label: 'Blocked',
    tone: 'danger',
    description: 'High-priority work cannot proceed.',
  },
};

export const SEVERITY_DISPLAY: Record<RiskSeverity, { label: string; tone: Tone }> = {
  LOW: { label: 'Low', tone: 'neutral' },
  MEDIUM: { label: 'Medium', tone: 'warning' },
  HIGH: { label: 'High', tone: 'danger' },
};

export const QUESTION_CATEGORY_LABEL: Record<QuestionCategory, string> = {
  TASK_PROGRESS: 'Task progress',
  BLOCKER: 'Blocker',
  DEADLINE: 'Deadline',
  MILESTONE: 'Milestone',
  MISSING_UPDATE: 'Progress update',
  GENERAL: 'General',
};

/** Split a textarea into update items: one per line, trimmed, non-empty. */
export function linesToItems(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.replace(/^[-•*]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 8);
}
