import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const post = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({
  api: { post },
  createServerApi: vi.fn(),
}));

import { REFRESH_LOCK, refreshSession } from './auth.service';

const SESSION = { user: { id: 'u1' }, expiresIn: 900 };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A minimal LockManager: one holder at a time, FIFO, honouring `signal`. */
function fakeLocks() {
  let tail: Promise<unknown> = Promise.resolve();
  const names: string[] = [];
  const request = vi.fn(
    (
      name: string,
      options: { signal?: AbortSignal },
      callback: () => Promise<unknown>,
    ) => {
      names.push(name);
      const run = tail.then(() => {
        if (options.signal?.aborted) throw options.signal.reason;
        return callback();
      });
      tail = run.catch(() => undefined);
      return run;
    },
  );
  return { request, names };
}

describe('refreshSession', () => {
  const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');

  beforeEach(() => post.mockReset());
  afterEach(() => {
    if (originalLocks) Object.defineProperty(navigator, 'locks', originalLocks);
    else Reflect.deleteProperty(navigator, 'locks');
  });

  const useLocks = (locks: unknown) =>
    Object.defineProperty(navigator, 'locks', { value: locks, configurable: true });

  it('shares one request between concurrent callers in a tab', async () => {
    useLocks(undefined);
    const response = deferred<typeof SESSION>();
    post.mockReturnValueOnce(response.promise);

    // React's development double mount calls this twice at once.
    const first = refreshSession();
    const second = refreshSession();
    response.resolve(SESSION);

    await expect(first).resolves.toBe(SESSION);
    await expect(second).resolves.toBe(SESSION);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/auth/refresh');
  });

  it('starts a new request once the previous one settled', async () => {
    useLocks(undefined);
    post.mockResolvedValue(SESSION);
    await refreshSession();
    await refreshSession();
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('holds the cross-tab lock while the request runs', async () => {
    const locks = fakeLocks();
    useLocks(locks);
    const response = deferred<typeof SESSION>();
    post.mockReturnValueOnce(response.promise);

    const pending = refreshSession();
    await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(locks.names).toEqual([REFRESH_LOCK]);

    // Another tab asking now waits until this response (and its cookie) lands.
    let otherTabRan = false;
    const otherTab = locks.request(REFRESH_LOCK, {}, async () => {
      otherTabRan = true;
    });
    await Promise.resolve();
    expect(otherTabRan).toBe(false);

    response.resolve(SESSION);
    await pending;
    await otherTab;
    expect(otherTabRan).toBe(true);
  });

  it('goes ahead alone when the lock is not granted in time', async () => {
    const timeout = new DOMException('timed out', 'TimeoutError');
    useLocks({ request: vi.fn().mockRejectedValue(timeout) });
    post.mockResolvedValueOnce(SESSION);

    await expect(refreshSession()).resolves.toBe(SESSION);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('never repeats a request that was sent, even if it was aborted', async () => {
    useLocks(fakeLocks());
    post.mockRejectedValueOnce(new DOMException('aborted', 'AbortError'));

    await expect(refreshSession()).rejects.toThrow('aborted');
    expect(post).toHaveBeenCalledTimes(1);
  });
});
