import { describe, expect, it, vi } from 'vitest';
import { withRedisLock } from './redis-lock.js';

/** In-memory SET NX / compare-and-delete, enough to exercise the helper. */
function fakeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    set: vi.fn(async (key: string, value: string) => {
      if (store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    }),
    eval: vi.fn(async (_script: string, _n: number, key: string, token: string) => {
      if (store.get(key) !== token) return 0;
      store.delete(key);
      return 1;
    }),
  };
}

describe('withRedisLock (Prompt 29)', () => {
  it('runs the task once while held and releases afterwards', async () => {
    const redis = fakeRedis();
    let inner: unknown;
    const outer = await withRedisLock(redis as never, 'k', 60, 'run', async () => {
      inner = await withRedisLock(redis as never, 'k', 60, 'run', async () => 'second');
      return 'first';
    });
    expect(outer).toEqual({ ran: true, value: 'first' });
    expect(inner).toEqual({ ran: false, reason: 'held' });
    expect(redis.store.has('k')).toBe(false);
  });

  it('never releases a lock another holder took after expiry', async () => {
    const redis = fakeRedis();
    await withRedisLock(redis as never, 'k', 60, 'run', async () => {
      // Our TTL "expired" and another instance took the lock.
      redis.store.set('k', 'someone-else');
    });
    expect(redis.store.get('k')).toBe('someone-else');
  });

  it('releases even when the task throws', async () => {
    const redis = fakeRedis();
    await expect(
      withRedisLock(redis as never, 'k', 60, 'run', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(redis.store.has('k')).toBe(false);
  });

  it('on a Redis error, runs idempotent sweeps and skips costly ones', async () => {
    const broken = {
      set: vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
      eval: vi.fn(),
    };
    const task = vi.fn(async () => 1);
    expect(await withRedisLock(broken as never, 'k', 60, 'run', task)).toEqual({
      ran: true,
      value: 1,
    });
    expect(await withRedisLock(broken as never, 'k', 60, 'skip', task)).toEqual({
      ran: false,
      reason: 'redis-error',
    });
    expect(task).toHaveBeenCalledTimes(1);
  });
});
