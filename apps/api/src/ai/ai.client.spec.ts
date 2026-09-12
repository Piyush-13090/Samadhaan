import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../config/app.config.js';
import { AiClient } from './ai.client.js';

function createClient(overrides: Partial<AppConfig> = {}): AiClient {
  return new AiClient({
    aiServiceUrl: 'http://ai.test:8000',
    aiServiceTimeoutMs: 50,
    aiServiceToken: undefined,
    ...overrides,
  } as AppConfig);
}

describe('AiClient', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the parsed body on success', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok' }),
    });

    const result = await createClient().get<{ status: string }>('/health');

    expect(result.ok).toBe(true);
    expect(result.ok && result.value.status).toBe('ok');
  });

  it('joins the path onto the base URL, with or without a leading slash', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });

    await createClient().get('health');

    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://ai.test:8000/health');
  });

  it('propagates the request id so one trace spans web -> api -> ai', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });

    await createClient().get('/health', { requestId: 'req-123' });

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers['x-request-id']).toBe('req-123');
  });

  it('sends the internal token when one is configured', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });

    await createClient({ aiServiceToken: 'shared-secret' }).get('/health');

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers['x-internal-token']).toBe('shared-secret');
  });

  it('omits the token header entirely when none is configured', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });

    await createClient().get('/health');

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers).not.toHaveProperty('x-internal-token');
  });

  it('serialises the body and sets content-type on POST', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });

    await createClient().post('/analyze', { text: 'pothole' });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"text":"pothole"}');
    expect((init.headers as Record<string, string>)['content-type']).toBe(
      'application/json',
    );
  });

  it('returns an error result — never throws — on a non-2xx response', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'boom',
    });

    const result = await createClient().get('/health');

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.message).toContain('500');
  });

  it('returns an error result when the AI service is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await createClient().get('/health');

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.message).toContain('ECONNREFUSED');
  });

  it('reports a timeout distinctly, so a slow model is not read as a crash', async () => {
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    });

    const result = await createClient().get('/health');

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.message).toMatch(/timed out after 50ms/);
  });
});
