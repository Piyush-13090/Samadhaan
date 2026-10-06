import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { ResolutionStreamEvent } from '@samadhaan/shared';
import { RedisService } from '../redis/redis.service.js';

type Listener = (event: ResolutionStreamEvent) => void;

const CHANNEL = 'samadhaan:resolution-rooms';

/**
 * Fan-out of room events to connected participants.
 *
 *     service ──publish──▶ Redis pub/sub ──▶ every API instance ──▶ its open streams
 *
 * Redis carries events between instances, so a participant connected to one
 * instance sees a message posted through another. If Redis is unavailable the
 * event is delivered to this instance's listeners directly — degraded, not
 * broken — and clients that miss it catch up through their polling fallback.
 *
 * Only room ids and already-authorised payloads travel here. Who may receive
 * them was decided when the stream was opened, and is re-checked periodically
 * by the stream itself.
 */
@Injectable()
export class ResolutionRealtimeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ResolutionRealtimeService.name);
  private readonly listeners = new Map<string, Set<Listener>>();
  private subscriber: Redis | null = null;
  private subscribed = false;

  constructor(private readonly redis: RedisService) {}

  async onModuleInit(): Promise<void> {
    try {
      this.subscriber = this.redis.connection.duplicate({ lazyConnect: true });
      this.subscriber.on('error', (error: Error) =>
        this.logger.warn(`Realtime subscriber error: ${error.message}`),
      );
      this.subscriber.on('message', (_channel: string, raw: string) => this.receive(raw));
      await this.subscriber.connect();
      await this.subscriber.subscribe(CHANNEL);
      this.subscribed = true;
    } catch (error) {
      this.logger.warn(
        `Realtime fan-out is local only: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.listeners.clear();
    await this.subscriber?.quit().catch(() => undefined);
  }

  /** Registers a listener for one room. Returns the unsubscribe function. */
  listen(roomId: string, listener: Listener): () => void {
    let set = this.listeners.get(roomId);
    if (!set) {
      set = new Set();
      this.listeners.set(roomId, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(roomId);
    };
  }

  /** Never throws: realtime is a convenience over the durable record. */
  publish(roomId: string, event: ResolutionStreamEvent): void {
    const raw = JSON.stringify({ roomId, event });
    if (!this.subscribed) {
      this.receive(raw);
      return;
    }
    this.redis.connection.publish(CHANNEL, raw).catch((error: unknown) => {
      this.logger.warn(
        `Realtime publish failed, delivering locally: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      this.receive(raw);
    });
  }

  private receive(raw: string): void {
    let parsed: { roomId: string; event: ResolutionStreamEvent };
    try {
      parsed = JSON.parse(raw) as typeof parsed;
    } catch {
      return;
    }
    for (const listener of this.listeners.get(parsed.roomId) ?? []) {
      try {
        listener(parsed.event);
      } catch (error) {
        this.logger.warn(
          `Realtime listener failed: ${error instanceof Error ? error.message : 'unknown'}`,
        );
      }
    }
  }
}
