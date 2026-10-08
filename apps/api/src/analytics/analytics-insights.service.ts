import { Injectable, Logger } from '@nestjs/common';
import {
  METRIC_DEFINITIONS,
  type AnalyticsCategories,
  type AnalyticsInsightView,
  type AnalyticsOverview,
  type AnalyticsResolution,
} from '@samadhaan/shared';
import { AiService } from '../ai/ai.service.js';
import type { InsightFactInput, InsightGuidanceInput } from '../ai/dto/insights.dto.js';
import { AppException } from '../common/app.exception.js';
import { AppConfig } from '../config/app.config.js';
import { KnowledgeRetrievalService } from '../knowledge/knowledge-retrieval.service.js';
import { AnalyticsCacheService } from './analytics-cache.service.js';
import { STABLE_BAND_PCT } from './analytics-metrics.js';
import { periodLabel } from './analytics-time.js';
import {
  GovernmentAnalyticsService,
  type GovernmentAnalyticsContext,
} from './government-analytics.service.js';

const NIL_USER = '00000000-0000-0000-0000-000000000000';

export const humanise = (value: string) =>
  value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ');

const signed = (value: number) => `${value > 0 ? '+' : ''}${value}%`;

/**
 * The facts an insight may use — formatted from computed metrics, nothing
 * else. A value that is unavailable is left out rather than described.
 */
export function buildFacts(
  overview: AnalyticsOverview,
  categories: AnalyticsCategories,
  resolution: AnalyticsResolution,
): InsightFactInput[] {
  const facts: InsightFactInput[] = [];
  const m = overview.metrics;
  const label = (key: string) => METRIC_DEFINITIONS[key]?.label ?? key;

  for (const key of [
    'reported',
    'verified',
    'resolved',
    'rejected',
    'criticalHigh',
  ] as const) {
    facts.push({ key, label: label(key), value: String(m[key].value ?? 0) });
    const change = m[key].changePct;
    if (change !== null && change !== undefined) {
      facts.push({
        key: `${key}.change`,
        label: `${label(key)} vs previous period`,
        value: signed(change),
        signal:
          change > STABLE_BAND_PCT
            ? 'increase'
            : change < -STABLE_BAND_PCT
              ? 'decrease'
              : undefined,
      });
    }
  }
  facts.push({
    key: 'activeNow',
    label: label('activeNow'),
    value: String(m.activeNow.value ?? 0),
  });
  if (m.resolutionRate.value !== null) {
    facts.push({
      key: 'resolutionRate',
      label: label('resolutionRate'),
      value: `${m.resolutionRate.value}%`,
    });
  }
  for (const key of ['medianDaysToVerification', 'medianDaysToResolution'] as const) {
    if (m[key].value !== null)
      facts.push({ key, label: label(key), value: `${m[key].value} days` });
  }

  for (const row of categories.categories.slice(0, 5)) {
    if (row.count === 0) continue;
    const name = humanise(row.category);
    facts.push({
      key: `category.${row.category}`,
      label: `Category: ${name}`,
      value: `${row.count} (${row.share}% of reports)`,
    });
    if (row.changePct !== null && row.direction !== 'stable') {
      facts.push({
        key: `category.${row.category}.change`,
        label: `Category: ${name}, vs previous period`,
        value: signed(row.changePct),
        signal: row.direction === 'increasing' ? 'increase' : 'decrease',
      });
    }
    if (row.persistent) {
      facts.push({
        key: `category.${row.category}.persistent`,
        label: `Category: ${name}, reported in most ${categories.period.granularity}s of the period`,
        value: 'yes',
      });
    }
  }

  if (resolution.bottleneck) {
    facts.push({
      key: 'bottleneck',
      label: 'Stage with the longest average time',
      value: `${resolution.bottleneck.label}: ${resolution.bottleneck.avgDays} days`,
      signal: 'bottleneck',
    });
  }
  if (resolution.summary.longestOpenDays !== null) {
    facts.push({
      key: 'longestOpen',
      label: 'Oldest open problem has waited',
      value: `${resolution.summary.longestOpenDays} days`,
      signal: resolution.summary.longestOpenDays > 30 ? 'attention' : undefined,
    });
  }
  if (resolution.summary.returnedVerifications > 0) {
    facts.push({
      key: 'returnedVerifications',
      label: 'Resolution requests returned or rejected',
      value: String(resolution.summary.returnedVerifications),
    });
  }
  return facts.slice(0, 60);
}

/**
 * AI insights for the command centre (Prompt 24).
 *
 * Three things are kept apart in the response:
 *  - observed data: the facts, computed in PostgreSQL;
 *  - reference knowledge: PUBLIC guidance retrieved for the most notable
 *    category (RAG), shown as sources;
 *  - AI interpretation: a summary whose every statement cites fact keys.
 *
 * The AI never sees problem rows, names or locations — only the facts. It
 * suggests nothing and decides nothing; generation is on request only.
 */
@Injectable()
export class AnalyticsInsightsService {
  private readonly logger = new Logger(AnalyticsInsightsService.name);

  constructor(
    private readonly analytics: GovernmentAnalyticsService,
    private readonly ai: AiService,
    private readonly knowledge: KnowledgeRetrievalService,
    private readonly cache: AnalyticsCacheService,
    private readonly config: AppConfig,
  ) {}

  private parts(ctx: GovernmentAnalyticsContext) {
    return [
      'gov-insight',
      ctx.scope.organization.id,
      AnalyticsCacheService.jurisdictionKey(ctx.scope.jurisdiction.condition),
      ctx.resolved.period,
      ctx.filters,
    ];
  }

  latest(ctx: GovernmentAnalyticsContext): Promise<AnalyticsInsightView | null> {
    return this.cache.get<AnalyticsInsightView>(this.parts(ctx));
  }

  async generate(
    ctx: GovernmentAnalyticsContext,
    requestId?: string,
  ): Promise<AnalyticsInsightView> {
    if (!this.config.analytics.insightsEnabled) {
      throw AppException.forbidden('AI insights are turned off on this server.');
    }
    const [overview, categories, resolution] = await Promise.all([
      this.analytics.overview(ctx),
      this.analytics.categories(ctx),
      this.analytics.resolution(ctx),
    ]);
    const base = {
      generatedAt: new Date().toISOString(),
      period: ctx.resolved.period,
      filters: ctx.filters,
    };

    if ((overview.metrics.reported.value ?? 0) === 0) {
      return {
        ...base,
        facts: [],
        summary: 'Not enough data yet — no problems were reported in this period.',
        observations: [],
        attention: [],
        guidance: [],
        guidanceNotes: [],
        model: { provider: 'none', name: 'none', promptVersion: 'none', aiRan: false },
      };
    }

    const facts = buildFacts(overview, categories, resolution);
    const guidance = await this.guidance(categories);
    const result = await this.ai.analyticsInsights(
      {
        scope: 'government',
        periodLabel: periodLabel(ctx.resolved.period),
        facts,
        guidance: guidance.map(({ ref, title, text }) => ({ ref, title, text })),
      },
      requestId,
    );
    if (!result.ok) {
      this.logger.warn(`analytics insight failed: ${result.failure.code}`);
      throw AppException.upstreamUnavailable(
        'AI service',
        'The summary could not be generated. The figures on this page are unaffected.',
      );
    }

    const { insight } = result;
    const view: AnalyticsInsightView = {
      ...base,
      facts: facts.map(({ key, label, value }) => ({ key, label, value })),
      summary: insight.summary,
      observations: insight.observations,
      attention: insight.attention,
      guidance: guidance.map(({ ref, title, sectionTitle, href }) => ({
        ref,
        title,
        sectionTitle,
        href,
      })),
      guidanceNotes: insight.guidanceNotes,
      model: {
        provider: insight.provider,
        name: insight.modelName,
        promptVersion: insight.promptVersion,
        aiRan: insight.aiRan,
      },
    };
    await this.cache.set(
      this.parts(ctx),
      view,
      this.config.analytics.insightCacheSeconds,
    );
    return view;
  }

  /** PUBLIC guidance for the category that changed most (or the largest). */
  private async guidance(
    categories: AnalyticsCategories,
  ): Promise<
    Array<InsightGuidanceInput & { sectionTitle: string | null; href: string }>
  > {
    if (!this.config.rag.enabled) return [];
    const focus =
      categories.categories.find((c) => c.direction === 'increasing') ??
      categories.categories.find((c) => c.count > 0);
    if (!focus) return [];
    try {
      const name = humanise(focus.category);
      const result = await this.knowledge.retrieve({
        semanticQuery: `${name} civic maintenance guidance for municipal offices`,
        keywordQuery: `${name} maintenance`,
        scope: {
          userId: NIL_USER,
          officeIds: [],
          organizationIds: [],
          projectId: null,
          only: ['PUBLIC'],
        },
        context: { kind: 'GENERAL', category: focus.category, city: null },
        topK: 2,
      });
      if (result.weak) return [];
      return result.passages.slice(0, 2).map((passage, i) => ({
        ref: `G${i + 1}`,
        title: passage.title,
        sectionTitle: passage.sectionTitle,
        text: passage.content.slice(0, 1500),
        href: `/knowledge/sources/${passage.sourceId}#chunk-${passage.chunkId}`,
      }));
    } catch {
      return []; // reference knowledge is optional
    }
  }
}
