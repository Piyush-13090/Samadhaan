import type { OrganizationMemberRole, ProblemCategory, ProblemStatus } from './problem.js';
import type { ResolutionAttachmentView, ResolutionParticipantSide } from './resolution.js';

/**
 * Resolution projects (Prompt 18): the deterministic plan inside a resolution
 * room — tasks, milestones and progress derived from them.
 *
 * Nothing here is generated or scored by AI. Names, tasks and milestones are
 * written by people; progress is arithmetic over recorded state.
 */

/** Dates are calendar days in this zone (due today = not yet overdue). */
export const PROJECT_TIME_ZONE = 'Asia/Kolkata';

// ---------------------------------------------------------------- project

export const PROJECT_STATUSES = ['PLANNED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_TRANSITIONS: Readonly<Record<ProjectStatus, readonly ProjectStatus[]>> = {
  PLANNED: ['ACTIVE', 'CANCELLED'],
  ACTIVE: ['PAUSED', 'COMPLETED', 'CANCELLED'],
  PAUSED: ['ACTIVE', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransitionProject(from: ProjectStatus, to: ProjectStatus): boolean {
  return PROJECT_TRANSITIONS[from].includes(to);
}

/** Tasks and milestones can change only while the project is live. */
export const PROJECT_EDITABLE_STATUSES: readonly ProjectStatus[] = ['PLANNED', 'ACTIVE', 'PAUSED'];

// ------------------------------------------------------------------- tasks

export const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELLED'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  TODO: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['BLOCKED', 'COMPLETED', 'CANCELLED'],
  BLOCKED: ['IN_PROGRESS', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

/** What a MEMBER may do to a task assigned to them. Never cancel. */
export const TASK_ASSIGNEE_TRANSITIONS: readonly TaskStatus[] = ['IN_PROGRESS', 'BLOCKED', 'COMPLETED'];

export function canTransitionTask(from: TaskStatus, to: TaskStatus): boolean {
  return TASK_TRANSITIONS[from].includes(to);
}

export const OPEN_TASK_STATUSES: readonly TaskStatus[] = ['TODO', 'IN_PROGRESS', 'BLOCKED'];

export const TASK_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** Organisation roles that manage the plan. MEMBERs update their own tasks. */
export const PROJECT_MANAGER_ROLES = ['OWNER', 'ADMIN'] as const satisfies readonly OrganizationMemberRole[];

export const PROJECT_NAME_MAX_LENGTH = 200;
export const PROJECT_DESCRIPTION_MAX_LENGTH = 2000;
export const TASK_TITLE_MAX_LENGTH = 200;
export const TASK_DESCRIPTION_MAX_LENGTH = 4000;
export const TASK_MAX_ATTACHMENTS = 10;
export const TASKS_PAGE_MAX = 200;

/** Overdue: due before today (project time zone), and still open. */
export function isOverdue(
  dueDate: string | null,
  status: TaskStatus,
  today: string,
): boolean {
  return dueDate !== null && dueDate < today && OPEN_TASK_STATUSES.includes(status);
}

/** `YYYY-MM-DD` for "today" in the project time zone. */
export function projectToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: PROJECT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

// -------------------------------------------------------------- milestones

/** Derived, never stored. */
export type MilestoneStatus = 'UPCOMING' | 'IN_PROGRESS' | 'COMPLETED' | 'OVERDUE';

export function milestoneStatus(input: {
  completedAt: string | null;
  dueDate: string | null;
  /** Any of its tasks has moved past TODO. */
  workStarted: boolean;
  today: string;
}): MilestoneStatus {
  if (input.completedAt) return 'COMPLETED';
  if (input.dueDate && input.dueDate < input.today) return 'OVERDUE';
  return input.workStarted ? 'IN_PROGRESS' : 'UPCOMING';
}

// ---------------------------------------------------------------- progress

export interface TaskCounts {
  total: number;
  todo: number;
  inProgress: number;
  blocked: number;
  completed: number;
  cancelled: number;
  overdue: number;
}

/**
 * completed ÷ (all tasks − cancelled), floored to a whole percent so 99.6%
 * never reads as done. No tasks (or only cancelled ones) is 0%.
 */
export function taskProgressPercent(counts: Pick<TaskCounts, 'total' | 'completed' | 'cancelled'>): number {
  const counted = counts.total - counts.cancelled;
  if (counted <= 0) return 0;
  return Math.floor((counts.completed / counted) * 100);
}

export function milestoneProgressPercent(completed: number, total: number): number {
  return total <= 0 ? 0 : Math.floor((completed / total) * 100);
}

// ------------------------------------------------------------------- views

export interface ProjectPermissions {
  /** OWNER/ADMIN of the assigned organisation. */
  canManage: boolean;
  /** Any organisation member — for their own assigned tasks. */
  canUpdateOwnTasks: boolean;
  /** Project is PLANNED/ACTIVE/PAUSED and the room is open. */
  isEditable: boolean;
  allowedTransitions: ProjectStatus[];
}

export interface ProjectOverview {
  tasks: TaskCounts;
  taskProgress: number;
  milestones: { total: number; completed: number; overdue: number };
  milestoneProgress: number;
}

/** `GET /resolution-rooms/:roomId/project`, `GET /resolution-projects/:id` */
export interface ProjectView {
  id: string;
  roomId: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  startDate: string | null;
  targetDate: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  problem: {
    publicId: string;
    title: string;
    status: ProblemStatus;
    category: ProblemCategory;
    subcategory: string | null;
    area: string | null;
  };
  government: { name: string };
  organization: { name: string; slug: string };
  overview: ProjectOverview;
  viewer: { userId: string; side: ResolutionParticipantSide; role: OrganizationMemberRole };
  permissions: ProjectPermissions;
  /** `YYYY-MM-DD` the server used for overdue — the client uses the same. */
  today: string;
}

/** A project card on a dashboard. */
export interface ProjectSummary {
  id: string;
  roomId: string;
  name: string;
  status: ProjectStatus;
  problemPublicId: string;
  government: { name: string };
  organization: { name: string };
  targetDate: string | null;
  overview: ProjectOverview;
}

export interface TaskPerson {
  userId: string;
  name: string;
  avatarUrl: string | null;
}

export interface TaskView {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assignee: TaskPerson | null;
  milestone: { id: string; title: string } | null;
  dueDate: string | null;
  overdue: boolean;
  startedAt: string | null;
  completedAt: string | null;
  completedBy: TaskPerson | null;
  cancelledAt: string | null;
  createdBy: TaskPerson;
  createdAt: string;
  updatedAt: string;
  version: number;
  attachments: ResolutionAttachmentView[];
  /** What the viewer may move this task to. */
  allowedTransitions: TaskStatus[];
  /** The viewer may edit title, description, assignee, dates. */
  canEdit: boolean;
}

export interface TaskPage {
  items: TaskView[];
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
}

export interface MilestoneView {
  id: string;
  title: string;
  description: string | null;
  dueDate: string | null;
  status: MilestoneStatus;
  completedAt: string | null;
  completedBy: TaskPerson | null;
  tasks: { total: number; completed: number; cancelled: number; open: number };
  progress: number;
  version: number;
  createdAt: string;
}

export interface ProjectAssignee extends TaskPerson {
  membershipRole: OrganizationMemberRole;
}

export type ProjectActivityKind =
  | 'PROJECT_CREATED'
  | 'PROJECT_UPDATED'
  | 'PROJECT_STATUS_CHANGED'
  | 'TASK_CREATED'
  | 'TASK_UPDATED'
  | 'TASK_ASSIGNED'
  | 'TASK_STATUS_CHANGED'
  | 'MILESTONE_CREATED'
  | 'MILESTONE_UPDATED'
  | 'MILESTONE_COMPLETED'
  | 'MILESTONE_REOPENED';

export interface ProjectActivityEntry {
  id: string;
  kind: ProjectActivityKind;
  actor: { name: string; organizationName: string | null } | null;
  /** Task or milestone title, as it was when the event happened. */
  subject: string | null;
  from: string | null;
  to: string | null;
  /** Assignee name for TASK_ASSIGNED; reason for status changes. */
  detail: string | null;
  createdAt: string;
}

export interface ProjectActivityPage {
  items: ProjectActivityEntry[];
  nextCursor: string | null;
}
