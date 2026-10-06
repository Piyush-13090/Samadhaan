import { describe, expect, it } from 'vitest';
import { evaluateHealth, type HealthSnapshot } from './health-engine.js';

const thresholds = {
  inactivityDays: 4,
  deadlineWindowDays: 3,
  atRiskOverdueTasks: 2,
  blockingPriorities: ['HIGH', 'CRITICAL'],
};

const now = new Date('2026-10-08T06:00:00Z');

function snapshot(overrides: Partial<HealthSnapshot> = {}): HealthSnapshot {
  return {
    today: '2026-10-08',
    now,
    project: {
      status: 'ACTIVE',
      targetDate: null,
      createdAt: new Date('2026-10-01T00:00:00Z'),
      lastActivityAt: new Date('2026-10-07T12:00:00Z'),
    },
    tasks: [],
    milestones: [],
    ...overrides,
  };
}

const task = (id: string, overrides: Partial<HealthSnapshot['tasks'][number]> = {}) => ({
  id,
  title: `Task ${id}`,
  status: 'TODO' as const,
  priority: 'MEDIUM' as const,
  dueDate: null,
  ...overrides,
});

describe('evaluateHealth', () => {
  it('is HEALTHY with no warning signals', () => {
    const result = evaluateHealth(
      snapshot({ tasks: [task('a', { dueDate: '2026-10-20' })] }),
      thresholds,
    );
    expect(result).toMatchObject({ health: 'HEALTHY', reasons: [], signals: [] });
  });

  it('needs attention for one overdue task, citing it', () => {
    const result = evaluateHealth(
      snapshot({
        tasks: [task('a', { title: 'Site inspection', dueDate: '2026-10-07' })],
      }),
      thresholds,
    );
    expect(result.health).toBe('NEEDS_ATTENTION');
    expect(result.reasons).toEqual(['1 task is overdue']);
    expect(result.signals[0]).toMatchObject({
      code: 'OVERDUE_TASK',
      severity: 'MEDIUM',
      title: '“Site inspection” is 1 day overdue',
      sourceRef: 'task:a',
    });
  });

  it('is AT_RISK at the configured number of overdue tasks', () => {
    const tasks = [
      task('a', { dueDate: '2026-10-06' }),
      task('b', { dueDate: '2026-10-07' }),
    ];
    expect(evaluateHealth(snapshot({ tasks }), thresholds).health).toBe('AT_RISK');
    expect(
      evaluateHealth(snapshot({ tasks }), { ...thresholds, atRiskOverdueTasks: 3 })
        .health,
    ).toBe('NEEDS_ATTENTION');
  });

  it('is AT_RISK when a milestone is missed or the target date passes', () => {
    expect(
      evaluateHealth(
        snapshot({
          milestones: [
            {
              id: 'm',
              title: 'Repair planning',
              dueDate: '2026-10-05',
              completed: false,
            },
          ],
        }),
        thresholds,
      ).reasons,
    ).toEqual(['Milestone “Repair planning” is past its due date']);
    const passed = evaluateHealth(
      snapshot({
        project: { ...snapshot().project, targetDate: '2026-10-06' },
        tasks: [task('a')],
      }),
      thresholds,
    );
    expect(passed.health).toBe('AT_RISK');
    expect(passed.signals.map((s) => s.code)).toContain('TARGET_DATE_PASSED');
  });

  it('is BLOCKED only for blocked tasks at a blocking priority', () => {
    expect(
      evaluateHealth(
        snapshot({ tasks: [task('a', { status: 'BLOCKED', priority: 'CRITICAL' })] }),
        thresholds,
      ).health,
    ).toBe('BLOCKED');
    expect(
      evaluateHealth(
        snapshot({ tasks: [task('a', { status: 'BLOCKED', priority: 'LOW' })] }),
        thresholds,
      ).health,
    ).toBe('NEEDS_ATTENTION');
  });

  it('flags inactivity, but not for a paused project', () => {
    const quiet = {
      ...snapshot().project,
      lastActivityAt: new Date('2026-10-02T00:00:00Z'),
    };
    expect(evaluateHealth(snapshot({ project: quiet }), thresholds).reasons).toEqual([
      'No project activity in 6 days',
    ]);
    expect(
      evaluateHealth(snapshot({ project: { ...quiet, status: 'PAUSED' } }), thresholds)
        .health,
    ).toBe('HEALTHY');
  });

  it('lists approaching deadlines, soonest first', () => {
    const result = evaluateHealth(
      snapshot({
        tasks: [
          task('a', { dueDate: '2026-10-10' }),
          task('b', { dueDate: '2026-10-08', priority: 'HIGH' }),
        ],
        milestones: [
          { id: 'm', title: 'Repair', dueDate: '2026-10-09', completed: false },
        ],
      }),
      thresholds,
    );
    expect(result.deadlines.map((d) => [d.kind, d.daysLeft])).toEqual([
      ['task', 0],
      ['milestone', 1],
      ['task', 2],
    ]);
    expect(result.health).toBe('HEALTHY');
  });

  it('ignores completed and cancelled tasks, and finished projects', () => {
    const done = [
      task('a', { status: 'COMPLETED', dueDate: '2026-10-01' }),
      task('b', { status: 'CANCELLED', dueDate: '2026-10-01' }),
    ];
    expect(evaluateHealth(snapshot({ tasks: done }), thresholds).health).toBe('HEALTHY');
    const finished = evaluateHealth(
      snapshot({
        project: { ...snapshot().project, status: 'COMPLETED' },
        tasks: [task('x', { dueDate: '2026-01-01' })],
      }),
      thresholds,
    );
    expect(finished).toMatchObject({ health: 'HEALTHY', signals: [] });
  });
});
