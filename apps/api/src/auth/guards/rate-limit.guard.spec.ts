import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../../config/app.config.js';
import type { RedisService } from '../../redis/redis.service.js';
import { RateLimitGuard } from './rate-limit.guard.js';

function context(): ExecutionContext {
  const headers = new Map<string, unknown>();
  const request = {
    method: 'POST',
    path: '/api/v1/auth/login',
    ip: '10.0.0.1',
    body: { email: 'a@b.test' },
  };
  const response = { setHeader: (k: string, v: unknown) => headers.set(k, v) };
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as unknown as ExecutionContext;
}

describe('RateLimitGuard (Prompt 30)', () => {
  const reflector = {
    getAllAndOverride: () => ({ max: 2, windowSeconds: 60, keyField: 'email' }),
  };
  const config = {
    authRateLimitMax: 2,
    authRateLimitWindowSeconds: 60,
  } as unknown as AppConfig;

  it('keeps limiting from memory when Redis is down instead of failing open', async () => {
    const down = {
      connection: {
        multi: () => {
          throw new Error('ECONNREFUSED');
        },
      },
    } as unknown as RedisService;
    const guard = new RateLimitGuard(reflector as unknown as Reflector, down, config);
    expect(await guard.canActivate(context())).toBe(true);
    expect(await guard.canActivate(context())).toBe(true);
    await expect(guard.canActivate(context())).rejects.toMatchObject({ status: 429 });
  });

  it('counts with one atomic MULTI (INCR, EXPIRE NX, TTL)', async () => {
    const calls: string[] = [];
    const chain = {
      incr: () => (calls.push('incr'), chain),
      expire: (_k: string, _s: number, mode: string) => (
        calls.push(`expire ${mode}`),
        chain
      ),
      ttl: () => (calls.push('ttl'), chain),
      exec: async () => [
        [null, 1],
        [null, 1],
        [null, 60],
      ],
    };
    const redis = { connection: { multi: () => chain } } as unknown as RedisService;
    const guard = new RateLimitGuard(reflector as unknown as Reflector, redis, config);
    expect(await guard.canActivate(context())).toBe(true);
    expect(calls).toEqual(['incr', 'expire NX', 'ttl']);
  });
});
