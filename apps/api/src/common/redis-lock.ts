import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';

/**
 * A single-holder lock for background sweeps (Prompt 29).
 *
 * Replaces `SET key '1' NX` + `DEL key`, which had two flaws: any instance's
 * `DEL` released the lock, including after the TTL expired and another
 * instance had taken it, so a slow run could free a lock it no longer held;
 * and the lock carried no owner. Here each acquisition gets a random token and
 * release is compare-and-delete in one Lua call.
 *
 * `onRedisError` decides what happens when Redis is unreachable:
 *  - `'run'`  — run anyway. For idempotent sweeps (priority, impact ledger):
 *    duplicate work is harmless and stopping them during an outage is worse.
 *  - `'skip'` — do not run. For sweeps whose duplicates cost money (the
 *    coordinator's LLM analyses).
 */
const RELEASE = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;

export type LockOutcome<T> =
  { ran: true; value: T } | { ran: false; reason: 'held' | 'redis-error' };

export async function withRedisLock<T>(
  redis: Pick<Redis, 'set' | 'eval'>,
  key: string,
  ttlSeconds: number,
  onRedisError: 'run' | 'skip',
  task: () => Promise<T>,
): Promise<LockOutcome<T>> {
  const token = randomUUID();
  let acquired: boolean;
  try {
    acquired = (await redis.set(key, token, 'EX', ttlSeconds, 'NX')) === 'OK';
  } catch {
    if (onRedisError === 'skip') return { ran: false, reason: 'redis-error' };
    return { ran: true, value: await task() };
  }
  if (!acquired) return { ran: false, reason: 'held' };
  try {
    return { ran: true, value: await task() };
  } finally {
    await redis.eval(RELEASE, 1, key, token).catch(() => undefined);
  }
}
