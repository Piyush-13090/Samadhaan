import { describe, expect, it } from 'vitest';
import { questionFingerprint } from './coordinator.service.js';

describe('questionFingerprint', () => {
  it('is the category and target when there is one', () => {
    expect(questionFingerprint('TASK_PROGRESS', 'task:a', 'Was it done?')).toBe(
      'TASK_PROGRESS|task:a',
    );
    // Rephrasing the same question about the same task does not make it new.
    expect(questionFingerprint('TASK_PROGRESS', 'task:a', 'Has it been completed?')).toBe(
      'TASK_PROGRESS|task:a',
    );
  });

  it('normalises text when there is no target', () => {
    const a = questionFingerprint(
      'MISSING_UPDATE',
      null,
      'What progress has been made since the last update?',
    );
    const b = questionFingerprint(
      'MISSING_UPDATE',
      null,
      'what progress has been made since the LAST update',
    );
    expect(a).toBe(b);
    expect(a).not.toBe(
      questionFingerprint('MISSING_UPDATE', null, 'Is the permit available?'),
    );
  });
});
