import { Injectable } from '@nestjs/common';

/**
 * Operational metrics in the Prometheus text format (Prompt 30).
 *
 * Small and dependency-free: counters, gauges and histograms with fixed,
 * low-cardinality label sets. Labels are route *templates*
 * (`/api/v1/problems/:publicId`), endpoint groups, job names and outcome
 * classes — never ids, URLs with parameters, user data or free text.
 *
 * Exposed at `GET /api/v1/metrics` only when METRICS_TOKEN is set, and only
 * to a bearer of that token (metrics.controller.ts). Per process: each API
 * replica reports its own series; the scraper aggregates.
 */
type Labels = Record<string, string>;

const escape = (v: string) =>
  v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
const key = (labels: Labels) =>
  Object.keys(labels)
    .sort()
    .map((k) => `${k}="${escape(labels[k] ?? '')}"`)
    .join(',');

abstract class Metric {
  constructor(
    readonly name: string,
    readonly help: string,
    readonly type: 'counter' | 'gauge' | 'histogram',
  ) {}
  abstract lines(): string[];
}

class Counter extends Metric {
  private readonly values = new Map<string, number>();
  constructor(name: string, help: string) {
    super(name, help, 'counter');
  }
  inc(labels: Labels = {}, by = 1) {
    const k = key(labels);
    this.values.set(k, (this.values.get(k) ?? 0) + by);
  }
  get(labels: Labels = {}): number {
    return this.values.get(key(labels)) ?? 0;
  }
  lines() {
    return [...this.values].map(([k, v]) => `${this.name}${k ? `{${k}}` : ''} ${v}`);
  }
}

class Gauge extends Metric {
  private readonly values = new Map<string, number>();
  constructor(name: string, help: string) {
    super(name, help, 'gauge');
  }
  set(labels: Labels, value: number) {
    this.values.set(key(labels), value);
  }
  lines() {
    return [...this.values].map(([k, v]) => `${this.name}${k ? `{${k}}` : ''} ${v}`);
  }
}

class Histogram extends Metric {
  private readonly series = new Map<
    string,
    { counts: number[]; sum: number; count: number }
  >();
  constructor(
    name: string,
    help: string,
    readonly buckets: number[],
  ) {
    super(name, help, 'histogram');
  }
  observe(labels: Labels, value: number) {
    const k = key(labels);
    let s = this.series.get(k);
    if (!s) {
      s = { counts: this.buckets.map(() => 0), sum: 0, count: 0 };
      this.series.set(k, s);
    }
    this.buckets.forEach((b, i) => {
      if (value <= b) s.counts[i] = (s.counts[i] ?? 0) + 1;
    });
    s.sum += value;
    s.count += 1;
  }
  lines() {
    const out: string[] = [];
    for (const [k, s] of this.series) {
      const prefix = k ? `${k},` : '';
      this.buckets.forEach((b, i) =>
        out.push(`${this.name}_bucket{${prefix}le="${b}"} ${s.counts[i]}`),
      );
      out.push(`${this.name}_bucket{${prefix}le="+Inf"} ${s.count}`);
      out.push(`${this.name}_sum${k ? `{${k}}` : ''} ${Number(s.sum.toFixed(6))}`);
      out.push(`${this.name}_count${k ? `{${k}}` : ''} ${s.count}`);
    }
    return out;
  }
}

const LATENCY_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60];

@Injectable()
export class MetricsService {
  readonly httpRequests = new Counter(
    'samadhaan_http_requests_total',
    'HTTP requests by method, route template and status class.',
  );
  readonly httpDuration = new Histogram(
    'samadhaan_http_request_duration_seconds',
    'HTTP request latency by method and route template.',
    LATENCY_BUCKETS,
  );
  readonly aiRequests = new Counter(
    'samadhaan_ai_requests_total',
    'Calls to the AI service by endpoint group and outcome (ok, client_error, server_error, timeout, unreachable, circuit_open).',
  );
  readonly aiDuration = new Histogram(
    'samadhaan_ai_request_duration_seconds',
    'AI service call latency by endpoint group.',
    LATENCY_BUCKETS,
  );
  readonly aiCircuit = new Gauge(
    'samadhaan_ai_circuit_state',
    'AI circuit breaker state by endpoint group: 0 closed, 1 half-open, 2 open.',
  );
  readonly jobRuns = new Counter(
    'samadhaan_background_job_runs_total',
    'Background sweep runs by job and outcome (ran, skipped_held, skipped_redis_error, failed).',
  );
  readonly storageErrors = new Counter(
    'samadhaan_storage_errors_total',
    'Object storage failures by operation.',
  );

  private readonly all: Metric[] = [
    this.httpRequests,
    this.httpDuration,
    this.aiRequests,
    this.aiDuration,
    this.aiCircuit,
    this.jobRuns,
    this.storageErrors,
  ];

  render(): string {
    const memory = process.memoryUsage();
    const out: string[] = [];
    for (const m of this.all) {
      out.push(`# HELP ${m.name} ${m.help}`, `# TYPE ${m.name} ${m.type}`, ...m.lines());
    }
    out.push(
      '# HELP samadhaan_process_uptime_seconds Process uptime.',
      '# TYPE samadhaan_process_uptime_seconds gauge',
      `samadhaan_process_uptime_seconds ${Math.round(process.uptime())}`,
      '# HELP samadhaan_process_resident_memory_bytes Resident memory.',
      '# TYPE samadhaan_process_resident_memory_bytes gauge',
      `samadhaan_process_resident_memory_bytes ${memory.rss}`,
    );
    return `${out.join('\n')}\n`;
  }
}
