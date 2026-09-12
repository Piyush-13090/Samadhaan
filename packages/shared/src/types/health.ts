/** Health contract shared by the NestJS API and the Python AI service. */

export const HEALTH_STATUSES = ['ok', 'degraded', 'down'] as const;

export type HealthStatus = (typeof HEALTH_STATUSES)[number];

export interface DependencyHealth {
  /** Dependency name, e.g. `database`, `redis`, `aiService`. */
  name: string;
  status: HealthStatus;
  /** Round-trip time of the probe in milliseconds. */
  latencyMs: number | null;
  /** Populated when the probe failed or reported a degraded state. */
  message?: string;
}

export interface HealthReport {
  /** Worst status across all dependencies. */
  status: HealthStatus;
  service: string;
  version: string;
  environment: string;
  /** Process uptime in seconds. */
  uptimeSeconds: number;
  timestamp: string;
  dependencies: DependencyHealth[];
}
