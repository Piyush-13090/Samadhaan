import type { HealthStatus } from '@samadhaan/shared';

/**
 * Visual tone shared by badges, alerts, toasts and status indicators.
 *
 * `ai` is reserved for machine-generated content — see `components/ai/`. Using
 * it anywhere else breaks the product's promise that teal means "Samadhaan AI
 * produced this".
 */
export type Tone =
  'neutral' | 'primary' | 'ai' | 'info' | 'success' | 'warning' | 'danger';

/** Control sizing shared across buttons, inputs, selects and badges. */
export type Size = 'sm' | 'md' | 'lg';

/** Maps a dependency's health onto the tone used to render it. */
export const HEALTH_TONE: Record<HealthStatus, Tone> = {
  ok: 'success',
  degraded: 'warning',
  down: 'danger',
};

export const HEALTH_LABEL: Record<HealthStatus, string> = {
  ok: 'Operational',
  degraded: 'Degraded',
  down: 'Unavailable',
};
