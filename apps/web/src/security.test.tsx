import type { ProblemSearchResult } from '@samadhaan/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SearchResultCard } from '@/components/search/search-result-card';
import { renderWithProviders, screen } from '@/test/render';

/**
 * Web security regressions (Prompt 26): the production header set, and that
 * user-controlled text is rendered as text, never markup.
 */

describe('production security headers', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function headersFor(env: 'production' | 'development') {
    vi.stubEnv('NODE_ENV', env);
    vi.resetModules();
    const config = (await import('../next.config')).default;
    const rules = await config.headers!();
    return Object.fromEntries(rules[0]!.headers.map((h) => [h.key, h.value]));
  }

  it('sends a CSP, frame protection, nosniff and HSTS in production', async () => {
    const h = await headersFor('production');
    expect(h['Content-Security-Policy']).toContain("frame-ancestors 'none'");
    expect(h['Content-Security-Policy']).toContain("object-src 'none'");
    expect(h['Content-Security-Policy']).not.toContain('unsafe-eval');
    expect(h['X-Frame-Options']).toBe('DENY');
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['Strict-Transport-Security']).toContain('max-age=31536000');
  });

  it('does not pin HSTS on development hosts', async () => {
    const h = await headersFor('development');
    expect(h['Strict-Transport-Security']).toBeUndefined();
  });

  it('hides the framework', async () => {
    vi.resetModules();
    const config = (await import('../next.config')).default;
    expect(config.poweredByHeader).toBe(false);
  });
});

describe('stored XSS', () => {
  it('renders hostile titles and snippets as plain text', () => {
    const payload = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    const result: ProblemSearchResult = {
      type: 'PROBLEM',
      id: 'SAM-1',
      title: payload,
      subtitle: payload,
      href: '/problems/SAM-1',
      score: 0.5,
      highlights: [
        { field: 'title', segments: [{ text: payload, match: false }] },
        { field: 'description', segments: [{ text: payload, match: true }] },
      ],
      explanation: [payload],
      metadata: {
        category: 'DRAINAGE',
        subcategory: null,
        status: 'SUBMITTED',
        severity: 'LOW',
        urgency: 'LOW',
        priority: null,
        city: null,
        state: null,
        voteCount: 0,
        createdAt: '2026-10-08T00:00:00.000Z',
        distanceKm: null,
      },
    };
    renderWithProviders(<SearchResultCard result={result} />);
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('script')).toBeNull();
    expect(screen.getByRole('link')).toHaveTextContent(payload);
  });
});
