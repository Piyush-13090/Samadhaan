import {
  PROJECT_STATUSES,
  TASK_STATUSES,
  canTransitionProject,
  canTransitionTask,
  isOverdue,
  milestoneStatus,
  projectToday,
  taskProgressPercent,
} from '@samadhaan/shared';
import { describe, expect, it } from 'vitest';
import { initialProjectText } from './room-opening.js';
import { dateIn, dateOut } from './projects.service.js';

describe('project state machine', () => {
  it('allows exactly the documented transitions', () => {
    const allowed = new Set([
      'PLANNED>ACTIVE',
      'PLANNED>CANCELLED',
      'ACTIVE>PAUSED',
      'ACTIVE>COMPLETED',
      'ACTIVE>CANCELLED',
      'PAUSED>ACTIVE',
      'PAUSED>CANCELLED',
    ]);
    for (const from of PROJECT_STATUSES) {
      for (const to of PROJECT_STATUSES) {
        expect(canTransitionProject(from, to)).toBe(allowed.has(`${from}>${to}`));
      }
    }
  });
});

describe('task state machine', () => {
  it('allows exactly the documented transitions', () => {
    const allowed = new Set([
      'TODO>IN_PROGRESS',
      'TODO>CANCELLED',
      'IN_PROGRESS>BLOCKED',
      'IN_PROGRESS>COMPLETED',
      'IN_PROGRESS>CANCELLED',
      'BLOCKED>IN_PROGRESS',
      'BLOCKED>CANCELLED',
    ]);
    for (const from of TASK_STATUSES) {
      for (const to of TASK_STATUSES) {
        expect(canTransitionTask(from, to)).toBe(allowed.has(`${from}>${to}`));
      }
    }
  });
});

describe('progress', () => {
  it('is completed over non-cancelled tasks, floored, and 0 with no tasks', () => {
    expect(taskProgressPercent({ total: 0, completed: 0, cancelled: 0 })).toBe(0);
    expect(taskProgressPercent({ total: 3, completed: 0, cancelled: 3 })).toBe(0);
    expect(taskProgressPercent({ total: 19, completed: 8, cancelled: 0 })).toBe(42);
    expect(taskProgressPercent({ total: 4, completed: 2, cancelled: 2 })).toBe(100);
    expect(taskProgressPercent({ total: 3, completed: 1, cancelled: 1 })).toBe(50);
    // Never rounds up to "done".
    expect(taskProgressPercent({ total: 1000, completed: 999, cancelled: 0 })).toBe(99);
  });
});

describe('overdue and milestone status', () => {
  const today = '2026-10-06';

  it('is overdue only when open and due before today', () => {
    expect(isOverdue('2026-10-05', 'IN_PROGRESS', today)).toBe(true);
    expect(isOverdue('2026-10-06', 'TODO', today)).toBe(false);
    expect(isOverdue('2026-10-05', 'COMPLETED', today)).toBe(false);
    expect(isOverdue('2026-10-05', 'CANCELLED', today)).toBe(false);
    expect(isOverdue(null, 'TODO', today)).toBe(false);
  });

  it('derives milestone status from completion, dates and work', () => {
    const base = { completedAt: null, dueDate: '2026-10-10', workStarted: false, today };
    expect(milestoneStatus(base)).toBe('UPCOMING');
    expect(milestoneStatus({ ...base, workStarted: true })).toBe('IN_PROGRESS');
    expect(milestoneStatus({ ...base, dueDate: '2026-10-01' })).toBe('OVERDUE');
    expect(
      milestoneStatus({
        ...base,
        dueDate: '2026-10-01',
        completedAt: '2026-10-02T00:00:00Z',
      }),
    ).toBe('COMPLETED');
  });

  it('computes today in India, not UTC', () => {
    // 20:00 UTC on 6 Oct is 01:30 on 7 Oct in India.
    expect(projectToday(new Date('2026-10-06T20:00:00Z'))).toBe('2026-10-07');
  });

  it('round-trips calendar dates', () => {
    expect(dateOut(dateIn('2026-10-20'))).toBe('2026-10-20');
    expect(dateIn(null)).toBeNull();
  });
});

describe('initial project text', () => {
  it('comes from the problem, with nothing invented', () => {
    expect(
      initialProjectText({
        title: 'Large pothole causing traffic disruption',
        address: 'Sector 48',
        city: 'Gurgaon',
      }),
    ).toEqual({
      name: 'Resolve: Large pothole causing traffic disruption',
      description:
        'Resolution project for "Large pothole causing traffic disruption", reported at Sector 48, Gurgaon.',
    });
    expect(
      initialProjectText({ title: 'x'.repeat(300), address: null, city: null }).name,
    ).toHaveLength(200);
  });
});
