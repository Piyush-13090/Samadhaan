import { Module } from '@nestjs/common';
import { AiClient } from './ai.client.js';
import { AiService } from './ai.service.js';

/**
 * The controlled boundary to the Python AI service.
 *
 * The browser never reaches the AI service; it calls the NestJS API, which
 * calls this module. That keeps authentication, rate limiting, auditing and
 * cost control in one enforceable place.
 */
@Module({
  providers: [AiClient, AiService],
  exports: [AiService],
})
export class AiModule {}
