import type {
  MilestoneStatus,
  ProjectActivityEntry,
  ProjectStatus,
  TaskPriority,
  TaskStatus,
} from '@samadhaan/shared';
import type { Tone } from '@/types/ui';

export function projectPath(roomId: string): string {
  return `/resolution/${encodeURIComponent(roomId)}/project`;
}

export const PROJECT_STATUS_DISPLAY: Record<
  ProjectStatus,
  { label: string; tone: Tone }
> = {
  PLANNED: { label: 'Planned', tone: 'info' },
  ACTIVE: { label: 'Active', tone: 'success' },
  PAUSED: { label: 'Paused', tone: 'warning' },
  COMPLETED: { label: 'Completed', tone: 'primary' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
};

/** What the button that moves a project there says. */
export const PROJECT_ACTION_LABEL: Record<ProjectStatus, string> = {
  PLANNED: 'Plan',
  ACTIVE: 'Start project',
  PAUSED: 'Pause',
  COMPLETED: 'Mark completed',
  CANCELLED: 'Cancel project',
};

export const TASK_STATUS_DISPLAY: Record<TaskStatus, { label: string; tone: Tone }> = {
  TODO: { label: 'To do', tone: 'neutral' },
  IN_PROGRESS: { label: 'In progress', tone: 'info' },
  BLOCKED: { label: 'Blocked', tone: 'danger' },
  COMPLETED: { label: 'Completed', tone: 'success' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
};

/** The button that moves a task there. */
export const TASK_ACTION_LABEL: Record<TaskStatus, string> = {
  TODO: 'To do',
  IN_PROGRESS: 'Start',
  BLOCKED: 'Mark blocked',
  COMPLETED: 'Complete',
  CANCELLED: 'Cancel task',
};

export const TASK_PRIORITY_DISPLAY: Record<TaskPriority, { label: string; tone: Tone }> =
  {
    LOW: { label: 'Low', tone: 'neutral' },
    MEDIUM: { label: 'Medium', tone: 'info' },
    HIGH: { label: 'High', tone: 'warning' },
    CRITICAL: { label: 'Critical', tone: 'danger' },
  };

export const MILESTONE_STATUS_DISPLAY: Record<
  MilestoneStatus,
  { label: string; tone: Tone }
> = {
  UPCOMING: { label: 'Upcoming', tone: 'neutral' },
  IN_PROGRESS: { label: 'In progress', tone: 'info' },
  COMPLETED: { label: 'Completed', tone: 'success' },
  OVERDUE: { label: 'Overdue', tone: 'danger' },
};

/** Board columns. Cancelled tasks are listed, not boarded. */
export const BOARD_COLUMNS: TaskStatus[] = [
  'TODO',
  'IN_PROGRESS',
  'BLOCKED',
  'COMPLETED',
];

const STATUS_WORD: Record<string, string> = {
  PLANNED: 'planned',
  ACTIVE: 'active',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  TODO: 'to do',
  IN_PROGRESS: 'in progress',
  BLOCKED: 'blocked',
};

/** "Aarav marked “Site visit” completed". Structured events, in words. */
export function describeProjectActivity(entry: ProjectActivityEntry): string {
  const who = entry.actor?.name ?? 'Someone';
  const what = entry.subject ? `“${entry.subject}”` : 'an item';
  switch (entry.kind) {
    case 'PROJECT_CREATED':
      return 'Project created';
    case 'PROJECT_UPDATED':
      return `${who} updated the project details`;
    case 'PROJECT_STATUS_CHANGED':
      if (entry.to === 'ACTIVE' && entry.from === 'PAUSED')
        return `${who} resumed the project`;
      if (entry.to === 'ACTIVE') return `${who} started the project`;
      return `${who} marked the project ${STATUS_WORD[entry.to ?? ''] ?? 'updated'}`;
    case 'TASK_CREATED':
      return `${who} created ${what}`;
    case 'TASK_UPDATED':
      return `${who} updated ${what}`;
    case 'TASK_ASSIGNED':
      return `${who} assigned ${what} to ${entry.detail ?? 'someone'}`;
    case 'TASK_STATUS_CHANGED':
      if (entry.to === 'IN_PROGRESS' && entry.from === 'BLOCKED')
        return `${who} unblocked ${what}`;
      if (entry.to === 'IN_PROGRESS') return `${who} started ${what}`;
      return `${who} marked ${what} ${STATUS_WORD[entry.to ?? ''] ?? 'updated'}`;
    case 'MILESTONE_CREATED':
      return `${who} added milestone ${what}`;
    case 'MILESTONE_UPDATED':
      return `${who} updated milestone ${what}`;
    case 'MILESTONE_COMPLETED':
      return `${who} completed milestone ${what}`;
    case 'MILESTONE_REOPENED':
      return `${who} reopened milestone ${what}`;
  }
}

/** The events the timeline shows; the activity feed shows everything. */
export const TIMELINE_KINDS: ProjectActivityEntry['kind'][] = [
  'PROJECT_CREATED',
  'PROJECT_STATUS_CHANGED',
  'MILESTONE_COMPLETED',
];

export function formatDay(date: string | null): string {
  if (!date) return '—';
  return new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
