import { Injectable } from '@nestjs/common';
import { METRIC_DEFINITIONS, type AnalyticsExportDataset } from '@samadhaan/shared';
import { PrismaService } from '../database/prisma.service.js';
import { AppConfig } from '../config/app.config.js';
import { toCsv } from './analytics-metrics.js';
import {
  GovernmentAnalyticsService,
  type GovernmentAnalyticsContext,
} from './government-analytics.service.js';

export interface AnalyticsExportFile {
  filename: string;
  contentType: string;
  body: string;
  rows: number;
  truncated: boolean;
}

type Row = Record<string, unknown>;

/**
 * Exports (Prompt 24). The same scope, jurisdiction and filters as the
 * dashboard; aggregated datasets are exactly what the dashboard shows, and
 * the problem list carries public fields only, capped at
 * ANALYTICS_EXPORT_MAX_ROWS. Every export is written to the audit log.
 */
@Injectable()
export class AnalyticsExportService {
  constructor(
    private readonly analytics: GovernmentAnalyticsService,
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  async export(
    ctx: GovernmentAnalyticsContext,
    dataset: AnalyticsExportDataset,
    format: 'csv' | 'json',
    actorUserId: string,
  ): Promise<AnalyticsExportFile> {
    const { rows, truncated } = await this.rows(ctx, dataset);
    const period = ctx.resolved.period;

    await this.prisma.auditLog.create({
      data: {
        actorUserId,
        action: 'ANALYTICS_EXPORTED',
        entityType: 'Organization',
        entityId: ctx.scope.organization.id,
        metadata: {
          dataset,
          format,
          rows: rows.length,
          truncated,
          from: period.from,
          to: period.to,
          timezone: period.timezone,
          filters: { ...ctx.filters },
        },
      },
    });

    const filename = `samadhaan-${ctx.scope.organization.slug}-${dataset}-${period.from}-to-${period.to}.${format}`;
    const body =
      format === 'json'
        ? JSON.stringify(
            {
              dataset,
              organization: ctx.scope.organization.name,
              period,
              filters: ctx.filters,
              generatedAt: new Date().toISOString(),
              truncated,
              rows,
            },
            null,
            2,
          )
        : toCsv(rows);
    return {
      filename,
      contentType: format === 'json' ? 'application/json' : 'text/csv; charset=utf-8',
      body,
      rows: rows.length,
      truncated,
    };
  }

  private async rows(
    ctx: GovernmentAnalyticsContext,
    dataset: AnalyticsExportDataset,
  ): Promise<{ rows: Row[]; truncated: boolean }> {
    switch (dataset) {
      case 'overview': {
        const { metrics } = await this.analytics.overview(ctx);
        return {
          truncated: false,
          rows: Object.values(metrics).map((m) => ({
            metric: m.key,
            label: METRIC_DEFINITIONS[m.key]?.label ?? m.key,
            value: m.value,
            previousPeriod: m.previous ?? null,
            changePct: m.changePct ?? null,
          })),
        };
      }
      case 'trends': {
        const { buckets } = await this.analytics.trends(ctx);
        return { truncated: false, rows: buckets.map((b) => ({ ...b })) };
      }
      case 'categories': {
        const { categories } = await this.analytics.categories(ctx);
        return { truncated: false, rows: categories.map((c) => ({ ...c })) };
      }
      case 'areas': {
        const areas = await this.analytics.areas(ctx);
        const level = (name: string, rows: typeof areas.byCity) =>
          rows.map((row) => ({ level: name, ...row }));
        return {
          truncated: false,
          rows: [
            ...level('state', areas.byState),
            ...level('city', areas.byCity),
            ...level('postalCode', areas.byPostalCode),
          ],
        };
      }
      case 'resolution': {
        const r = await this.analytics.resolution(ctx);
        return {
          truncated: false,
          rows: [
            ...r.funnel.map((s) => ({
              section: 'funnel',
              label: s.label,
              count: s.count,
              conversionPct: s.conversionPct,
              avgDays: null,
              medianDays: null,
            })),
            ...r.stages.map((s) => ({
              section: 'stage',
              label: s.label,
              count: s.observations,
              conversionPct: null,
              avgDays: s.avgDays,
              medianDays: s.medianDays,
            })),
            ...r.distribution.map((d) => ({
              section: 'time-to-resolution',
              label: d.bucket,
              count: d.count,
              conversionPct: null,
              avgDays: null,
              medianDays: null,
            })),
          ],
        };
      }
      case 'problems':
        return this.analytics.problemRows(ctx, this.config.analytics.exportMaxRows);
    }
  }
}
