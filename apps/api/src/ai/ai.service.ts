import { Injectable } from '@nestjs/common';
import type { HealthReport } from '@samadhaan/shared';
import { AiClient } from './ai.client.js';

/**
 * Application-facing entry point to AI capabilities.
 *
 * Feature modules depend on this service, never on `AiClient` directly, so the
 * transport can change (HTTP today, a queue later) without touching callers.
 *
 * Only the health probe is implemented in this milestone. Classification,
 * severity estimation, embeddings, duplicate detection and evidence
 * verification are added in later prompts as typed methods here — deliberately
 * not stubbed with fabricated responses.
 */
@Injectable()
export class AiService {
  constructor(private readonly client: AiClient) {}

  /** Probes the AI service. Returns `null` when it is unreachable. */
  async getHealth(requestId?: string): Promise<HealthReport | null> {
    const result = await this.client.get<HealthReport>('/health', {
      requestId,
    });
    return result.ok ? result.value : null;
  }
}
