import type {
  CoordinatorSignalCode,
  ProjectHealth,
  ProjectStatus,
  RiskSeverity,
  RiskType,
  TaskPriority,
  TaskStatus,
} from '@samadhaan/shared';
import type { CoordinatorHealthThresholds } from '../config/app.config.js';

/**
 * The deterministic health engine (Prompt 19).
 *
 * Health comes from the project's data first — overdue and blocked tasks,
 * missed milestones, a passed target date, inactivity — under thresholds from
 * configuration. The AI may interpret on top of this, but never below it.
 * Pure: no database, no clock beyond the `today`/`now` it is given, so every
 * rule is unit-tested.
 */

export interface HealthSnapshot {
  /** `YYYY-MM-DD` in the project time zone. */
  today: string;
  now: Date;
  project: {
    status: ProjectStatus;
    targetDate: string | null;
    createdAt: Date;
    /** Latest event, message or update. Null if nothing ever happened. */
    lastActivityAt: Date | null;
  };
  tasks: Array<{
    id: string;
    title: string;
    status: TaskStatus;
    priority: TaskPriority;
    dueDate: string | null;
  }>;
  milestones: Array<{
    id: string;
    title: string;
    dueDate: string | null;
    completed: boolean;
  }>;
}

export interface EngineSignal {
  /** `signal:<CODE>:<n>` — what AI findings cite. */
  ref: string;
  code: CoordinatorSignalCode;
  severity: RiskSeverity;
  title: string;
  /** `task:<id>`, `milestone:<id>`, or null. */
  sourceRef: string | null;
}

export interface EngineDeadline {
  kind: 'task' | 'milestone' | 'project';
  title: string;
  dueDate: string;
  daysLeft: number;
  sourceRef: string | null;
}

export interface EngineResult {
  health: ProjectHealth;
  reasons: string[];
  signals: EngineSignal[];
  deadlines: EngineDeadline[];
}

const OPEN: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'BLOCKED'];
const LIVE: ProjectStatus[] = ['PLANNED', 'ACTIVE', 'PAUSED'];

export const SIGNAL_RISK_TYPE: Record<CoordinatorSignalCode, RiskType> = {
  OVERDUE_TASK: 'OVERDUE_TASK',
  BLOCKED_TASK: 'BLOCKED_TASK',
  MILESTONE_OVERDUE: 'MILESTONE_DELAY',
  DEADLINE_APPROACHING: 'UPCOMING_DEADLINE',
  TARGET_DATE_PASSED: 'INSUFFICIENT_PROGRESS',
  INACTIVITY: 'MISSING_UPDATE',
};

export function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
  );
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function evaluateHealth(
  snapshot: HealthSnapshot,
  thresholds: CoordinatorHealthThresholds,
): EngineResult {
  const { today, project } = snapshot;
  if (!LIVE.includes(project.status)) {
    return {
      health: 'HEALTHY',
      reasons: [`The project is ${project.status.toLowerCase()}.`],
      signals: [],
      deadlines: [],
    };
  }

  const signals: EngineSignal[] = [];
  const deadlines: EngineDeadline[] = [];
  const add = (
    code: CoordinatorSignalCode,
    severity: RiskSeverity,
    title: string,
    sourceRef: string | null,
  ) =>
    signals.push({
      ref: `signal:${code}:${signals.length + 1}`,
      code,
      severity,
      title,
      sourceRef,
    });

  const open = snapshot.tasks.filter((task) => OPEN.includes(task.status));

  // Overdue and blocked tasks.
  const overdue = open.filter((task) => task.dueDate !== null && task.dueDate < today);
  for (const task of overdue) {
    const late = daysBetween(task.dueDate!, today);
    const high = task.priority === 'HIGH' || task.priority === 'CRITICAL' || late > 3;
    add(
      'OVERDUE_TASK',
      high ? 'HIGH' : 'MEDIUM',
      `“${task.title}” is ${plural(late, 'day')} overdue`,
      `task:${task.id}`,
    );
  }
  const blocked = open.filter((task) => task.status === 'BLOCKED');
  const criticalBlocked = blocked.filter((task) =>
    thresholds.blockingPriorities.includes(task.priority),
  );
  for (const task of blocked) {
    add(
      'BLOCKED_TASK',
      thresholds.blockingPriorities.includes(task.priority) ? 'HIGH' : 'MEDIUM',
      `“${task.title}” is blocked (${task.priority.toLowerCase()} priority)`,
      `task:${task.id}`,
    );
  }

  // Milestones past their due date.
  const missed = snapshot.milestones.filter(
    (m) => !m.completed && m.dueDate !== null && m.dueDate < today,
  );
  for (const milestone of missed) {
    add(
      'MILESTONE_OVERDUE',
      'HIGH',
      `Milestone “${milestone.title}” is ${plural(daysBetween(milestone.dueDate!, today), 'day')} past its due date`,
      `milestone:${milestone.id}`,
    );
  }

  // The project's own target date.
  const targetPassed =
    project.targetDate !== null && project.targetDate < today && open.length > 0;
  if (targetPassed) {
    add(
      'TARGET_DATE_PASSED',
      'HIGH',
      `The target date passed ${plural(daysBetween(project.targetDate!, today), 'day')} ago with ${plural(open.length, 'open task')}`,
      null,
    );
  }

  // Approaching deadlines.
  const window = thresholds.deadlineWindowDays;
  for (const task of open) {
    if (!task.dueDate || task.dueDate < today) continue;
    const left = daysBetween(today, task.dueDate);
    if (left > window) continue;
    deadlines.push({
      kind: 'task',
      title: task.title,
      dueDate: task.dueDate,
      daysLeft: left,
      sourceRef: `task:${task.id}`,
    });
    add(
      'DEADLINE_APPROACHING',
      task.priority === 'HIGH' || task.priority === 'CRITICAL' ? 'MEDIUM' : 'LOW',
      left === 0
        ? `“${task.title}” is due today`
        : `“${task.title}” is due in ${plural(left, 'day')}`,
      `task:${task.id}`,
    );
  }
  for (const milestone of snapshot.milestones) {
    if (milestone.completed || !milestone.dueDate || milestone.dueDate < today) continue;
    const left = daysBetween(today, milestone.dueDate);
    if (left <= window) {
      deadlines.push({
        kind: 'milestone',
        title: milestone.title,
        dueDate: milestone.dueDate,
        daysLeft: left,
        sourceRef: `milestone:${milestone.id}`,
      });
    }
  }
  if (project.targetDate && project.targetDate >= today) {
    const left = daysBetween(today, project.targetDate);
    if (left <= window) {
      deadlines.push({
        kind: 'project',
        title: 'Project target date',
        dueDate: project.targetDate,
        daysLeft: left,
        sourceRef: null,
      });
    }
  }
  deadlines.sort((a, b) => a.daysLeft - b.daysLeft);

  // Inactivity — not for a paused project, where quiet is expected.
  let inactiveDays: number | null = null;
  if (project.status !== 'PAUSED') {
    const last = project.lastActivityAt ?? project.createdAt;
    const days = Math.floor((snapshot.now.getTime() - last.getTime()) / 86_400_000);
    if (days >= thresholds.inactivityDays) {
      inactiveDays = days;
      add('INACTIVITY', 'MEDIUM', `No project activity in ${plural(days, 'day')}`, null);
    }
  }

  // Health: the worst rule that applies.
  const reasons: string[] = [];
  let health: ProjectHealth = 'HEALTHY';
  if (criticalBlocked.length > 0) {
    health = 'BLOCKED';
    reasons.push(
      criticalBlocked.length === 1
        ? `“${criticalBlocked[0]!.title}” is blocked at ${criticalBlocked[0]!.priority.toLowerCase()} priority`
        : `${criticalBlocked.length} high-priority tasks are blocked`,
    );
  }
  const atRisk =
    overdue.length >= thresholds.atRiskOverdueTasks || missed.length > 0 || targetPassed;
  if (atRisk && health === 'HEALTHY') health = 'AT_RISK';
  const attention = overdue.length > 0 || blocked.length > 0 || inactiveDays !== null;
  if (attention && health === 'HEALTHY') health = 'NEEDS_ATTENTION';

  if (overdue.length > 0)
    reasons.push(`${plural(overdue.length, 'task is', 'tasks are')} overdue`);
  const lowBlocked = blocked.length - criticalBlocked.length;
  if (lowBlocked > 0)
    reasons.push(`${plural(lowBlocked, 'task is', 'tasks are')} blocked`);
  for (const milestone of missed) {
    reasons.push(`Milestone “${milestone.title}” is past its due date`);
  }
  if (targetPassed)
    reasons.push('The project target date has passed with work still open');
  if (inactiveDays !== null)
    reasons.push(`No project activity in ${plural(inactiveDays, 'day')}`);

  return { health, reasons, signals, deadlines };
}
