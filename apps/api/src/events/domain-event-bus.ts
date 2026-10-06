import { Global, Injectable, Logger, Module } from '@nestjs/common';
import type { DomainEvent } from './domain-events.js';

export type DomainEventHandler = (event: DomainEvent) => Promise<void> | void;

/**
 * An in-process event bus.
 *
 * Deliberately small. Samadhaan is a modular monolith with one API process;
 * there is no second consumer that needs a broker, and Kafka or a queue here
 * would be infrastructure without a problem to solve. The contract is what
 * matters, and it is the one a durable transport would keep:
 *
 *  - **`publish` never throws and never waits.** Handlers run after the
 *    current call stack — the citizen's HTTP response does not wait for a
 *    notification to be written, and a handler that fails cannot fail the
 *    civic action that caused it.
 *  - **Handlers are isolated.** One failing handler is logged and the others
 *    still run.
 *  - **Handlers must be idempotent.** At-most-once today (an event in flight
 *    during a crash is lost); an outbox or queue later would make it
 *    at-least-once, and an idempotent handler is correct under both.
 *
 * When delivery must survive a restart, `publish` writes to an outbox table in
 * the caller's transaction and a worker dispatches from it. No publisher or
 * handler changes.
 */
@Injectable()
export class DomainEventBus {
  private readonly logger = new Logger(DomainEventBus.name);
  private readonly handlers = new Set<DomainEventHandler>();
  private readonly inFlight = new Set<Promise<void>>();

  /** Registers a handler. Returns a function that removes it. */
  subscribe(handler: DomainEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  publish(event: DomainEvent): void {
    for (const handler of this.handlers) {
      const run = new Promise<void>((resolve) => setImmediate(resolve))
        .then(() => handler(event))
        .catch((error: unknown) => {
          this.logger.error(
            `Handler failed for ${event.type}: ${
              error instanceof Error ? error.message : 'unknown error'
            }`,
          );
        })
        .finally(() => this.inFlight.delete(run));

      this.inFlight.add(run);
    }
  }

  /**
   * Resolves once every handler started so far has finished, including any
   * events those handlers published in turn.
   *
   * For tests and graceful shutdown — production code never waits on side
   * effects.
   */
  async drain(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.all(this.inFlight);
    }
  }
}

/**
 * Global, so any module can publish without importing the consumers — the
 * point of an event is that its source does not know who listens.
 */
@Global()
@Module({
  providers: [DomainEventBus],
  exports: [DomainEventBus],
})
export class EventsModule {}
