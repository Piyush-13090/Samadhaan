import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../config/app.config.js';
import { MetricsController } from './metrics.controller.js';
import { MetricsService } from './metrics.service.js';

describe('MetricsService (Prompt 30)', () => {
  it('renders counters and histograms in the Prometheus text format', () => {
    const m = new MetricsService();
    m.httpRequests.inc({
      method: 'GET',
      route: '/api/v1/problems/:publicId',
      status: '2xx',
    });
    m.httpRequests.inc({
      method: 'GET',
      route: '/api/v1/problems/:publicId',
      status: '2xx',
    });
    m.httpDuration.observe({ method: 'GET', route: '/api/v1/health' }, 0.03);
    m.aiCircuit.set({ group: 'search' }, 2);
    const text = m.render();
    expect(text).toContain('# TYPE samadhaan_http_requests_total counter');
    expect(text).toContain(
      'samadhaan_http_requests_total{method="GET",route="/api/v1/problems/:publicId",status="2xx"} 2',
    );
    // 0.03 s falls in the 0.05 bucket and above, not in 0.025.
    expect(text).toContain(
      'samadhaan_http_request_duration_seconds_bucket{method="GET",route="/api/v1/health",le="0.025"} 0',
    );
    expect(text).toContain(
      'samadhaan_http_request_duration_seconds_bucket{method="GET",route="/api/v1/health",le="0.05"} 1',
    );
    expect(text).toContain('samadhaan_ai_circuit_state{group="search"} 2');
    expect(text).toMatch(/samadhaan_process_uptime_seconds \d+/);
  });

  it('escapes label values', () => {
    const m = new MetricsService();
    m.storageErrors.inc({ operation: 'get"\n' });
    expect(m.render()).toContain(
      'samadhaan_storage_errors_total{operation="get\\"\\n"} 1',
    );
  });
});

describe('MetricsController', () => {
  function call(token: string | undefined, header?: string) {
    const res = {
      statusCode: 0,
      body: undefined as unknown,
      status: vi.fn(function (this: { statusCode: number }, code: number) {
        this.statusCode = code;
        return this;
      }),
      json: vi.fn(function (this: { body: unknown }, b: unknown) {
        this.body = b;
        return this;
      }),
      type: vi.fn(function (this: unknown) {
        return this;
      }),
      send: vi.fn(function (this: { body: unknown }, b: unknown) {
        this.body = b;
        return this;
      }),
    };
    const controller = new MetricsController(new MetricsService(), {
      metricsToken: token,
    } as AppConfig);
    controller.scrape(
      { headers: header ? { authorization: header } : {} } as Request,
      res as unknown as Response,
    );
    return res;
  }
  const TOKEN = 'm'.repeat(40);

  it('does not exist unless a token is configured', () => {
    expect(call(undefined, `Bearer ${TOKEN}`).statusCode).toBe(404);
  });

  it('requires the exact bearer token', () => {
    expect(call(TOKEN).statusCode).toBe(401);
    expect(call(TOKEN, `Bearer ${'x'.repeat(40)}`).statusCode).toBe(401);
    expect(call(TOKEN, TOKEN).statusCode).toBe(401); // missing "Bearer "
    const ok = call(TOKEN, `Bearer ${TOKEN}`);
    expect(ok.statusCode).toBe(200);
    expect(String(ok.body)).toContain('# TYPE samadhaan_http_requests_total counter');
  });
});
