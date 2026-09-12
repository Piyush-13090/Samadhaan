import { describe, expect, it, vi } from 'vitest';
import { err, ok } from '@samadhaan/shared';
import type { AiClient } from './ai.client.js';
import { AiService } from './ai.service.js';

describe('AiService', () => {
  it('returns the AI service health report when reachable', async () => {
    const client = {
      get: vi.fn(async () => ok({ status: 'ok' })),
    } as unknown as AiClient;

    await expect(new AiService(client).getHealth()).resolves.toEqual({
      status: 'ok',
    });
  });

  it('returns null when the AI service is unreachable, rather than throwing', async () => {
    const client = {
      get: vi.fn(async () => err(new Error('down'))),
    } as unknown as AiClient;

    await expect(new AiService(client).getHealth()).resolves.toBeNull();
  });

  it('forwards the request id to the client', async () => {
    const get = vi.fn(async () => ok({ status: 'ok' }));
    const client = { get } as unknown as AiClient;

    await new AiService(client).getHealth('req-9');

    expect(get).toHaveBeenCalledWith('/health', { requestId: 'req-9' });
  });
});
