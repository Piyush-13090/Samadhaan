import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { envSchema, productionIssues } from '../../config/env.schema.js';
import { cleanFileName } from '../file-name.js';
import { serializeRequest } from '../logger/logger.config.js';
import { resolveRequestId } from '../request-context.js';
import { csrfOriginCheck, securityHeaders } from './http-security.js';

const ALLOWED = ['https://app.samadhaan.in'];

function run(
  middleware: ReturnType<typeof csrfOriginCheck>,
  method: string,
  headers: Record<string, string>,
): { passed: boolean; status: number | null } {
  let passed = false;
  let status: number | null = null;
  const res = {
    status: vi.fn((code: number) => {
      status = code;
      return res;
    }),
    json: vi.fn(() => res),
  } as unknown as Response;
  middleware({ method, headers } as unknown as Request, res, () => {
    passed = true;
  });
  return { passed, status };
}

describe('CSRF origin check', () => {
  const check = csrfOriginCheck(ALLOWED);

  it('lets safe methods through', () => {
    expect(run(check, 'GET', { origin: 'https://evil.example' }).passed).toBe(true);
  });

  it('accepts state changes from an allowed origin', () => {
    expect(run(check, 'POST', { origin: 'https://app.samadhaan.in' }).passed).toBe(true);
    expect(
      run(check, 'DELETE', { referer: 'https://app.samadhaan.in/problems/SAM-1' }).passed,
    ).toBe(true);
  });

  it('refuses other origins, null origins and cross-site fetches', () => {
    const cases: Array<Record<string, string>> = [
      { origin: 'https://evil.example' },
      { origin: 'null' },
      { origin: 'https://app.samadhaan.in.evil.example' },
      { 'sec-fetch-site': 'cross-site' },
      { referer: 'https://evil.example/page' },
      { origin: 'http://app.samadhaan.in' }, // scheme matters
    ];
    for (const headers of cases) {
      expect(run(check, 'POST', headers)).toEqual({ passed: false, status: 403 });
    }
  });

  it('lets non-browser clients without Origin or Referer through', () => {
    expect(run(check, 'PATCH', {}).passed).toBe(true);
  });
});

describe('security headers', () => {
  const headersFor = (production: boolean) => {
    const set = new Map<string, string>();
    const res = {
      setHeader: (k: string, v: string) => set.set(k, v),
    } as unknown as Response;
    securityHeaders({ production })({} as Request, res, () => undefined);
    return set;
  };

  it('sets the API headers', () => {
    const h = headersFor(false);
    expect(h.get('X-Content-Type-Options')).toBe('nosniff');
    expect(h.get('X-Frame-Options')).toBe('DENY');
    expect(h.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    expect(h.get('Referrer-Policy')).toBe('no-referrer');
    expect(h.get('Cache-Control')).toBe('no-store');
    expect(h.has('Strict-Transport-Security')).toBe(false);
  });

  it('adds HSTS only in production', () => {
    expect(headersFor(true).get('Strict-Transport-Security')).toContain(
      'max-age=31536000',
    );
  });
});

describe('production configuration', () => {
  const base = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://u:p@db:5432/x',
    REDIS_URL: 'redis://:p@redis:6379',
    AI_SERVICE_URL: 'http://ai:8001',
    JWT_ACCESS_SECRET: 'Zq8vN2kR7tXw4pLmC9bJ5hGfD3sA6yE1uIoP0nKjHgFdSaQw',
    AI_SERVICE_TOKEN: 'a'.repeat(16) + 'b'.repeat(16) + 'c'.repeat(8),
    AUTH_COOKIE_SECURE: 'true',
    CORS_ORIGINS: 'https://app.samadhaan.in',
  };
  const issues = (overrides: Record<string, string> = {}) =>
    productionIssues(envSchema.parse({ ...base, ...overrides }));

  it('accepts a hardened configuration', () => {
    expect(issues()).toEqual([]);
  });

  it('refuses development conveniences', () => {
    expect(
      issues({
        JWT_ACCESS_SECRET: 'replace-me-with-openssl-rand-base64-48-at-least-32-chars',
      }),
    ).toEqual([expect.stringContaining('JWT_ACCESS_SECRET')]);
    expect(issues({ AUTH_COOKIE_SECURE: 'false' })).toEqual([
      expect.stringContaining('AUTH_COOKIE_SECURE'),
    ]);
    expect(issues({ AI_SERVICE_TOKEN: '' })).toEqual([
      expect.stringContaining('AI_SERVICE_TOKEN'),
    ]);
    expect(issues({ ALLOW_DEV_SEED: 'true' })).toEqual([
      expect.stringContaining('ALLOW_DEV_SEED'),
    ]);
    expect(issues({ CORS_ORIGINS: '*' })).toEqual([
      expect.stringContaining('CORS_ORIGINS'),
    ]);
    expect(issues({ CORS_ORIGINS: 'http://app.samadhaan.in' })).toHaveLength(1);
  });

  it('does not apply to development', () => {
    expect(
      productionIssues(
        envSchema.parse({
          ...base,
          NODE_ENV: 'development',
          AUTH_COOKIE_SECURE: 'false',
        }),
      ),
    ).toEqual([]);
  });
});

describe('request ids and file names', () => {
  it('reuses plain request ids and replaces anything else', () => {
    const req = (id?: string) =>
      ({ headers: id === undefined ? {} : { 'x-request-id': id } }) as never;
    expect(resolveRequestId(req('req-123'))).toBe('req-123');
    expect(resolveRequestId(req('evil\nINFO forged line'))).toMatch(/^[0-9a-f-]{36}$/);
    expect(resolveRequestId(req('x'.repeat(65)))).toMatch(/^[0-9a-f-]{36}$/);
    expect(resolveRequestId(req())).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('strips paths, controls and bidirectional overrides from file names', () => {
    expect(cleanFileName('../../etc/passwd', 'x')).toBe('passwd');
    expect(cleanFileName('report‮fdp.png', 'x')).toBe('reportfdp.png');
    expect(cleanFileName('a\u0000b⁦c.pdf', 'x')).toBe('abc.pdf');
    expect(cleanFileName('...hidden', 'x')).toBe('hidden');
    expect(cleanFileName('<script>.jpg', 'x')).toBe('script.jpg');
    expect(cleanFileName('', 'fallback.jpg')).toBe('fallback.jpg');
  });
});

describe('request logging', () => {
  it('logs the path without the query string', () => {
    expect(
      serializeRequest({
        id: 'r1',
        method: 'GET',
        url: '/api/v1/search?q=my+address+42',
      }),
    ).toEqual({ id: 'r1', method: 'GET', url: '/api/v1/search' });
  });
});
