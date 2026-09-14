import { describe, expect, it } from 'vitest';
import { DISCOVERY_RANKING, MAX_DISCOVERY_RADIUS_METERS } from '@samadhaan/shared';
import { coarseArea } from './problem-discovery.service.js';

describe('coarseArea', () => {
  /**
   * A feed shows many people's reports. The full street address belongs on the
   * problem's own page; in a list it would turn discovery into a directory of
   * addresses.
   */
  it('takes the first address segment', () => {
    expect(coarseArea('Sector 12 Market Road, near Bus Stop 4', 'Gurugram')).toBe(
      'Sector 12 Market Road',
    );
  });

  it('trims surrounding whitespace', () => {
    expect(coarseArea('  Link Road  , outside the clinic', 'Gurugram')).toBe('Link Road');
  });

  it('falls back to the city when there is no address', () => {
    expect(coarseArea(null, 'Gurugram')).toBe('Gurugram');
    expect(coarseArea('', 'Gurugram')).toBe('Gurugram');
    expect(coarseArea('   ', 'Gurugram')).toBe('Gurugram');
  });

  it('returns null when neither is known', () => {
    expect(coarseArea(null, null)).toBeNull();
  });

  it('never returns the full address', () => {
    const full = 'House 42, Sector 12 Market Road, near Bus Stop 4, Gurugram';
    const area = coarseArea(full, 'Gurugram');

    expect(area).not.toBe(full);
    expect(area).not.toContain('near Bus Stop 4');
  });
});

/**
 * The ranking weights are a published contract: the API applies them and the
 * documentation explains them. These assertions are what stops the two
 * drifting apart silently.
 */
describe('DISCOVERY_RANKING', () => {
  it('sums to one, so a score is comparable across queries', () => {
    const total =
      DISCOVERY_RANKING.proximity +
      DISCOVERY_RANKING.severity +
      DISCOVERY_RANKING.recency +
      DISCOVERY_RANKING.support;

    expect(total).toBeCloseTo(1, 10);
  });

  // Distance is the strongest signal: this is *nearby* discovery.
  it('weights proximity above every other signal', () => {
    expect(DISCOVERY_RANKING.proximity).toBeGreaterThan(DISCOVERY_RANKING.severity);
    expect(DISCOVERY_RANKING.proximity).toBeGreaterThan(DISCOVERY_RANKING.recency);
    expect(DISCOVERY_RANKING.proximity).toBeGreaterThan(DISCOVERY_RANKING.support);
  });

  /**
   * Support is the weakest, deliberately: it is the only signal a group of
   * people can drive up, and a feed one popular report dominates stops being
   * discovery.
   */
  it('weights community support least', () => {
    const others = [
      DISCOVERY_RANKING.proximity,
      DISCOVERY_RANKING.severity,
      DISCOVERY_RANKING.recency,
    ];

    expect(Math.min(...others)).toBeGreaterThan(DISCOVERY_RANKING.support);
  });

  it('keeps the decay and saturation parameters sane', () => {
    expect(DISCOVERY_RANKING.recencyHalfLifeDays).toBeGreaterThan(0);
    expect(DISCOVERY_RANKING.supportSaturation).toBeGreaterThan(0);
  });
});

describe('MAX_DISCOVERY_RADIUS_METERS', () => {
  // Without an upper bound a caller turns an indexed lookup into a full scan.
  it('is bounded to something a city-scale search could mean', () => {
    expect(MAX_DISCOVERY_RADIUS_METERS).toBeGreaterThan(10_000);
    expect(MAX_DISCOVERY_RADIUS_METERS).toBeLessThanOrEqual(100_000);
  });
});
