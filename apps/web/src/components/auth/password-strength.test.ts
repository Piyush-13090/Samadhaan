import { describe, expect, it } from 'vitest';
import { evaluatePassword } from './password-strength';

/**
 * The client-side meter must agree with the server's `PasswordService`, or a
 * user sees "Strong" and is then rejected on submit.
 */
describe('evaluatePassword', () => {
  it('accepts a long, varied password', () => {
    const result = evaluatePassword('Monsoon-Drain-2026');

    expect(result.valid).toBe(true);
    expect(result.score).toBe(4);
  });

  it('rejects a password below the minimum length', () => {
    const result = evaluatePassword('Short1!');

    expect(result.valid).toBe(false);
    expect(result.rules.find((rule) => rule.id === 'length')?.satisfied).toBe(false);
  });

  it('requires more than letters alone', () => {
    const result = evaluatePassword('abcdefghijklm');

    expect(result.rules.find((rule) => rule.id === 'variety')?.satisfied).toBe(false);
  });

  it('rejects a password containing the email local part', () => {
    const result = evaluatePassword('priyasharma2026', {
      email: 'priyasharma@example.com',
    });

    expect(result.valid).toBe(false);
    expect(result.rules.find((rule) => rule.id === 'personal')?.satisfied).toBe(false);
  });

  it('rejects a password containing the user’s name', () => {
    const result = evaluatePassword('sharma-is-great-1', { fullName: 'Priya Sharma' });

    expect(result.rules.find((rule) => rule.id === 'personal')?.satisfied).toBe(false);
  });

  it('scores an empty password at zero', () => {
    expect(evaluatePassword('').score).toBe(0);
  });

  it('reserves the top score for genuinely long passwords', () => {
    // Satisfies every rule but is only 12 characters.
    expect(evaluatePassword('Abcdefgh123!').score).toBe(3);
    expect(evaluatePassword('Abcdefghijk123!').score).toBe(4);
  });
});
