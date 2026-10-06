import { describe, expect, it } from 'vitest';
import { parseCoordinatorResponse, parseExtractResponse } from './coordinator.dto.js';

const TASK = 'task:11111111-1111-4111-8111-111111111111';
const known = new Set([TASK, 'message:m1', 'signal:OVERDUE_TASK:1']);
const targets = new Set([TASK]);

const body = (overrides: Record<string, unknown> = {}) => ({
  summary: 'The inspection is overdue.',
  health: 'NEEDS_ATTENTION',
  health_reason: 'One task is overdue.',
  risks: [
    {
      type: 'OVERDUE_TASK',
      severity: 'HIGH',
      title: 'Inspection overdue',
      description: 'd',
      source_refs: [TASK],
    },
  ],
  potential_blockers: [],
  suggestions: [{ text: 'Ask for an update.', source_refs: [TASK] }],
  questions: [
    {
      question: 'Was it done?',
      category: 'TASK_PROGRESS',
      target_ref: TASK,
      source_refs: [TASK],
    },
  ],
  provider: 'anthropic',
  model_name: 'claude',
  model_version: 'claude-2026',
  prompt_version: 'coordinator-2026-10-v1',
  processing_ms: 1200,
  dropped_items: 0,
  ...overrides,
});

describe('parseCoordinatorResponse', () => {
  it('accepts a grounded result', () => {
    const parsed = parseCoordinatorResponse(body(), known, targets, 'NEEDS_ATTENTION');
    expect(parsed).toMatchObject({
      health: 'NEEDS_ATTENTION',
      modelVersion: 'claude-2026',
      promptVersion: 'coordinator-2026-10-v1',
      questions: [{ targetRef: TASK }],
    });
  });

  it('re-grounds findings against the refs the API sent', () => {
    const parsed = parseCoordinatorResponse(
      body({
        risks: [
          {
            type: 'OTHER',
            severity: 'HIGH',
            title: 'Invented',
            description: 'x',
            source_refs: ['task:other'],
          },
        ],
        questions: [
          {
            question: 'Q?',
            category: 'NOPE',
            target_ref: 'milestone:x',
            source_refs: [TASK],
          },
        ],
      }),
      known,
      targets,
      'NEEDS_ATTENTION',
    );
    expect(parsed!.risks).toEqual([]);
    expect(parsed!.droppedItems).toBe(1);
    expect(parsed!.questions[0]).toMatchObject({ category: 'GENERAL', targetRef: null });
  });

  it('refuses health below the baseline or more than one level above', () => {
    expect(
      parseCoordinatorResponse(
        body({ health: 'HEALTHY' }),
        known,
        targets,
        'NEEDS_ATTENTION',
      ),
    ).toBeNull();
    expect(
      parseCoordinatorResponse(
        body({ health: 'BLOCKED' }),
        known,
        targets,
        'NEEDS_ATTENTION',
      ),
    ).toBeNull();
    expect(
      parseCoordinatorResponse(
        body({ health: 'AT_RISK' }),
        known,
        targets,
        'NEEDS_ATTENTION',
      ),
    ).not.toBeNull();
  });

  it('refuses missing fields and model metadata', () => {
    expect(
      parseCoordinatorResponse(body({ summary: '' }), known, targets, 'NEEDS_ATTENTION'),
    ).toBeNull();
    expect(
      parseCoordinatorResponse(
        body({ model_version: undefined }),
        known,
        targets,
        'NEEDS_ATTENTION',
      ),
    ).toBeNull();
    expect(
      parseCoordinatorResponse('nonsense', known, targets, 'NEEDS_ATTENTION'),
    ).toBeNull();
  });
});

describe('parseExtractResponse', () => {
  it('bounds lists and requires model metadata', () => {
    const parsed = parseExtractResponse({
      summary: 'Done.',
      completed: ['a', '', 'b', ...Array(20).fill('x')],
      current: 'not a list',
      blockers: [],
      next_steps: [],
      provider: 'fake',
      model_name: 'm',
      model_version: '1',
      prompt_version: 'p',
    });
    expect(parsed!.completed).toHaveLength(8);
    expect(parsed!.current).toEqual([]);
    expect(parseExtractResponse({ summary: 'x' })).toBeNull();
  });
});
