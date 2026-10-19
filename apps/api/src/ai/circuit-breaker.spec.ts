import { describe, expect, it } from 'vitest';
import { circuitKey } from './ai.client.js';
import { CircuitBreaker, type CircuitTransition } from './circuit-breaker.js';

function build(failureThreshold = 3, resetMs = 1000) {
  let now = 0;
  const transitions: CircuitTransition[] = [];
  const breaker = new CircuitBreaker(
    { failureThreshold, resetMs },
    () => now,
    (t) => transitions.push(t),
  );
  return { breaker, transitions, advance: (ms: number) => (now += ms) };
}

describe('CircuitBreaker (Prompt 29)', () => {
  it('opens after consecutive failures and fails fast while open', () => {
    const { breaker } = build();
    breaker.failure('search');
    breaker.failure('search');
    expect(breaker.allow('search')).toBe(true);
    breaker.failure('search');
    expect(breaker.state('search')).toBe('open');
    expect(breaker.allow('search')).toBe(false);
    // Other endpoint groups are unaffected.
    expect(breaker.allow('embeddings')).toBe(true);
  });

  it('a success resets the failure count', () => {
    const { breaker } = build();
    breaker.failure('search');
    breaker.failure('search');
    breaker.success('search');
    breaker.failure('search');
    breaker.failure('search');
    expect(breaker.state('search')).toBe('closed');
  });

  it('lets exactly one trial through after the reset period', () => {
    const { breaker, advance, transitions } = build();
    for (let i = 0; i < 3; i++) breaker.failure('analysis');
    advance(999);
    expect(breaker.allow('analysis')).toBe(false);
    advance(1);
    expect(breaker.allow('analysis')).toBe(true); // the trial
    expect(breaker.allow('analysis')).toBe(false); // nobody else meanwhile
    breaker.success('analysis');
    expect(breaker.state('analysis')).toBe('closed');
    expect(transitions.map((t) => t.to)).toEqual(['open', 'half-open', 'closed']);
  });

  it('a failed trial re-opens the circuit for another full period', () => {
    const { breaker, advance } = build();
    for (let i = 0; i < 3; i++) breaker.failure('knowledge');
    advance(1000);
    expect(breaker.allow('knowledge')).toBe(true);
    breaker.failure('knowledge');
    expect(breaker.state('knowledge')).toBe('open');
    advance(500);
    expect(breaker.allow('knowledge')).toBe(false);
  });

  it('is disabled by a zero threshold', () => {
    const { breaker } = build(0);
    for (let i = 0; i < 50; i++) breaker.failure('search');
    expect(breaker.allow('search')).toBe(true);
  });

  it('groups calls by their first path segment', () => {
    expect(circuitKey('/search/understand')).toBe('search');
    expect(circuitKey('embeddings/text')).toBe('embeddings');
    expect(circuitKey('/')).toBe('root');
  });
});
