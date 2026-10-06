import { describe, expect, it, vi } from 'vitest';
import { DomainEventBus } from './domain-event-bus.js';
import type { DomainEvent } from './domain-events.js';

const event: DomainEvent = {
  type: 'PROBLEM_FOLLOWED',
  problemId: 'p1',
  problemPublicId: 'SAM-1',
  actorUserId: 'u1',
};

describe('DomainEventBus', () => {
  it('delivers after the publisher returns, not during', async () => {
    const bus = new DomainEventBus();
    const handler = vi.fn();
    bus.subscribe(handler);

    bus.publish(event);
    expect(handler).not.toHaveBeenCalled();

    await bus.drain();
    expect(handler).toHaveBeenCalledWith(event);
  });

  it('never throws to the publisher, and isolates a failing handler', async () => {
    const bus = new DomainEventBus();
    const healthy = vi.fn();
    bus.subscribe(() => {
      throw new Error('boom');
    });
    bus.subscribe(async () => {
      throw new Error('async boom');
    });
    bus.subscribe(healthy);

    expect(() => bus.publish(event)).not.toThrow();
    await bus.drain();

    expect(healthy).toHaveBeenCalledTimes(1);
  });

  it('stops delivering once unsubscribed', async () => {
    const bus = new DomainEventBus();
    const handler = vi.fn();
    const unsubscribe = bus.subscribe(handler);
    unsubscribe();

    bus.publish(event);
    await bus.drain();
    expect(handler).not.toHaveBeenCalled();
  });
});
