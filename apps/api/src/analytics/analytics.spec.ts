import { describe, expect, it } from 'vitest';
import type {
  AnalyticsCategories,
  AnalyticsOverview,
  AnalyticsResolution,
  StageDuration,
} from '@samadhaan/shared';
import { parseInsight, toInsightRequest } from '../ai/dto/insights.dto.js';
import { AnalyticsCacheService } from './analytics-cache.service.js';
import { buildFacts, humanise } from './analytics-insights.service.js';
import {
  HOTSPOT_MIN_CELLS,
  bottleneck,
  cellAreaKm2,
  changePct,
  csvCell,
  direction,
  enoughDays,
  funnel,
  ratePct,
  scoreHotspots,
  suppress,
  toCsv,
  type CellAggregate,
} from './analytics-metrics.js';
import { filterSql } from './analytics-sql.js';
import {
  addDays,
  bucketLabel,
  bucketSql,
  bucketStart,
  bucketStarts,
  granularityFor,
  isTimeZone,
  localDate,
  resolvePeriod,
  zonedMidnight,
} from './analytics-time.js';
import { Prisma } from '../generated/prisma/client.js';

const NOW = new Date('2026-10-07T20:00:00.000Z'); // 01:30 on 8 Oct in Kolkata

describe('analytics time', () => {
  it('validates IANA zones', () => {
    expect(isTimeZone('Asia/Kolkata')).toBe(true);
    expect(isTimeZone('UTC')).toBe(true);
    expect(isTimeZone('Mars/Base')).toBe(false);
    expect(isTimeZone('')).toBe(false);
  });

  it('uses the local date, not the UTC one (the day-boundary regression)', () => {
    expect(NOW.toISOString().slice(0, 10)).toBe('2026-10-07');
    expect(localDate(NOW, 'Asia/Kolkata')).toBe('2026-10-08');
    expect(localDate(NOW, 'UTC')).toBe('2026-10-07');
  });

  it('converts local midnight to the right instant, across DST', () => {
    expect(zonedMidnight('2026-10-08', 'Asia/Kolkata').toISOString()).toBe(
      '2026-10-07T18:30:00.000Z',
    );
    expect(zonedMidnight('2026-10-08', 'UTC').toISOString()).toBe(
      '2026-10-08T00:00:00.000Z',
    );
    // New York: EDT (−4) in July, EST (−5) in December.
    expect(zonedMidnight('2026-07-01', 'America/New_York').toISOString()).toBe(
      '2026-07-01T04:00:00.000Z',
    );
    expect(zonedMidnight('2026-12-01', 'America/New_York').toISOString()).toBe(
      '2026-12-01T05:00:00.000Z',
    );
  });

  it('resolves presets to inclusive local dates with an equal previous period', () => {
    const r = resolvePeriod({ preset: '7d' }, 'Asia/Kolkata', NOW);
    expect(r.period).toMatchObject({
      preset: '7d',
      from: '2026-10-02',
      to: '2026-10-08',
      granularity: 'day',
      previous: { from: '2026-09-25', to: '2026-10-01' },
    });
    expect(r.days).toBe(7);
    expect(r.start.toISOString()).toBe('2026-10-01T18:30:00.000Z');
    expect(r.end.toISOString()).toBe('2026-10-08T18:30:00.000Z');
    expect(r.previousEnd).toEqual(r.start);
  });

  it('defaults to 30 days and picks a granularity by length', () => {
    expect(resolvePeriod({}, 'UTC', NOW).period.preset).toBe('30d');
    expect(granularityFor(31)).toBe('day');
    expect(granularityFor(90)).toBe('week');
    expect(granularityFor(182)).toBe('week');
    expect(granularityFor(365)).toBe('month');
  });

  it('validates custom ranges', () => {
    const custom = (from: string, to: string) =>
      resolvePeriod({ preset: 'custom', from, to }, 'UTC', NOW);
    expect(custom('2026-09-01', '2026-09-30').days).toBe(30);
    expect(() => custom('2026-09-30', '2026-09-01')).toThrow(/after/);
    expect(() => custom('2026-09-01', '2026-12-01')).toThrow(/future/);
    expect(() => custom('2026-02-30', '2026-03-01')).toThrow(/YYYY-MM-DD/);
    expect(() => custom('2020-01-01', '2026-01-01')).toThrow(/at most/);
    expect(() => resolvePeriod({ timezone: 'Nowhere/City' }, 'UTC', NOW)).toThrow(/IANA/);
    // from/to without a preset means custom.
    expect(
      resolvePeriod({ from: '2026-09-01', to: '2026-09-02' }, 'UTC', NOW).period.preset,
    ).toBe('custom');
  });

  it('lists every bucket, weeks from Monday and months from the 1st', () => {
    expect(bucketStart('2026-10-08', 'week')).toBe('2026-10-05'); // a Thursday → Monday
    expect(bucketStart('2026-10-05', 'week')).toBe('2026-10-05');
    expect(bucketStart('2026-10-08', 'month')).toBe('2026-10-01');
    const r = resolvePeriod({ preset: '1y' }, 'UTC', NOW);
    const months = bucketStarts(r.period);
    expect(months[0]).toBe('2025-10-01');
    expect(months.at(-1)).toBe('2026-10-01');
    expect(months).toHaveLength(13);
    expect(bucketStarts(resolvePeriod({ preset: '7d' }, 'UTC', NOW).period)).toHaveLength(
      7,
    );
    expect(bucketLabel('2026-10-05', 'week')).toBe('Week of 5 Oct');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('buckets by the true instant in the reporting zone, with bound parameters', () => {
    const sql = bucketSql(Prisma.sql`p."createdAt"`, 'day', 'Asia/Kolkata');
    expect(sql.sql).toContain("current_setting('TimeZone')");
    expect(sql.sql).not.toContain('Asia/Kolkata');
    expect(sql.values).toEqual(['day', 'Asia/Kolkata']);
  });
});

describe('metrics', () => {
  it('returns null instead of a number when there is no base', () => {
    expect(ratePct(3, 4)).toBe(75);
    expect(ratePct(0, 0)).toBeNull();
    expect(changePct(12, 10)).toBe(20);
    expect(changePct(12, 4)).toBeNull(); // previous below 5 → comparison unavailable
    expect(enoughDays(2.345, 3)).toBe(2.3);
    expect(enoughDays(2.3, 2)).toBeNull();
    expect(enoughDays(-1, 5)).toBe(0);
  });

  it('labels direction with a stable band', () => {
    expect(direction(null)).toBe('unknown');
    expect(direction(25)).toBe('increasing');
    expect(direction(-25)).toBe('decreasing');
    expect(direction(5)).toBe('stable');
  });

  it('computes funnel conversion from the previous stage', () => {
    const stages = funnel({
      submitted: 10,
      review: 8,
      verified: 6,
      allocated: 3,
      inProgress: 0,
      resolved: 0,
    });
    expect(stages.map((s) => s.conversionPct)).toEqual([null, 80, 75, 50, 0, null]);
  });

  it('names a bottleneck only from measured stages', () => {
    const stage = (key: StageDuration['key'], avgDays: number | null): StageDuration => ({
      key,
      label: key,
      avgDays,
      medianDays: null,
      observations: 3,
    });
    expect(bottleneck([stage('review', 1), stage('allocation', 6)])?.key).toBe(
      'allocation',
    );
    expect(bottleneck([stage('review', 1), stage('allocation', null)])).toBeNull();
  });

  it('suppresses small groups but keeps their names', () => {
    expect(
      suppress([
        { name: 'A', count: 5, open: 2, resolved: 1 },
        { name: 'B', count: 2, open: 2, resolved: 0 },
      ]),
    ).toEqual([
      { name: 'A', count: 5, open: 2, resolved: 1, suppressed: false },
      { name: 'B', count: null, open: null, resolved: null, suppressed: true },
    ]);
  });

  it('scores hotspots deterministically and needs a population of cells', () => {
    const cell = (i: number, weighted: number, count: number): CellAggregate => ({
      cellX: i,
      cellY: 0,
      latitude: 28.46,
      longitude: 77 + i * 0.005,
      label: null,
      count,
      open: count,
      weighted,
      topCategory: 'DRAINAGE',
    });
    const cells = [
      cell(0, 40, 12),
      ...Array.from({ length: 9 }, (_, i) => cell(i + 1, 2, 1)),
    ];
    const first = scoreHotspots(cells);
    const second = scoreHotspots(cells);
    expect(first).toEqual(second);
    expect(first.scored[0]).toMatchObject({ isHotspot: true, problemCount: 12 });
    expect(first.scored[0]!.zScore).toBeGreaterThanOrEqual(2);
    expect(first.scored[0]!.confidence).toBe(0.91);
    expect(first.scored.filter((c) => c.isHotspot)).toHaveLength(1);

    const few = scoreHotspots(cells.slice(0, HOTSPOT_MIN_CELLS - 1));
    expect(few.enoughCells).toBe(false);
    expect(few.scored.some((c) => c.isHotspot)).toBe(false);
    expect(cellAreaKm2(0)).toBeCloseTo(0.31, 2);
  });

  it('writes CSV that a spreadsheet will not evaluate', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('@cmd')).toBe(`"'@cmd"`);
    expect(csvCell(-12)).toBe('"-12"');
    expect(csvCell(null)).toBe('""');
    expect(toCsv([{ a: 1, b: 'x,y' }])).toBe('"a","b"\r\n"1","x,y"');
    expect(toCsv([])).toBe('');
  });
});

describe('filters and cache keys', () => {
  it('binds every filter value', () => {
    const sql = filterSql({
      category: 'DRAINAGE',
      severity: 'HIGH',
      status: 'VERIFIED',
      priority: 'CRITICAL',
      city: "Pune'; DROP TABLE problems; --",
      area: '411 001',
    });
    expect(sql.sql).not.toContain('DROP TABLE');
    expect(sql.values).toContain("Pune'; DROP TABLE problems; --");
    expect(sql.values).toContain('411 001');
  });

  it('separates offices, jurisdictions, periods and filters', () => {
    const a = AnalyticsCacheService.key([
      'gov',
      'o1',
      'j1',
      'overview',
      { from: '1' },
      {},
    ]);
    expect(
      AnalyticsCacheService.key(['gov', 'o2', 'j1', 'overview', { from: '1' }, {}]),
    ).not.toBe(a);
    expect(
      AnalyticsCacheService.key(['gov', 'o1', 'j2', 'overview', { from: '1' }, {}]),
    ).not.toBe(a);
    expect(
      AnalyticsCacheService.key(['gov', 'o1', 'j1', 'overview', { from: '2' }, {}]),
    ).not.toBe(a);
    const j1 = AnalyticsCacheService.jurisdictionKey(
      Prisma.sql`lower(p.city) = ANY(${['a']})`,
    );
    const j2 = AnalyticsCacheService.jurisdictionKey(
      Prisma.sql`lower(p.city) = ANY(${['b']})`,
    );
    expect(j1).not.toBe(j2);
  });
});

describe('insight facts and parsing', () => {
  const metric = (
    key: string,
    value: number | null,
    changePct: number | null = null,
  ) => ({
    key,
    value,
    previous: null,
    changePct,
  });
  const overview = {
    metrics: {
      reported: metric('reported', 42, 20),
      verified: metric('verified', 30),
      inProgress: metric('inProgress', 5),
      resolved: metric('resolved', 12),
      rejected: metric('rejected', 2),
      criticalHigh: metric('criticalHigh', 6),
      resolutionRate: metric('resolutionRate', 40),
      avgDaysToVerification: metric('avgDaysToVerification', null),
      medianDaysToVerification: metric('medianDaysToVerification', null),
      avgDaysToResolution: metric('avgDaysToResolution', 9.5),
      medianDaysToResolution: metric('medianDaysToResolution', 8),
      activeNow: metric('activeNow', 25),
    },
  } as unknown as AnalyticsOverview;
  const categories = {
    period: { granularity: 'week' },
    categories: [
      {
        category: 'DRAINAGE',
        count: 15,
        share: 35.7,
        previous: 10,
        changePct: 50,
        direction: 'increasing',
        persistent: true,
      },
    ],
  } as unknown as AnalyticsCategories;
  const resolution = {
    bottleneck: { key: 'allocation', label: 'Verified → allocated', avgDays: 6.2 },
    summary: { longestOpenDays: 45, returnedVerifications: 0 },
  } as unknown as AnalyticsResolution;

  it('formats only computed values and leaves unavailable ones out', () => {
    const facts = buildFacts(overview, categories, resolution);
    const keys = facts.map((f) => f.key);
    expect(keys).toContain('reported.change');
    expect(keys).not.toContain('medianDaysToVerification');
    expect(keys).not.toContain('returnedVerifications');
    expect(facts.find((f) => f.key === 'category.DRAINAGE.change')).toMatchObject({
      value: '+50%',
      signal: 'increase',
    });
    expect(facts.find((f) => f.key === 'bottleneck')?.signal).toBe('bottleneck');
    expect(facts.find((f) => f.key === 'longestOpen')?.signal).toBe('attention');
    expect(humanise('WATER_SUPPLY')).toBe('Water supply');
  });

  it('keeps only statements citing facts that were sent', () => {
    const body = {
      summary: 'Reports rose.',
      observations: [
        { text: 'Drainage rose.', metric_keys: ['category.DRAINAGE.change', 'invented'] },
        { text: 'Made up.', metric_keys: ['invented'] },
      ],
      attention: [],
      guidance_notes: [
        { text: 'Guidance says clear inlets.', refs: ['G1'] },
        { text: 'Unknown.', refs: ['G7'] },
      ],
      ai_ran: true,
      provider: 'anthropic',
      model_name: 'm',
      model_version: '1',
      prompt_version: 'p',
    };
    const parsed = parseInsight(
      body,
      new Set(['category.DRAINAGE.change']),
      new Set(['G1']),
    );
    expect(parsed?.observations).toEqual([
      { text: 'Drainage rose.', metricKeys: ['category.DRAINAGE.change'] },
    ]);
    expect(parsed?.guidanceNotes).toHaveLength(1);
    expect(parseInsight({ ...body, ai_ran: 'yes' }, new Set(), new Set())).toBeNull();
    expect(parseInsight(null, new Set(), new Set())).toBeNull();
  });

  it('sends facts in the wire format, bounded', () => {
    const wire = toInsightRequest({
      scope: 'government',
      periodLabel: 'x'.repeat(500),
      facts: Array.from({ length: 80 }, (_, i) => ({
        key: `k${i}`,
        label: 'l',
        value: '1',
      })),
      guidance: [],
    });
    expect((wire.facts as unknown[]).length).toBe(60);
    expect((wire.period_label as string).length).toBe(120);
  });
});
